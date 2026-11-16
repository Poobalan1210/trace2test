import { expect, test } from 'vitest';
import { fingerprint, stackTop } from './fingerprint.js';

test('fingerprint is 12 hex chars and stable', () => {
  const c = { service: 'lantern-checkout', request: { method: 'POST', path: '/checkout' }, error: { name: 'E', stackTop: 'f (a.ts:1)' } };
  const a = fingerprint(c as never);
  expect(a).toMatch(/^[0-9a-f]{12}$/);
  expect(fingerprint(c as never)).toBe(a);
  expect(fingerprint({ ...c, request: { ...c.request, path: '/other' } } as never)).not.toBe(a);
});

test('stackTop names the first application frame', () => {
  const err = new Error('x');
  err.stack = 'Error: x\n    at async chargeUpi (/var/task/services/shop/src/checkout.ts:88:11)\n    at handler (/var/task/index.mjs:5:1)';
  expect(stackTop(err)).toBe('chargeUpi (checkout.ts:88)');
  err.stack = 'Error: x\n    at /var/task/index.mjs:12:3';
  expect(stackTop(err)).toBe('<anonymous> (index.mjs:12)');
  expect(stackTop('not an error')).toBe('');
});
