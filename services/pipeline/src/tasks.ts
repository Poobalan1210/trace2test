import {
  DEFAULT_RULES, bundleKey, jsonDiff, rawKey, redactHeaders, redactValue, replayKey, testKey, verifyKey,
  type Bundle, type Capture, type Redaction, type ReplayRecord, type Verdict,
} from '@t2t/shared';
import { getJson, putJson, timed, type IncidentStore, type ObjectStore } from '@t2t/aws';
import { REPLAY_HEADERS, targetUrl, type ReplayTargets } from './config.js';
import { generateTest } from './generator.js';
import {
  commentOnPullRequest, fixedComment, openPullRequest, pullRequestBody, pullRequestTitle, oneLine,
  type DeliveryTargets, type GitHubDeps,
} from './github.js';

export interface TaskDeps {
  incidents: IncidentStore;
  objects: ObjectStore;
  targets: ReplayTargets;
  stagingApiKey: string | undefined;
  fetch?: typeof fetch;
  replayTimeoutMs?: number;
  now?: () => number;
  /** Where each service's tests are delivered; services without an entry are not delivered. */
  delivery?: DeliveryTargets;
  github?: GitHubDeps;
  dashboardUrl?: string;
}

export interface TaskInput {
  incidentId: string;
  mode: 'capture' | 'verify';
}

export class NetworkError extends Error {
  name = 'NetworkError';
}

/** Missing inputs are not retryable; the state machine's catch-all records them. */
export class MissingInputError extends Error {
  name = 'MissingInputError';
}

async function loadBundle(deps: TaskDeps, id: string): Promise<Bundle> {
  const bundle = await getJson<Bundle>(deps.objects, bundleKey(id));
  if (!bundle) throw new MissingInputError(`no bundle for ${id}`);
  return bundle;
}

// --- Sanitize -------------------------------------------------------------

/** Second redaction pass. Anything it still finds is a leak the wrapper missed. */
export function secondPass(capture: Capture): { request: Capture['request']; response: Capture['response']; error: Capture['error']; found: Redaction[] } {
  const found: Redaction[] = [];
  const request = {
    ...capture.request,
    query: redactValue(capture.request.query, DEFAULT_RULES, 'request.query', found) as Record<string, string>,
    headers: redactHeaders(capture.request.headers, DEFAULT_RULES, 'request.headers', found),
    body: redactValue(capture.request.body, DEFAULT_RULES, 'request.body', found),
  };
  const response = { ...capture.response, body: redactValue(capture.response.body, DEFAULT_RULES, 'response.body', found) };
  const error = { ...capture.error, message: redactValue(capture.error.message, DEFAULT_RULES, 'error.message', found) as string };
  return { request, response, error, found };
}

export async function sanitize(deps: TaskDeps, input: TaskInput) {
  return timed(deps.incidents, input.incidentId, 'Sanitize', async () => {
    const id = input.incidentId;
    const incident = await deps.incidents.get(id);
    if (!incident) throw new MissingInputError(`no incident ${id}`);

    const raw = await getJson<Capture>(deps.objects, rawKey(id));
    if (!raw) {
      // Already sanitized on an earlier attempt: the raw object is gone, the bundle is not.
      const done = await loadBundle(deps, id);
      return { leakCount: done.leakCount, redactionCount: done.redactions.length };
    }

    const pass = secondPass(raw);
    // A scan of the result should find nothing; if it does, those count as leaks too.
    const rescan = secondPass({ ...raw, ...pass });
    const leakCount = pass.found.length + rescan.found.length;

    const bundle: Bundle = {
      incidentId: id,
      service: raw.service,
      capturedAt: raw.capturedAt,
      fingerprint: incident.fingerprint,
      request: rescan.request,
      response: rescan.response,
      error: rescan.error,
      redactions: [...raw.redactions, ...pass.found, ...rescan.found],
      leakCount,
    };
    await putJson(deps.objects, bundleKey(id), bundle);
    await deps.objects.delete(rawKey(id));
    await deps.incidents.update(id, {
      status: 'SANITIZED',
      leakCount,
      redactionCount: bundle.redactions.length,
      errorMessage: bundle.error.message,
    });
    return { leakCount, redactionCount: bundle.redactions.length };
  });
}

// --- Validate -------------------------------------------------------------

export async function validate(deps: TaskDeps, input: TaskInput) {
  return timed(deps.incidents, input.incidentId, 'Validate', async () => {
    const bundle = await loadBundle(deps, input.incidentId);
    const target = deps.targets[bundle.service];
    const route = `${bundle.request.method} ${bundle.request.path}`;
    let reason = '';
    if (bundle.request.bodyOmitted) reason = 'the request body was too large or not JSON, so it was not captured';
    else if (!target) reason = `no staging target is configured for ${bundle.service}`;
    else if (!target.routes.includes(route)) reason = `${route} is not on the replay allowlist`;
    const replayable = reason === '';
    // Without a staging copy the request is still worth a test the team can run themselves.
    const testable = !bundle.request.bodyOmitted;
    await deps.incidents.update(input.incidentId, { replayable, ...(replayable ? {} : { reason }) });
    return { replayable, testable, reason };
  });
}

