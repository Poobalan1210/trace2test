import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bundleKey, replayKey, testKey, type HttpEvent, type Incident } from '@t2t/shared';
import { memoryIncidentStore, memoryObjectStore, memoryWorkflow, putJson } from '@t2t/aws';
import { createApiHandler, median, SEEDED_CART } from './api.js';

vi.spyOn(console, 'log').mockImplementation(() => {});

const ID = '01JCXK2M8Q4T9V6B3N7RZ5WDHE';
const ID2 = '01JCXK2M8Q4T9V6B3N7RZ5WDHF';
const TOKEN = 'dashboard-token-123';

const req = (m: string, p: string, opts: { token?: string | null; query?: Record<string, string>; body?: string } = {}): HttpEvent => ({
  rawPath: p,
  headers: opts.token === null ? {} : { 'x-t2t-token': opts.token ?? TOKEN },
  queryStringParameters: opts.query,
  body: opts.body,
  requestContext: { http: { method: m, path: p } },
});

const incident = (id: string, over: Partial<Incident> = {}): Incident => ({
  id, status: 'TEST_READY', service: 'lantern-checkout', method: 'POST', path: '/checkout',
  errorName: 'PaymentProviderError', errorMessage: 'amount must be an integer', fingerprint: 'a41f9c0d1e2f',
  occurrences: 1, capturedAt: '2026-11-14T09:12:44.120Z', createdAt: '2026-11-14T09:12:45.000Z', lastSeenAt: '2026-11-14T09:12:45.000Z',
  steps: {}, prodStatus: 500, redactionCount: 2, leakCount: 0, replayable: true, ...over,
});

let incidents: ReturnType<typeof memoryIncidentStore>;
let objects: ReturnType<typeof memoryObjectStore>;
let workflow: ReturnType<typeof memoryWorkflow>;
let shopFetch: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof createApiHandler>;

beforeEach(async () => {
  incidents = memoryIncidentStore();
  objects = memoryObjectStore();
  workflow = memoryWorkflow();
  shopFetch = vi.fn(async () => new Response('{"error":"Internal error"}', { status: 500, headers: { 'content-type': 'application/json' } }));
  api = createApiHandler({
    incidents, objects, workflow, dashboardToken: TOKEN,
    shopProdUrl: 'https://shop-prod.test/', prodApiKey: 'prod-key',
    fetch: shopFetch as unknown as typeof fetch, now: () => 1000,
  });
  await incidents.create(incident(ID, { testKey: testKey(ID, 'checkout-500-a41f9c.test.js'), testFilename: 'checkout-500-a41f9c.test.js', captureToTestMs: 8000 }));
  await incidents.create(incident(ID2, { status: 'NOT_REPRODUCED', createdAt: '2026-11-14T10:00:00.000Z' }));
});

const body = (r: { body?: string }) => JSON.parse(r.body!);

