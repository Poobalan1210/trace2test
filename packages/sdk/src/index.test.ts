import { describe, expect, test, vi } from 'vitest';
import { serverError, validateCapture, type Capture, type HttpEvent } from '@t2t/shared';
import { withTrace2Test } from './index.js';

const event: HttpEvent = {
  rawPath: '/orders',
  headers: { 'content-type': 'application/json', 'x-api-key': 'live_123' },
  body: JSON.stringify({ email: 'a@x.io', qty: 2 }),
  requestContext: { http: { method: 'POST', path: '/orders' } },
};

const config = (fetchImpl: typeof fetch, extra = {}) => ({
  ingestUrl: 'https://t2t.example/incidents',
  ingestKey: 'ik',
  service: 'orders',
  stage: 'prod',
  fetch: fetchImpl,
  log: () => {},
  ...extra,
});

const okFetch = () => vi.fn(async () => new Response('{}', { status: 202 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const sentCapture = (f: ReturnType<typeof vi.fn>): Capture => JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);

describe('withTrace2Test', () => {
  test('a successful response produces no network call and is returned as is', async () => {
    const f = okFetch();
    const res = { statusCode: 200, body: '{"ok":true}' };
    const wrapped = withTrace2Test(async () => res, config(f));
    expect(await wrapped(event)).toBe(res);
    expect(f).not.toHaveBeenCalled();
  });

  test('4xx is not captured', async () => {
    const f = okFetch();
    await withTrace2Test(async () => ({ statusCode: 404 }), config(f))(event);
    expect(f).not.toHaveBeenCalled();
  });

  test('a 5xx is captured, redacted, and the response is unchanged', async () => {
    const f = okFetch();
    const res = serverError(new TypeError('boom'));
    const out = await withTrace2Test(async () => res, config(f))(event);
    expect(out).toBe(res);
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://t2t.example/incidents');
    expect((init.headers as Record<string, string>)['x-t2t-ingest-key']).toBe('ik');
    const c = sentCapture(f);
    expect(validateCapture(c)).toBeNull();
    expect(c.request.headers['x-api-key']).toBe('[REDACTED:key]');
    expect(JSON.stringify(c)).not.toContain('live_123');
    expect(JSON.stringify(c)).not.toContain('a@x.io');
    expect(c.error.name).toBe('TypeError');
    expect(c.response).toEqual({ status: 500, body: { error: 'Internal error' } });
  });

  test('a thrown error is captured and rethrown', async () => {
    const f = okFetch();
    const boom = new RangeError('nope');
    await expect(withTrace2Test(async () => { throw boom; }, config(f))(event)).rejects.toBe(boom);
    expect(sentCapture(f).response).toEqual({ status: 500, body: { message: 'Internal Server Error' } });
    expect(sentCapture(f).error.name).toBe('RangeError');
  });

  test('a plain 500 without an attached error still captures', async () => {
    const f = okFetch();
    await withTrace2Test(async () => ({ statusCode: 503, body: 'down' }), config(f))(event);
    expect(sentCapture(f).error).toEqual({ name: 'HttpError', message: 'HTTP 503', stackTop: '' });
  });

  test('staging never captures, nor do replayed requests', async () => {
    const f = okFetch();
    await withTrace2Test(async () => ({ statusCode: 500 }), config(f, { stage: 'staging' }))(event);
    await withTrace2Test(async () => ({ statusCode: 500 }), config(f))({ ...event, headers: { ...event.headers, 'x-t2t-replay': 'id' } });
    expect(f).not.toHaveBeenCalled();
  });

  test('a large or non-JSON body is omitted', async () => {
    const f = okFetch();
    await withTrace2Test(async () => ({ statusCode: 500 }), config(f, { maxBodyBytes: 10 }))(event);
    expect(sentCapture(f).request).toMatchObject({ body: null, bodyOmitted: true });
    const g = okFetch();
    await withTrace2Test(async () => ({ statusCode: 500 }), config(g))({ ...event, body: 'not json' });
    expect(sentCapture(g).request).toMatchObject({ body: null, bodyOmitted: true });
  });

  test('an ingest timeout stays within the 1.5 s budget and changes nothing', async () => {
    const hang = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const res = { statusCode: 500, body: '{}' };
    const started = Date.now();
    const out = await withTrace2Test(async () => res, config(hang))(event);
    const elapsed = Date.now() - started;
    expect(out).toBe(res);
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(1700);
  });

  test('an ingest failure is swallowed', async () => {
    const fail = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const res = { statusCode: 502 };
    expect(await withTrace2Test(async () => res, config(fail))(event)).toBe(res);
  });
});
