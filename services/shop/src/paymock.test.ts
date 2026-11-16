import { expect, test } from 'vitest';
import { charge } from './paymock.js';

test('PayMock rejects fractional paise', () => {
  expect(charge({ amount: 140122.5, currency: 'INR', method: 'upi', reference: 'r' })).toEqual({
    status: 400,
    body: { error: 'amount must be an integer' },
  });
});

test('PayMock captures whole paise', () => {
  const res = charge({ amount: 140123, currency: 'INR', method: 'upi', reference: 'r' });
  expect(res.status).toBe(200);
});