describe('auth', () => {
  test.each([
    ['GET', '/incidents'], ['GET', `/incidents/${ID}`], ['GET', `/incidents/${ID}/test`],
    ['POST', `/incidents/${ID}/verify`], ['GET', '/metrics'], ['POST', '/demo/trigger'],
  ])('%s %s is 401 without detail on a missing or wrong token', async (m, p) => {
    for (const token of [null, 'wrong']) {
      const res = await api(req(m, p, { token }));
      expect(res.statusCode).toBe(401);
      expect(body(res)).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('GET /incidents', () => {
  test('lists newest first', async () => {
    const res = await api(req('GET', '/incidents'));
    expect(res.statusCode).toBe(200);
    expect(body(res).items.map((i: Incident) => i.id)).toEqual([ID2, ID]);
  });

  test('filters by status and rejects unknown ones', async () => {
    expect(body(await api(req('GET', '/incidents', { query: { status: 'TEST_READY,FIXED' } }))).items).toHaveLength(1);
    expect((await api(req('GET', '/incidents', { query: { status: 'NOPE' } }))).statusCode).toBe(400);
  });
});

describe('GET /incidents/{id}', () => {
  test('returns the incident with its sanitized request and replay', async () => {
    await putJson(objects, bundleKey(ID), { request: { method: 'POST', path: '/checkout', query: {}, headers: {}, body: { a: 1 } }, response: { status: 500, body: {} }, redactions: [{ path: 'request.body.email', type: 'email' }] });
    await putJson(objects, replayKey(ID), { mode: 'capture', staging: { status: 500, body: {}, ms: 3 }, verdict: 'REPRODUCED' });
    const res = body(await api(req('GET', `/incidents/${ID}`)));
    expect(res.incident.id).toBe(ID);
    expect(res.request).toMatchObject({ body: { a: 1 }, redactions: [{ path: 'request.body.email', type: 'email' }] });
    expect(res.production).toEqual({ status: 500, body: {} });
    expect(res.replay.verdict).toBe('REPRODUCED');
    expect(res.verify).toBeNull();
  });

  test('404 for unknown or malformed ids', async () => {
    expect((await api(req('GET', '/incidents/01JCXK2M8Q4T9V6B3N7RZ5WDHZ'))).statusCode).toBe(404);
    expect((await api(req('GET', '/incidents/..%2Fraw'))).statusCode).toBe(404);
  });
});

describe('GET /incidents/{id}/test', () => {
  test('returns the file and its name', async () => {
    await objects.putText(testKey(ID, 'checkout-500-a41f9c.test.js'), '// test');
    expect(body(await api(req('GET', `/incidents/${ID}/test`)))).toEqual({ filename: 'checkout-500-a41f9c.test.js', source: '// test' });
  });

  test('404 when there is no test', async () => {
    expect((await api(req('GET', `/incidents/${ID2}/test`))).statusCode).toBe(404);
  });
});

describe('POST /incidents/{id}/verify', () => {
  test('starts a verify execution and marks the incident', async () => {
    const res = await api(req('POST', `/incidents/${ID}/verify`));
    expect(res.statusCode).toBe(202);
    expect(workflow.started).toEqual([{ name: `${ID}-verify-1000`, input: { incidentId: ID, mode: 'verify' } }]);
    expect(incidents.incidents.get(ID)!.status).toBe('VERIFYING');
  });

  test('409 while in progress or when not replayable', async () => {
    await incidents.update(ID, { status: 'REPLAYING' });
    expect((await api(req('POST', `/incidents/${ID}/verify`))).statusCode).toBe(409);
    await incidents.update(ID2, { replayable: false });
    expect((await api(req('POST', `/incidents/${ID2}/verify`))).statusCode).toBe(409);
    expect(workflow.started).toHaveLength(0);
  });
});

describe('GET /metrics', () => {
  test('totals plus derived figures', async () => {
    await incidents.addMetrics({ captured: 2, replayable: 2, reproduced: 1, testsGenerated: 1, redactions: 4 });
    expect(body(await api(req('GET', '/metrics')))).toMatchObject({
      captured: 2, reproduced: 1, reproducedPercent: 50, testsGenerated: 1, redactions: 4, leaks: 0,
      medianCaptureToTestMs: 8000, medianSampleSize: 1,
    });
  });

  test('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe('POST /demo/trigger', () => {
  test('sends the seeded cart to shop-prod with the prod key and relays the result', async () => {
    const res = await api(req('POST', '/demo/trigger'));
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: 'Internal error' });
    const [url, init] = shopFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://shop-prod.test/checkout');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('prod-key');
    expect(JSON.parse(init.body as string)).toEqual(SEEDED_CART);
  });

  test('forwards a cart from the shop page', async () => {
    const cart = { ...SEEDED_CART, paymentMethod: 'card' };
    await api(req('POST', '/demo/trigger', { body: JSON.stringify(cart) }));
    expect(JSON.parse((shopFetch.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual(cart);
  });

  test('rejects bad carts', async () => {
    expect((await api(req('POST', '/demo/trigger', { body: '[1]' }))).statusCode).toBe(400);
    expect((await api(req('POST', '/demo/trigger', { body: 'x'.repeat(20000) }))).statusCode).toBe(413);
  });
});

test('unknown routes are 404', async () => {
  expect((await api(req('DELETE', `/incidents/${ID}`))).statusCode).toBe(404);
});
