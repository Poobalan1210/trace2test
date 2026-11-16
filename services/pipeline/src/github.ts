import type { Bundle, Incident } from '@t2t/shared';

/**
 * Delivers a generated test as a GitHub pull request. Plain REST calls over
 * fetch, no client library. Every step is safe to repeat: an existing branch,
 * file or open pull request is reused, so a retried Deliver opens nothing twice.
 */

export interface DeliveryTarget {
  /** "owner/name" */
  repo: string;
  /** Defaults to the repository's default branch. */
  baseBranch?: string;
  /** Folder the test is written to. Defaults to "regression". */
  testDir?: string;
  draft?: boolean;
}

export type DeliveryTargets = Record<string, DeliveryTarget>;

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIR_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;
const BRANCH_RE = /^[A-Za-z0-9_./-]+$/;

export function parseDelivery(raw: string | undefined): DeliveryTargets {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as DeliveryTargets;
  for (const [service, t] of Object.entries(parsed)) {
    if (!REPO_RE.test(t.repo ?? '')) throw new Error(`delivery for ${service}: repo must be "owner/name"`);
    if (t.testDir !== undefined && (!DIR_RE.test(t.testDir) || t.testDir.split('/').includes('..'))) {
      throw new Error(`delivery for ${service}: testDir must be a relative folder`);
    }
    if (t.baseBranch !== undefined && (!BRANCH_RE.test(t.baseBranch) || t.baseBranch.includes('..'))) {
      throw new Error(`delivery for ${service}: baseBranch is not a valid branch name`);
    }
  }
  return parsed;
}

export interface GitHubDeps {
  token: () => Promise<string>;
  /** GitHub Enterprise Server: https://<host>/api/v3 */
  apiUrl?: string;
  fetch?: typeof fetch;
}

export class GitHubError extends Error {
  name = 'GitHubError';
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function gh<T>(deps: GitHubDeps, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await (deps.fetch ?? fetch)(`${(deps.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${await deps.token()}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'trace2test',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

function expectOk<T>(r: { status: number; data: T }, what: string): T {
  if (r.status >= 200 && r.status < 300) return r.data;
  const message = (r.data as { message?: unknown } | null)?.message;
  throw new GitHubError(`${what}: GitHub answered ${r.status}${typeof message === 'string' ? ` (${message.slice(0, 200)})` : ''}`, r.status);
}

const segs = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export interface PullRequestInput {
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
  title: string;
  body: string;
}

export async function openPullRequest(deps: GitHubDeps, target: DeliveryTarget, input: PullRequestInput): Promise<{ url: string; number: number }> {
  const repo = `/repos/${segs(target.repo)}`;
  const base = target.baseBranch ?? expectOk(await gh<{ default_branch: string }>(deps, 'GET', repo), 'reading the repository').default_branch;
  const baseSha = expectOk(await gh<{ object: { sha: string } }>(deps, 'GET', `${repo}/git/ref/heads/${segs(base)}`), `reading ${base}`).object.sha;

  // 422 means the branch is already there from an earlier attempt; carry on with it.
  const ref = await gh(deps, 'POST', `${repo}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: baseSha });
  if (ref.status !== 422) expectOk(ref, 'creating the branch');

  const existing = await gh<{ sha: string }>(deps, 'GET', `${repo}/contents/${segs(input.filePath)}?ref=${encodeURIComponent(input.branch)}`);
  if (existing.status !== 404) expectOk(existing, 'reading the test file');
  expectOk(await gh(deps, 'PUT', `${repo}/contents/${segs(input.filePath)}`, {
    message: input.commitMessage,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
    branch: input.branch,
    ...(existing.status === 200 ? { sha: existing.data.sha } : {}),
  }), 'writing the test file');

