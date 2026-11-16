import type { Capture } from './types.js';

/** The Lantern Books failure as the wrapper sends it. Used by tests and local scripts. */
export function lanternCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    schemaVersion: 1,
    service: 'lantern-checkout',
    capturedAt: '2026-11-14T09:12:44.120Z',
    request: {
      method: 'POST',
      path: '/checkout',
      query: {},
      headers: { 'content-type': 'application/json', 'x-api-key': '[REDACTED:key]' },
      body: {
        items: [
          { sku: 'BK-1042', price: 1299, qty: 1 },
          { sku: 'BK-2210', price: 349.5, qty: 1 },
        ],
        coupon: 'READ15',
        paymentMethod: 'upi',
        customer: { email: 'user_7f3a@redacted.example' },
      },
    },
    response: { status: 500, body: { error: 'Internal error' } },
    error: { name: 'PaymentProviderError', message: 'amount must be an integer', stackTop: 'chargeUpi (checkout.ts:88)' },
    redactions: [
      { path: 'request.headers.x-api-key', type: 'key' },
      { path: 'request.body.customer.email', type: 'email' },
    ],
    runtime: { node: '22.x', codeVersion: '1' },
    ...overrides,
  };
}