// --- Replay ---------------------------------------------------------------

export async function replay(deps: TaskDeps, input: TaskInput) {
  const step = input.mode === 'verify' ? 'VerifyReplay' : 'Replay';
  await deps.incidents.update(input.incidentId, { status: input.mode === 'verify' ? 'VERIFYING' : 'REPLAYING' });
  return timed(deps.incidents, input.incidentId, step, async () => {
    const bundle = await loadBundle(deps, input.incidentId);
    const target = deps.targets[bundle.service];
    if (!target) throw new MissingInputError(`no staging target for ${bundle.service}`);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(bundle.request.headers)) if (REPLAY_HEADERS.includes(k.toLowerCase())) headers[k] = v;
    headers['x-t2t-replay'] = input.incidentId;
    if (deps.stagingApiKey) headers['x-api-key'] = deps.stagingApiKey;

    const url = targetUrl(target.baseUrl, bundle.request.path, bundle.request.query);
    const hasBody = !['GET', 'HEAD'].includes(bundle.request.method) && bundle.request.body != null;
    const started = Date.now();
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(url, {
        method: bundle.request.method,
        headers,
        body: hasBody ? JSON.stringify(bundle.request.body) : undefined,
        signal: AbortSignal.timeout(deps.replayTimeoutMs ?? 10_000),
        redirect: 'manual',
      });
    } catch (err) {
      throw new NetworkError(`replay request failed: ${(err as Error)?.name ?? 'error'}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep the text
    }
    // The staging response is replayed data too; it gets the same redaction as the capture.
    const scrubbed = redactValue(body, DEFAULT_RULES, 'staging.body', []);

    const record: ReplayRecord = {
      mode: input.mode,
      replayedAt: new Date().toISOString(),
      target: bundle.service,
      staging: { status: res.status, body: scrubbed, ms: Date.now() - started },
    };
    await putJson(deps.objects, input.mode === 'verify' ? verifyKey(input.incidentId) : replayKey(input.incidentId), record);
    return { stagingStatus: res.status };
  });
}

// --- Compare --------------------------------------------------------------

const statusClass = (s: number) => `${Math.floor(s / 100)}xx`;
const errorField = (body: unknown) =>
  body && typeof body === 'object' && 'error' in body ? JSON.stringify((body as { error: unknown }).error) : '';
export const signature = (status: number, body: unknown) => `${statusClass(status)}|${errorField(body)}`;

export function decide(mode: TaskInput['mode'], prod: Bundle['response'], staging: { status: number; body: unknown }): { verdict: Verdict; reason: string } {
  if (mode === 'verify') {
    return staging.status < 500
      ? { verdict: 'FIXED', reason: `staging now returns ${staging.status}` }
      : { verdict: 'STILL_FAILING', reason: `staging still returns ${staging.status}` };
  }
  if (staging.status >= 500 && signature(staging.status, staging.body) === signature(prod.status, prod.body)) {
    return { verdict: 'REPRODUCED', reason: 'staging fails the same way' };
  }
  if (staging.status >= 500) {
    return { verdict: 'NOT_REPRODUCED', reason: `staging returned ${staging.status} with a different error, so this may be a different failure` };
  }
  return {
    verdict: 'NOT_REPRODUCED',
    reason: `staging returned ${staging.status}; the bug may already be fixed or may depend on production data`,
  };
}

export async function compare(deps: TaskDeps, input: TaskInput) {
  const step = input.mode === 'verify' ? 'VerifyCompare' : 'Compare';
  return timed(deps.incidents, input.incidentId, step, async () => {
    const bundle = await loadBundle(deps, input.incidentId);
    const key = input.mode === 'verify' ? verifyKey(input.incidentId) : replayKey(input.incidentId);
    const record = await getJson<ReplayRecord>(deps.objects, key);
    if (!record || !('status' in record.staging)) throw new MissingInputError(`no replay for ${input.incidentId}`);

    const staging = record.staging;
    const { verdict, reason } = decide(input.mode, bundle.response, staging);
    const diff = jsonDiff(bundle.response.body, staging.body);
    await putJson(deps.objects, key, { ...record, verdict, reason, diff });

    await deps.incidents.update(input.incidentId, {
      stagingStatus: staging.status,
      ...(input.mode === 'capture' ? { verdict, reason, status: verdict === 'REPRODUCED' ? 'REPRODUCED' : 'NOT_REPRODUCED' } : {}),
    });
    return { verdict, reason, stagingStatus: staging.status, reproduced: verdict === 'REPRODUCED' ? 1 : 0 };
  });
}

// --- GenerateTest ---------------------------------------------------------

/**
 * Writes the test. After a reproduced replay it is verified; for a request
 * that could not be replayed (no staging target, route not allowlisted) it is
 * unverified, and the incident ends as TEST_UNVERIFIED.
 */
export async function generate(deps: TaskDeps, input: TaskInput) {
  return timed(deps.incidents, input.incidentId, 'GenerateTest', async () => {
    const bundle = await loadBundle(deps, input.incidentId);
    const incident = await deps.incidents.get(input.incidentId);
    const record = await getJson<ReplayRecord>(deps.objects, replayKey(input.incidentId));
    const verified = !!record && 'status' in record.staging;
    if (!verified && incident?.replayable !== false) throw new MissingInputError(`no replay for ${input.incidentId}`);

    const { filename, source } = generateTest({ bundle, stagingStatus: verified ? (record.staging as { status: number }).status : undefined });
    const key = testKey(input.incidentId, filename);
    await deps.objects.putText(key, source, 'text/javascript; charset=utf-8');

    const now = deps.now?.() ?? Date.now();
    const captureToTestMs = incident ? Math.max(0, now - Date.parse(incident.capturedAt)) : 0;
    await deps.incidents.update(input.incidentId, { testKey: key, testFilename: filename, captureToTestMs });
    return {
      testKey: key, filename, captureToTestMs, generated: 1,
      finalStatus: verified ? 'TEST_READY' : 'TEST_UNVERIFIED',
      replayable: verified ? 1 : 0,
      reproduced: verified ? 1 : 0,
    };
  });
}

// --- Deliver --------------------------------------------------------------

/**
 * Capture mode: opens a pull request with the test in the service's repository.
 * Verify mode: comments on that pull request once the fix is confirmed.
 * A delivery problem is recorded on the incident and never fails the pipeline:
 * the test is still on the dashboard.
 */
export async function deliver(deps: TaskDeps, input: TaskInput) {
  const step = input.mode === 'verify' ? 'NotifyFix' : 'Deliver';
  return timed(deps.incidents, input.incidentId, step, async () => {
    const incident = await deps.incidents.get(input.incidentId);
    if (!incident) throw new MissingInputError(`no incident ${input.incidentId}`);
    const target = deps.delivery?.[incident.service];
    if (!target || !deps.github) return { delivered: 0, skipped: 'no delivery configured for this service' };

    try {
      if (input.mode === 'verify') {
        const pr = incident.delivery?.pullRequestNumber;
        if (!pr || incident.status !== 'FIXED') return { delivered: 0, skipped: 'nothing to report' };
        await commentOnPullRequest(deps.github, incident.delivery!.repo, pr, fixedComment(incident.stagingStatus ?? 200, incident.verifiedAt ?? new Date().toISOString()));
        return { delivered: 1 };
      }

      if (incident.delivery?.pullRequestUrl) return { delivered: 1, pullRequestUrl: incident.delivery.pullRequestUrl };
      if (!incident.testKey || !incident.testFilename) throw new MissingInputError(`no test for ${input.incidentId}`);
      const [bundle, source] = await Promise.all([loadBundle(deps, input.incidentId), deps.objects.getText(incident.testKey)]);
      if (source === undefined) throw new MissingInputError(`test file missing for ${input.incidentId}`);

      const filePath = `${target.testDir ?? 'regression'}/${incident.testFilename}`;
      const branch = `trace2test/${incident.testFilename.replace(/\.test\.js$/, '')}`;
      const verified = incident.verdict === 'REPRODUCED';
      const pr = await openPullRequest(deps.github, target, {
        branch,
        filePath,
        content: source,
        commitMessage: oneLine(`test: regression test for ${bundle.request.method} ${bundle.request.path} (Trace2Test)`, 100),
        title: pullRequestTitle({ bundle }),
        body: pullRequestBody({ bundle, incident, filePath, verified, dashboardUrl: deps.dashboardUrl }),
      });
      await deps.incidents.update(input.incidentId, {
        delivery: { repo: target.repo, branch, pullRequestUrl: pr.url, pullRequestNumber: pr.number, deliveredAt: new Date().toISOString() },
      });
      return { delivered: 1, pullRequestUrl: pr.url };
    } catch (err) {
      if (err instanceof MissingInputError) throw err;
      const error = oneLine(`${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? ''}`, 300);
      await deps.incidents.update(input.incidentId, { delivery: { ...(incident.delivery ?? { repo: target.repo }), error } });
      return { delivered: 0, error };
    }
  });
}
