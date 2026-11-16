import { expect, test, vi } from 'vitest';
import { withTrace2Test } from '@trace2test/sdk';
import { fakeEmail, validateCapture, type Capture } from '@t2t/shared';
import { createCheckoutHandler } from './checkout.js';
import { STOCK } from './catalog.js';
import { trace2testConfig } from './config.js';
import { checkoutEvent, inProcessPayments, LANTERN_CART } from './testing.js';

test('wrapping checkout produces the capture shape from the spec', async () => {
  const fetchSpy = vi.fn(async () => new Response('{"incidentId":"x"}', { status: 202 }));
  const handler = withTrace2Test(
    createCheckoutHandler({ payments: inProcessPayments, apiKey: 'live_key', inventory: STOCK.prod, fixUpiRounding: false, fixAddressLine2: false }),
    { ...trace2testConfig(), ingestUrl: 'https://t2t.test/incidents', ingestKey: 'ik', stage: 'prod', codeVersion: '7', fetch: fetchSpy as unknown as typeof fetch },
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await handler(checkoutEvent(LANTERN_CART, { 'x-api-key': 'live_key', 'user-agent': 'Mozilla', 'x-forwarded-for': '10.0.0.1' }));
  expect(res.statusCode).toBe(500);

  const capture: Capture = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(validateCapture(capture)).toBeNull();
  expect(capture).toEqual({
    schemaVersion: 1,
    service: 'lantern-checkout',
    capturedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    request: {
      method: 'POST',
      path: '/checkout',
      query: {},
      headers: { 'content-type': 'application/json', 'x-api-key': '[REDACTED:key]' },
      body: { ...LANTERN_CART, customer: { email: fakeEmail('asha.k@example.com') } },
    },
    response: { status: 500, body: { error: 'Internal error' } },
    error: { name: 'PaymentProviderError', message: 'amount must be an integer', stackTop: expect.stringMatching(/^chargeUpi \(checkout\.ts:\d+\)$/) },
    redactions: [
      { path: 'request.headers.x-api-key', type: 'key' },
      { path: 'request.body.customer.email', type: 'email' },
    ],
    runtime: { node: expect.stringMatching(/^\d+\.x$/), codeVersion: '7' },
  });
});

test('the address scenario redacts the email inside the gift note', async () => {
  const { scenario } = await import('./scenarios.js');
  const fetchSpy = vi.fn(async () => new Response('{}', { status: 202 }));
  const handler = withTrace2Test(
    createCheckoutHandler({ payments: inProcessPayments, apiKey: 'live_key', inventory: STOCK.prod, fixUpiRounding: false, fixAddressLine2: false }),
    { ...trace2testConfig(), ingestUrl: 'https://t2t.test/incidents', ingestKey: 'ik', stage: 'prod', fetch: fetchSpy as unknown as typeof fetch },
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await handler(checkoutEvent(scenario('no-flat-number').cart, { 'x-api-key': 'live_key' }));
  const capture: Capture = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  const body = capture.request.body as { giftNote: string };
  expect(body.giftNote).toBe(`Happy birthday Ravi! Any problem with delivery, write to ${fakeEmail('asha.k@example.com')}`);
  expect(capture.redactions).toContainEqual({ path: 'request.body.giftNote', type: 'email' });
  expect(capture.error.stackTop).toMatch(/^formatShippingLabel \(checkout\.ts:\d+\)$/);
  expect(JSON.stringify(capture)).not.toContain('asha.k@example.com');
});
