import { charge } from './paymock.js';
import type { PaymentClient } from './payments.js';
import type { HttpEvent } from '@t2t/shared';

/** PayMock called in-process, for tests and the local server. */
export const inProcessPayments: PaymentClient = { charge: async (req) => charge(req) };

export const LANTERN_CART = {
  items: [
    { sku: 'BK-1042', price: 1299, qty: 1 },
    { sku: 'BK-2210', price: 349.5, qty: 1 },
  ],
  coupon: 'READ15',
  paymentMethod: 'upi' as const,
  customer: { email: 'asha.k@example.com' },
};

export function checkoutEvent(body: unknown, headers: Record<string, string> = {}): HttpEvent {
  return {
    rawPath: '/checkout',
    rawQueryString: '',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    requestContext: { http: { method: 'POST', path: '/checkout' } },
  };
}
