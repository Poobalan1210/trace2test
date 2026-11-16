import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Server } from 'node:http';
import { bundleKey, lanternCapture, rawKey, replayKey, type Bundle, type Incident, type ReplayRecord } from '@t2t/shared';
import { getJson, memoryIncidentStore, memoryObjectStore, putJson } from '@t2t/aws';
import { startLocalShop } from '@t2t/svc-shop/src/local-server.js';
import { compare, decide, generate, replay, sanitize, validate, type TaskDeps } from './tasks.js';
import { parseTargets, targetUrl } from './config.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const ID = '01JCXK2M8Q4T9V6B3N7RZ5WDHE';
let shop: { url: string; server: Server };
beforeAll(async () => { shop = await startLocalShop({ apiKey: 'staging-key', fixed: false }); });
afterAll(() => shop.server.close());

let deps: TaskDeps & { incidents: ReturnType<typeof memoryIncidentStore>; objects: ReturnType<typeof memoryObjectStore> };
const input = { incidentId: ID, mode: 'capture' as const };

function incident(): Incident {
  return {
    id: ID, status: 'RECEIVED', service: 'lantern-checkout', method: 'POST', path: '/checkout',
    errorName: 'PaymentProviderError', errorMessage: 'amount must be an integer', fingerprint: 'a41f9c0d1e2f',
    occurrences: 1, capturedAt: '2026-11-14T09:12:44.120Z', createdAt: '2026-11-14T09:12:45.000Z', lastSeenAt: '2026-11-14T09:12:45.000Z',
    steps: {}, prodStatus: 500, redactionCount: 2, leakCount: 0,
  };
}

beforeEach(async () => {
  deps = {
    incidents: memoryIncidentStore(),
    objects: memoryObjectStore(),
    targets: { 'lantern-checkout': { baseUrl: shop.url, routes: ['POST /checkout'] } },
    stagingApiKey: 'staging-key',
    now: () => Date.parse('2026-11-14T09:12:52.120Z'),
  };
  await deps.incidents.create(incident());
  await putJson(deps.objects, rawKey(ID), lanternCapture());
});

describe('Sanitize', () => {
  test('writes the bundle, deletes the raw capture, records timing', async () => {
    const out = await sanitize(deps, input);
    expect(out).toEqual({ leakCount: 0, redactionCount: 2 });
    expect(deps.objects.objects.has(rawKey(ID))).toBe(false);
    const bundle = (await getJson<Bundle>(deps.objects, bundleKey(ID)))!;
    expect(bundle.request.body).toEqual(lanternCapture().request.body);
    const inc = deps.incidents.incidents.get(ID)!;
    expect(inc.status).toBe('SANITIZED');
    expect(inc.steps.Sanitize.ok).toBe(true);
  });

  test('counts and removes what the wrapper missed', async () => {
    const leaky = lanternCapture();
    (leaky.request.body as Record<string, unknown>).note = 'ring asha@example.com';
    leaky.request.headers.authorization = 'Bearer live_secret';
    await putJson(deps.objects, rawKey(ID), leaky);
    const out = await sanitize(deps, input);
    expect(out.leakCount).toBe(2);
    const text = deps.objects.objects.get(bundleKey(ID))!;
    expect(text).not.toContain('asha@example.com');
    expect(text).not.toContain('live_secret');
    expect(deps.incidents.incidents.get(ID)!.leakCount).toBe(2);
  });

  test('is idempotent', async () => {
    const first = await sanitize(deps, input);
    const bundle = deps.objects.objects.get(bundleKey(ID));
    expect(await sanitize(deps, input)).toEqual(first);
    expect(deps.objects.objects.get(bundleKey(ID))).toBe(bundle);
  });
});

describe('Validate', () => {
  beforeEach(() => sanitize(deps, input));

  test('replayable when body, route and target are all present', async () => {
    expect(await validate(deps, input)).toEqual({ replayable: true, testable: true, reason: '' });
  });

  test('not replayable without a body, a target, or an allowed route', async () => {
    const b = (await getJson<Bundle>(deps.objects, bundleKey(ID)))!;
    await putJson(deps.objects, bundleKey(ID), { ...b, request: { ...b.request, body: null, bodyOmitted: true } });
    expect((await validate(deps, input)).reason).toMatch(/too large or not JSON/);
    await putJson(deps.objects, bundleKey(ID), { ...b, request: { ...b.request, path: '/admin' } });
    expect((await validate(deps, input)).reason).toBe('POST /admin is not on the replay allowlist');
    deps.targets = {};
    expect((await validate(deps, input)).reason).toMatch(/no staging target/);
  });
});

