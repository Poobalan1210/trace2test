import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import Fastify from 'fastify';
import { validateCapture, type Capture, type HttpEvent } from '@t2t/shared';
import { fromLambdaEvent, isReplay, trace2testExpress, trace2testFastify, withTrace2Test } from './index.js';

const config = (fetchImpl: typeof fetch, extra = {}) => ({
  ingestUrl: 'https://t2t.example/incidents',
  ingestKey: 'ik',
  service: 'orders',
  stage: 'production',
  fetch: fetchImpl,
  log: () => {},
  ...extra,
});

const okFetch = () => vi.fn(async () => new Response('{}', { status: 202 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const sentCapture = (f: ReturnType<typeof vi.fn>): Capture => JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
const order = { email: 'a@x.io', qty: 2 };

describe('Lambda event shapes', () => {
  test('REST API (payload v1) events are read, including multi-value maps', () => {
    const v1: HttpEvent = {
      httpMethod: 'post',
      path: '/orders',
      headers: null,
      multiValueHeaders: { 'Content-Type': ['application/json'], 'X-Api-Key': ['live_1'] },
      queryStringParameters: null,
      multiValueQueryStringParameters: { tag: ['a', 'b'] },
      body: JSON.stringify(order),
    };
    expect(fromLambdaEvent(v1)).toEqual({
      method: 'post',
      path: '/orders',
      query: { tag: 'a, b' },
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'live_1' },
      body: JSON.stringify(order),
    });
  });

  test('a v1 failure is captured with the right method and path', async () => {
    const f = okFetch();
    const v1: HttpEvent = { httpMethod: 'POST', path: '/orders', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order) };
    await withTrace2Test(async () => ({ statusCode: 500, body: '{}' }), config(f))(v1);
    const c = sentCapture(f);
    expect(validateCapture(c)).toBeNull();
    expect(c.request).toMatchObject({ method: 'POST', path: '/orders' });
    expect(JSON.stringify(c)).not.toContain('a@x.io');
  });
});

test('isReplay reads the replay header from any request shape', () => {
  expect(isReplay({ headers: { 'x-t2t-replay': '01ABC' } })).toBe(true);
  expect(isReplay({ headers: { 'X-T2T-Replay': ['01ABC'] } })).toBe(true);
  expect(isReplay({ headers: {} })).toBe(false);
  expect(isReplay(undefined)).toBe(false);
});

describe('Express', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start(app: express.Express): Promise<string> {
    server = app.listen(0);
    await new Promise((r) => server!.once('listening', r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  function app(f: typeof fetch, extra = {}) {
    const t2t = trace2testExpress(config(f, extra));
    const a = express();
    a.use(t2t.capture);
    a.use(express.json());
    a.post('/orders', () => {
      throw new TypeError('qty must be a string');
    });
    a.post('/manual', (_req, res) => {
      res.status(503).json({ error: 'down', contact: 'ops@shop.io' });
    });
    a.get('/ok', (_req, res) => {
      res.json({ ok: true });
    });
    a.use(t2t.recordErrors);
    a.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'Internal error' });
    });
    return a;
  }

  const post = (base: string, path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}?ref=mail`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'live_123', ...headers }, body: JSON.stringify(order) });

  test('a thrown error is captured with its name, redacted, after the response', async () => {
    const f = okFetch();
    const base = await start(app(f));
    const res = await post(base, '/orders');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    const c = sentCapture(f);
    expect(validateCapture(c)).toBeNull();
    expect(c.request).toMatchObject({ method: 'POST', path: '/orders', query: { ref: 'mail' } });
    expect(c.request.headers['x-api-key']).toBe('[REDACTED:key]');
    expect(c.error.name).toBe('TypeError');
    expect(c.response).toEqual({ status: 500, body: { error: 'Internal error' } });
    expect(JSON.stringify(c)).not.toMatch(/a@x\.io|live_123/);
  });

  test('a 5xx sent by a route is captured with its body, redacted', async () => {
    const f = okFetch();
    const base = await start(app(f));
    expect((await post(base, '/manual')).status).toBe(503);
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    const c = sentCapture(f);
    expect(c.error).toEqual({ name: 'HttpError', message: 'HTTP 503', stackTop: '' });
    expect(c.response.status).toBe(503);
    expect(JSON.stringify(c.response.body)).not.toContain('ops@shop.io');
  });

  test('success, replays and non-production stages send nothing', async () => {
    const f = okFetch();
    const base = await start(app(f));
    expect((await fetch(`${base}/ok`)).status).toBe(200);
    expect((await post(base, '/orders', { 'x-t2t-replay': '01ABC' })).status).toBe(500);
    server!.close();
    const g = okFetch();
    const base2 = await start(app(g, { stage: 'staging' }));
    expect((await post(base2, '/orders')).status).toBe(500);
    await new Promise((r) => setTimeout(r, 50));
    expect(f).not.toHaveBeenCalled();
    expect(g).not.toHaveBeenCalled();
  });
});

describe('Fastify', () => {
  test('a thrown error and a sent 5xx are captured; success is not', async () => {
    const f = okFetch();
    const app = Fastify();
    trace2testFastify(app, config(f));
    app.post('/orders', async () => {
      throw new RangeError('qty out of range');
    });
    app.post('/manual', async (_req, reply) => reply.code(502).send({ error: 'upstream', who: 'b@y.io' }));
    app.get('/ok', async () => ({ ok: true }));
    const inject = (url: string, method: 'GET' | 'POST' = 'POST') =>
      app.inject({ method, url, headers: { 'content-type': 'application/json', authorization: 'Bearer abc.def' }, payload: method === 'POST' ? order : undefined });

    expect((await inject('/ok', 'GET')).statusCode).toBe(200);
    expect((await inject('/orders?ref=x')).statusCode).toBe(500);
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    let c = sentCapture(f);
    expect(validateCapture(c)).toBeNull();
    expect(c.request).toMatchObject({ method: 'POST', path: '/orders', query: { ref: 'x' } });
    expect(c.error.name).toBe('RangeError');
    expect(JSON.stringify(c)).not.toMatch(/a@x\.io|abc\.def/);

    f.mockClear();
    expect((await inject('/manual')).statusCode).toBe(502);
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    c = sentCapture(f);
    expect(c.response.status).toBe(502);
    expect(JSON.stringify(c)).not.toContain('b@y.io');
    await app.close();
  });
});
