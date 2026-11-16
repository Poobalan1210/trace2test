import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bundleKey, lanternCapture, rawKey, type Incident } from '@t2t/shared';
import { memoryIncidentStore, memoryObjectStore, putJson } from '@t2t/aws';
import { code, fenced, parseDelivery, pullRequestBody } from './github.js';
import { deliver, generate, sanitize, validate, type TaskDeps } from './tasks.js';

vi.spyOn(console, 'log').mockImplementation(() => {});

const ID = '01JCXK2M8Q4T9V6B3N7RZ5WDHE';

/** Just enough of the GitHub REST API for one repository, kept in memory. */
function fakeGitHub(opts: { failOn?: string } = {}) {
  const branches = new Map<string, string>([['main', 'sha-main']]);
  const files = new Map<string, { content: string; sha: string }>();
  const pulls: { number: number; head: string; base: string; title: string; body: string; html_url: string; draft: boolean }[] = [];
  const comments: { number: number; body: string }[] = [];
  const calls: string[] = [];

  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const route = `${method} ${u.pathname}`;
    calls.push(route);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
    if (opts.failOn && route.startsWith(opts.failOn)) return reply(403, { message: 'Resource not accessible by personal access token' });
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const p = u.pathname.replace(/^\/repos\/acme\/shop/, '');

    if (method === 'GET' && p === '') return reply(200, { default_branch: 'main' });
    if (method === 'GET' && p.startsWith('/git/ref/heads/')) {
      const sha = branches.get(decodeURIComponent(p.slice('/git/ref/heads/'.length)));
      return sha ? reply(200, { object: { sha } }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'POST' && p === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (branches.has(name)) return reply(422, { message: 'Reference already exists' });
      branches.set(name, body.sha);
      return reply(201, {});
    }
    if (p.startsWith('/contents/')) {
      const key = `${u.searchParams.get('ref') ?? body?.branch}:${decodeURIComponent(p.slice('/contents/'.length))}`;
      if (method === 'GET') return files.has(key) ? reply(200, { sha: files.get(key)!.sha }) : reply(404, { message: 'Not Found' });
      if (files.has(key) && body.sha !== files.get(key)!.sha) return reply(409, { message: 'sha mismatch' });
      files.set(key, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha-${files.size + 1}` });
      return reply(201, {});
    }
    if (method === 'GET' && p === '/pulls') {
      const head = u.searchParams.get('head')!.replace('acme:', '');
      return reply(200, pulls.filter((pr) => pr.head === head));
    }
    if (method === 'POST' && p === '/pulls') {
      const pr = { number: pulls.length + 7, html_url: `https://github.com/acme/shop/pull/${pulls.length + 7}`, ...body };
      pulls.push(pr);
      return reply(201, pr);
    }
    const comment = p.match(/^\/issues\/(\d+)\/comments$/);
    if (method === 'POST' && comment) {
      comments.push({ number: Number(comment[1]), body: body.body });
      return reply(201, {});
    }
    return reply(404, { message: `unhandled ${route}` });
  });
  return { fetch: fetchImpl as unknown as typeof fetch, branches, files, pulls, comments, calls };
}

function incident(): Incident {
  return {
    id: ID, status: 'RECEIVED', service: 'lantern-checkout', method: 'POST', path: '/checkout',
    errorName: 'PaymentProviderError', errorMessage: 'amount must be an integer', fingerprint: 'a41f9c0d1e2f',
    occurrences: 3, capturedAt: '2026-11-14T09:12:44.120Z', createdAt: '2026-11-14T09:12:45.000Z', lastSeenAt: '2026-11-14T09:12:45.000Z',
    steps: {}, prodStatus: 500, redactionCount: 2, leakCount: 0,
  };
}

let gh: ReturnType<typeof fakeGitHub>;
let deps: TaskDeps & { incidents: ReturnType<typeof memoryIncidentStore>; objects: ReturnType<typeof memoryObjectStore> };
const input = { incidentId: ID, mode: 'capture' as const };

/** An incident with no staging target, run through to an unverified test. */
async function withTest(d = deps) {
  await d.incidents.create(incident());
  await putJson(d.objects, rawKey(ID), lanternCapture());
  await sanitize(d, input);
  await validate(d, input);
  await generate(d, input);
}

beforeEach(() => {
  gh = fakeGitHub();
  deps = {
    incidents: memoryIncidentStore(),
    objects: memoryObjectStore(),
    targets: {},
    stagingApiKey: undefined,
    delivery: { 'lantern-checkout': { repo: 'acme/shop', testDir: 'test/regression' } },
    github: { token: async () => 'ghp_test', fetch: gh.fetch },
    dashboardUrl: 'https://t2t.example/',
  };
});