  const owner = target.repo.split('/')[0];
  const open = expectOk(
    await gh<{ html_url: string; number: number }[]>(deps, 'GET', `${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branch}`)}`),
    'looking for an open pull request',
  );
  if (open.length > 0) return { url: open[0].html_url, number: open[0].number };

  const pr = expectOk(await gh<{ html_url: string; number: number }>(deps, 'POST', `${repo}/pulls`, {
    title: input.title, head: input.branch, base, body: input.body, draft: target.draft ?? false,
  }), 'opening the pull request');
  return { url: pr.html_url, number: pr.number };
}

export async function commentOnPullRequest(deps: GitHubDeps, repo: string, number: number, body: string): Promise<void> {
  expectOk(await gh(deps, 'POST', `/repos/${segs(repo)}/issues/${number}/comments`, { body }), 'commenting on the pull request');
}

// --- Text -------------------------------------------------------------------
// Everything captured goes into code spans or fenced blocks, so a value can
// neither format the page nor @mention anyone.

/** One line, no control characters, at most `max` characters. */
export function oneLine(text: string, max = 120): string {
  // eslint-disable-next-line no-control-regex
  const flat = String(text).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

const longestRun = (text: string) => Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));

export function code(text: string): string {
  const ticks = '`'.repeat(longestRun(text) + 1);
  return `${ticks} ${oneLine(text, 300)} ${ticks}`;
}

export function fenced(text: string, lang = ''): string {
  const ticks = '`'.repeat(Math.max(3, longestRun(text) + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

export interface PrText {
  bundle: Bundle;
  incident: Incident;
  filePath: string;
  verified: boolean;
  dashboardUrl?: string;
}

export function pullRequestTitle({ bundle }: Pick<PrText, 'bundle'>): string {
  return oneLine(`Regression test: ${bundle.request.method} ${bundle.request.path} returned ${bundle.response.status} in production`, 120);
}

export function pullRequestBody({ bundle, incident, filePath, verified, dashboardUrl }: PrText): string {
  const req = bundle.request;
  const redacted = [...new Set(bundle.redactions.map((r) => r.path))];
  const staging = verified
    ? `reproduced: staging failed the same way (${incident.stagingStatus ?? '5xx'})`
    : `not checked, ${incident.reason ? code(incident.reason) : 'no staging target is configured'}`;
  const captured = { method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body };

  return [
    'Trace2Test captured a request that failed in production and wrote a regression test for it.',
    '',
    `- **Request:** ${code(`${req.method} ${req.path}`)}`,
    `- **Production answered:** ${bundle.response.status}`,
    `- **Error:** ${code(`${bundle.error.name}: ${bundle.error.message}`)}${bundle.error.stackTop ? ` at ${code(bundle.error.stackTop)}` : ''}`,
    `- **Staging:** ${staging}`,
    `- **Seen:** ${incident.occurrences} time${incident.occurrences === 1 ? '' : 's'}, first at ${bundle.capturedAt.replace(/\.\d+Z$/, 'Z')}`,
    `- **Redacted inside the service before capture:** ${redacted.length ? redacted.map(code).join(', ') : 'nothing matched'}`,
    '',
    '### The test',
    '',
    `${code(filePath)} sends this exact request to ${code('T2T_TARGET_URL')} and fails while the server answers with a 5xx. ` +
      'It is skipped when the variable is not set, so it does not break suites that have no server to call.',
    '',
    fenced(`T2T_TARGET_URL=https://<staging-or-local> T2T_TARGET_API_KEY=<key> npx jest ${filePath}`, 'sh'),
    '',
    verified
      ? 'Push the fix to this branch, deploy it to staging, and run the test: it passes once the bug is gone. Trace2Test comments here when it confirms the fix.'
      : 'Run it against a local server or a staging copy to confirm the failure before fixing it.',
    '',
    '<details><summary>Captured request (redacted)</summary>',
    '',
    fenced(JSON.stringify(captured, null, 2), 'json'),
    '',
    '</details>',
    ...(dashboardUrl ? ['', `[Open the incident in Trace2Test](${dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id})`] : []),
    '',
  ].join('\n');
}

export function fixedComment(stagingStatus: number, verifiedAt: string): string {
  return `Trace2Test replayed the captured request on staging at ${verifiedAt.replace(/\.\d+Z$/, 'Z')} and it now answers ${stagingStatus}. The fix is confirmed; this test should pass.`;
}
