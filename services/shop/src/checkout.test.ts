import { describe, expect, test } from 'vitest';
import { attachedError } from '@t2t/shared';
import { createCheckoutHandler, PaymentProviderError } from './checkout.js';
import { orderTotal, STOCK } from './catalog.js';
import { SCENARIOS, scenario } from './scenarios.js';
import { inProcessPayments, LANTERN_CART, checkoutEvent } from './testing.js';

const KEY = 'test-key';
const handler = (inventory: typeof STOCK.prod, fix: boolean) =>
  createCheckoutHandler({ payments: inProcessPayments, apiKey: KEY, inventory, fixUpiRounding: fix, fixAddressLine2: fix });
const buggy = handler(STOCK.staging, false);
const fixed = handler(STOCK.staging, true);
const prod = handler(STOCK.prod, false);
const send = (h: typeof buggy, body: unknown) => h(checkoutEvent(body, { 'x-api-key': KEY }));

describe('Lantern Books checkout', () => {
  test('the READ15 cart totals to fractional paise', () => {
    expect(orderTotal(LANTERN_CART.items, 'READ15') * 100).toBe(140122.5);
  });

  test('READ15 + UPI fails with a 500 before the fix', async () => {
    const res = await send(buggy, LANTERN_CART);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body!)).toEqual({ error: 'Internal error' });
    const err = attachedError(res);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as Error).message).toBe('amount must be an integer');
  });

  test('the same cart paid by card succeeds', async () => {
    const res = await send(buggy, { ...LANTERN_CART, paymentMethod: 'card' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).amountPaise).toBe(140123);
  });

  test('the same coupon with round prices succeeds by UPI', async () => {
    const res = await send(buggy, { ...LANTERN_CART, items: [{ sku: 'BK-3001', price: 1000, qty: 1 }, { sku: 'BK-3002', price: 200, qty: 1 }] });
    expect(res.statusCode).toBe(200);
  });

  test('READ15 + UPI passes after the fix', async () => {
    const res = await send(fixed, LANTERN_CART);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).amountPaise).toBe(140123);
  });

  test('rejects a missing or wrong API key', async () => {
    expect((await buggy(checkoutEvent(LANTERN_CART))).statusCode).toBe(401);
    expect((await buggy(checkoutEvent(LANTERN_CART, { 'x-api-key': 'nope' }))).statusCode).toBe(401);
  });

  test('rejects malformed carts with 400', async () => {
    expect((await send(buggy, { ...LANTERN_CART, items: [] })).statusCode).toBe(400);
    expect((await send(buggy, { ...LANTERN_CART, coupon: 'FREEBOOKS' })).statusCode).toBe(400);
    expect((await send(buggy, { ...LANTERN_CART, paymentMethod: 'cash' })).statusCode).toBe(400);
  });

  test('labels replayed orders', async () => {
    const res = await fixed(checkoutEvent(LANTERN_CART, { 'x-api-key': KEY, 'x-t2t-replay': '01ABC' }));
    expect(JSON.parse(res.body!).replay).toBe(true);
  });
});

describe('demo scenarios', () => {
  // [production, staging with the bugs, staging with the fixes]
  const expected: Record<string, [number, number, number]> = {
    'upi-coupon': [500, 500, 200],
    'no-flat-number': [500, 500, 200],
    'sold-out-in-prod': [500, 200, 200],
    'failure-storm': [500, 500, 200],
    'happy-path': [200, 200, 200],
  };

  test('every scenario has an expectation', () => {
    expect(SCENARIOS.map((x) => x.id).sort()).toEqual(Object.keys(expected).sort());
  });

  test.each(SCENARIOS.map((x) => [x.id, x] as const))('%s behaves as described in each environment', async (id, sc) => {
    const statuses = await Promise.all([prod, buggy, fixed].map(async (h) => (await send(h, sc.cart)).statusCode));
    expect(statuses).toEqual(expected[id]);
  });

  test('the address bug and the stock bug fail with their own errors', async () => {
    const address = attachedError(await send(prod, scenario('no-flat-number').cart)) as Error;
    expect(address).toBeInstanceOf(TypeError);
    expect(address.message).toMatch(/reading 'trim'/);
    const stock = attachedError(await send(prod, scenario('sold-out-in-prod').cart)) as Error;
    expect(stock.message).toMatch(/reading 'id'/);
  });
});
