import { scenarioForError } from '@shop/scenarios';
import type { Incident, IncidentDetail } from '../api/types';

/** The demo scenario an incident came from, if it matches one. A real service would have none. */
export const scenarioFor = (i: Incident) => scenarioForError(i.errorMessage);

/** A short human title for an incident: the scenario's name, or the error itself. */
export const incidentTitle = (i: Incident) => scenarioFor(i)?.title ?? `${i.errorName}: ${i.errorMessage}`;

/** Plain-English labels for redaction types. */
export const REDACTION_NOUN: Record<string, string> = {
  email: 'email address', key: 'API key', token: 'access token', bearer: 'bearer token', jwt: 'login token (JWT)',
  card: 'card number', phone: 'phone number', password: 'password', cookie: 'cookie', secret: 'secret',
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function counted(types: string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return list([...counts].map(([t, n]) => {
    const noun = REDACTION_NOUN[t] ?? t;
    return n === 1 ? `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}` : `${n} ${noun.endsWith('s') ? `${noun}es` : `${noun}s`}`;
  }));
}

export interface Narrative {
  happened: string;
  privacy: string | null;
  result: string;
  next: string[];
}

/** A templated, plain-English account of an incident. No model involved. */
export function narrate(d: IncidentDetail): Narrative {
  const i = d.incident;
  const when = new Date(i.capturedAt);
  const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const repeat = i.occurrences > 1 ? ` It has happened ${i.occurrences} times in total.` : '';
  const happened = `On ${date} at ${time}, ${i.method} ${i.path} in ${i.service} answered ${i.prodStatus} with ${i.errorName}: “${i.errorMessage}”.${repeat}`;

  const types = d.request?.redactions.map((r) => r.type) ?? [];
  const privacy = types.length
    ? `Before the request left ${i.service}, ${counted(types)} ${types.length === 1 ? 'was' : 'were'} replaced with safe stand-ins. The real values were never sent or stored.`
    : d.request ? 'The request held no private values that matched the redaction rules.' : null;

  const staging = i.stagingStatus;
  switch (i.status) {
    case 'RECEIVED':
    case 'SANITIZED':
    case 'REPLAYING':
      return { happened, privacy, result: 'Trace2Test is replaying the request on staging now. This page updates on its own.', next: ['Nothing to do yet.'] };
    case 'REPRODUCED':
      return { happened, privacy, result: `Staging failed the same way (${staging}), so the bug is reproduced. The test is being written.`, next: ['Nothing to do yet.'] };
    case 'TEST_READY':
      return {
        happened, privacy,
        result: `Staging failed the same way (${staging}), so the bug is reproduced. A Jest test that fails until the bug is fixed is ready below.`,
        next: [
          'Download the test (step 4 below) into your project.',
          'Run it against staging. It fails, which proves it catches this bug.',
          'Fix the code and deploy the fix to staging.',
          'Press “Re-run on staging” (step 5). The incident turns Fixed when staging passes.',
        ],
      };
    case 'TEST_UNVERIFIED':
      return {
        happened, privacy,
        result: `It was not replayed (${i.reason ?? 'no staging copy is configured'}), so the failure is not confirmed. A Jest test with the exact request is ready anyway.`,
        next: [
          i.delivery?.pullRequestUrl ? 'Open the pull request with the test (step 4 below).' : 'Download the test (step 4 below) into your project.',
          'Run it against a local server or a staging copy. It should fail the same way.',
          'Fix the code until it passes.',
          'To have Trace2Test check fixes itself, add a staging target for this service (ReplayTargets).',
        ],
      };
    case 'VERIFYING':
      return { happened, privacy, result: 'Re-running the captured request on staging to check the fix.', next: ['Nothing to do yet.'] };
    case 'FIXED':
      return {
        happened, privacy,
        result: `After the fix, staging answers ${staging} to the same request. The bug is fixed on staging, and the test now passes.`,
        next: ['Ship the fix to production.', 'Keep the test in your suite so this bug cannot come back.'],
      };
    case 'STILL_FAILING':
      return {
        happened, privacy,
        result: `Staging still answers ${staging} to the same request.`,
        next: ['Check that the fix is actually deployed to staging.', 'Re-run against staging once it is.'],
      };
    case 'NOT_REPRODUCED':
      return {
        happened, privacy,
        result: `${capitalise(i.reason ?? `staging answered ${staging}`)}. No test was written: a test that already passes would prove nothing.`,
        next: [
          'Look for what differs between production and staging for this request: stored data, configuration or third-party responses.',
          'The kept request (step 2 below) is the exact input to start from.',
        ],
      };
    case 'NOT_REPLAYABLE':
      return {
        happened, privacy,
        result: `It was not replayed: ${i.reason}.`,
        next: ['The request body was too large or not JSON, so there was nothing to replay or write a test from.'],
      };
    case 'PIPELINE_FAILED':
      return {
        happened, privacy,
        result: `Trace2Test hit an error while processing this incident${i.failure ? ` (${i.failure.error})` : ''}. The captured request is safe.`,
        next: ['Open the Step Functions execution for this incident to see which step failed.'],
      };
  }
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Reads a value from the captured request by a redaction path such as request.body.items[0].email. */
export function valueAt(root: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/^request\./, '').match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = part.startsWith('[') ? (cur as unknown[])[Number(part.slice(1, -1))] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Stand-in values that redaction writes, found inside a longer string. */
export const PLACEHOLDER_RE = /user_[0-9a-f]{4}@redacted\.example|\[REDACTED:[a-z]+\]|4111111111111111|\+10000000000/g;

export function placeholdersIn(value: string): string[] {
  return value.match(PLACEHOLDER_RE) ?? [];
}