describe('Deliver', () => {
  test('opens a pull request with the test on its own branch', async () => {
    await withTest();
    const out = await deliver(deps, input);
    expect(out).toEqual({ delivered: 1, pullRequestUrl: 'https://github.com/acme/shop/pull/7' });

    expect(gh.branches.get('trace2test/checkout-500-a41f9c')).toBe('sha-main');
    const file = gh.files.get('trace2test/checkout-500-a41f9c:test/regression/checkout-500-a41f9c.test.js')!;
    expect(file.content).toBe(deps.objects.objects.get(deps.incidents.incidents.get(ID)!.testKey!));
    expect(gh.pulls[0]).toMatchObject({ head: 'trace2test/checkout-500-a41f9c', base: 'main', draft: false });
    expect(gh.pulls[0].title).toBe('Regression test: POST /checkout returned 500 in production');

    const inc = deps.incidents.incidents.get(ID)!;
    expect(inc.delivery).toMatchObject({ repo: 'acme/shop', pullRequestNumber: 7, pullRequestUrl: 'https://github.com/acme/shop/pull/7' });
    expect(inc.steps.Deliver.ok).toBe(true);
  });

  test('the pull request carries no customer data and links back to the incident', async () => {
    await withTest();
    await deliver(deps, input);
    const body = gh.pulls[0].body;
    expect(body).not.toContain('asha.k@example.com');
    expect(body).toMatch(/user_[0-9a-f]{4}@redacted\.example/);
    expect(body).toContain('- **Staging:** not checked, ` no staging target is configured for lantern-checkout `');
    expect(body).toContain(`https://t2t.example/incidents/${ID}`);
    expect(body).toContain('- **Seen:** 3 times');
  });

  test('running it again opens nothing new', async () => {
    await withTest();
    await deliver(deps, input);
    // Forget the recorded result, as if the first run died after GitHub answered.
    await deps.incidents.update(ID, { delivery: undefined });
    deps.incidents.incidents.get(ID)!.delivery = undefined;
    expect(await deliver(deps, input)).toMatchObject({ delivered: 1, pullRequestUrl: 'https://github.com/acme/shop/pull/7' });
    expect(gh.pulls).toHaveLength(1);
    expect(gh.files.size).toBe(1);
  });

  test('a GitHub error is recorded on the incident and does not fail the step', async () => {
    gh = fakeGitHub({ failOn: 'POST /repos/acme/shop/pulls' });
    deps.github = { token: async () => 'ghp_test', fetch: gh.fetch };
    await withTest();
    const out = await deliver(deps, input);
    expect(out.delivered).toBe(0);
    expect(deps.incidents.incidents.get(ID)!.delivery!.error).toMatch(/opening the pull request: GitHub answered 403 \(Resource not accessible/);
  });

  test('a service without delivery is skipped without calling GitHub', async () => {
    deps.delivery = {};
    await withTest();
    expect(await deliver(deps, input)).toMatchObject({ delivered: 0 });
    expect(gh.calls).toEqual([]);
  });

  test('verify mode comments on the pull request once the fix is confirmed', async () => {
    await withTest();
    await deliver(deps, input);
    await deps.incidents.update(ID, { status: 'FIXED', stagingStatus: 200, verifiedAt: '2026-11-15T10:00:00.000Z' });
    expect(await deliver(deps, { incidentId: ID, mode: 'verify' })).toEqual({ delivered: 1 });
    expect(gh.comments).toEqual([{ number: 7, body: expect.stringContaining('it now answers 200') }]);
  });
});

describe('PR text', () => {
  test('captured values cannot escape their code spans or mention anyone', async () => {
    expect(code('a`b')).toBe('`` a`b ``');
    expect(code('line\nbreak')).toBe('` line break `');
    expect(fenced('```\nx')).toBe('````\n```\nx\n````');

    await withTest();
    const inc = deps.incidents.incidents.get(ID)!;
    const bundle = JSON.parse(deps.objects.objects.get(bundleKey(ID))!);
    bundle.error.message = '@octocat ``` <script>';
    const body = pullRequestBody({ bundle, incident: inc, filePath: 'regression/x.test.js', verified: true });
    const errorLine = body.split('\n').find((l) => l.startsWith('- **Error:**'))!;
    expect(errorLine.startsWith('- **Error:** ```` PaymentProviderError: @octocat ``` <script> ```` at ')).toBe(true);
  });

  test('delivery config is validated', () => {
    expect(parseDelivery('{"svc":{"repo":"acme/shop","testDir":"test/regression"}}')).toEqual({ svc: { repo: 'acme/shop', testDir: 'test/regression' } });
    expect(() => parseDelivery('{"svc":{"repo":"acme"}}')).toThrow(/owner\/name/);
    expect(() => parseDelivery('{"svc":{"repo":"acme/shop","testDir":"../etc"}}')).toThrow(/relative folder/);
    expect(() => parseDelivery('{"svc":{"repo":"acme/shop","testDir":"/abs"}}')).toThrow(/relative folder/);
  });
});