describe('Replay and Compare', () => {
  beforeEach(() => sanitize(deps, input));

  test('reproduces the failure on staging', async () => {
    expect(await replay(deps, input)).toEqual({ stagingStatus: 500 });
    const out = await compare(deps, input);
    expect(out).toMatchObject({ verdict: 'REPRODUCED', stagingStatus: 500, reproduced: 1 });
    const rec = (await getJson<ReplayRecord>(deps.objects, replayKey(ID)))!;
    expect(rec.diff).toEqual([]);
    expect(rec.target).toBe('lantern-checkout');
    expect(deps.incidents.incidents.get(ID)!.status).toBe('REPRODUCED');
  });

  test('sends only allowlisted headers plus the replay marker and staging key', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    await replay({ ...deps, fetch: f as unknown as typeof fetch }, input);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${shop.url}/checkout`);
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-t2t-replay': ID, 'x-api-key': 'staging-key' });
  });

  test('a network failure raises NetworkError for the state machine to retry', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(replay({ ...deps, fetch: f as unknown as typeof fetch }, input)).rejects.toMatchObject({ name: 'NetworkError' });
  });

  test('a fixed staging is not a reproduction', async () => {
    const fixed = await startLocalShop({ apiKey: 'staging-key', fixed: true });
    try {
      const d = { ...deps, targets: { 'lantern-checkout': { baseUrl: fixed.url, routes: ['POST /checkout'] } } };
      await replay(d, input);
      const out = await compare(d, input);
      expect(out.verdict).toBe('NOT_REPRODUCED');
      expect(out.reason).toBe('staging returned 200; the bug may already be fixed or may depend on production data');
      await replay(d, { incidentId: ID, mode: 'verify' });
      expect((await compare(d, { incidentId: ID, mode: 'verify' })).verdict).toBe('FIXED');
      expect(deps.incidents.incidents.get(ID)!.steps.VerifyCompare.ok).toBe(true);
    } finally {
      fixed.server.close();
    }
  });
});

describe('decide', () => {
  const prod = { status: 500, body: { error: 'Internal error' } };
  test('signature must match', () => {
    expect(decide('capture', prod, { status: 502, body: { error: 'Internal error' } }).verdict).toBe('REPRODUCED');
    expect(decide('capture', prod, { status: 500, body: { error: 'Other' } }).verdict).toBe('NOT_REPRODUCED');
    expect(decide('verify', prod, { status: 500, body: {} }).verdict).toBe('STILL_FAILING');
    expect(decide('verify', prod, { status: 400, body: {} }).verdict).toBe('FIXED');
  });
});

describe('GenerateTest', () => {
  test('writes the test file and records capture-to-test time', async () => {
    await sanitize(deps, input);
    await replay(deps, input);
    await compare(deps, input);
    const out = await generate(deps, input);
    expect(out).toMatchObject({ testKey: `incidents/${ID}/checkout-500-a41f9c.test.js`, filename: 'checkout-500-a41f9c.test.js', captureToTestMs: 8000, generated: 1 });
    expect(out).toMatchObject({ finalStatus: 'TEST_READY', replayable: 1, reproduced: 1 });
    expect(deps.objects.objects.get(out.testKey)).toContain('describe : describe.skip)("POST /checkout (incident a41f9c)"');
    expect(deps.incidents.incidents.get(ID)!.testKey).toBe(out.testKey);
  });

  test('without a staging target it still writes a test, marked unverified', async () => {
    deps.targets = {};
    await sanitize(deps, input);
    const v = await validate(deps, input);
    expect(v).toMatchObject({ replayable: false, testable: true });
    const out = await generate(deps, input);
    expect(out).toMatchObject({ finalStatus: 'TEST_UNVERIFIED', replayable: 0, reproduced: 0, generated: 1 });
    expect(deps.objects.objects.get(out.testKey)).toContain('Staging:     not replayed');
  });

  test('a replayable incident with no replay record is an error, not an unverified test', async () => {
    await sanitize(deps, input);
    await validate(deps, input);
    await expect(generate(deps, input)).rejects.toMatchObject({ name: 'MissingInputError' });
  });
});

describe('targetUrl safety', () => {
  test('a captured path can never change the host', () => {
    expect(() => targetUrl('https://staging.example', '//evil.example/x', {})).toThrow();
    expect(() => targetUrl('https://staging.example', 'http://evil.example', {})).toThrow();
    expect(() => targetUrl('https://staging.example', '/@evil.example', {})).not.toThrow();
    expect(new URL(targetUrl('https://staging.example', '/@evil.example', {})).host).toBe('staging.example');
    expect(targetUrl('https://staging.example/', '/checkout', { a: '1' })).toBe('https://staging.example/checkout?a=1');
  });
});

test('replay routes can be given without spaces, for stack parameters', () => {
  const list = parseTargets('{"svc":{"baseUrl":"https://s.example","routes":["POST /orders"]}}');
  const map = parseTargets('{"svc":{"baseUrl":"https://s.example","routes":{"post":["/orders"],"GET":["/a","/b"]}}}');
  expect(list.svc.routes).toEqual(['POST /orders']);
  expect(map.svc.routes).toEqual(['POST /orders', 'GET /a', 'GET /b']);
  expect(() => parseTargets('{"svc":{"baseUrl":"http://s.example","routes":[]}}')).toThrow(/https/);
});
