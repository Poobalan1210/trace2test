import { describe, expect, test } from 'vitest';
import { DEFAULT_RULES, fakeEmail, luhnValid, redactHeaders, redactValue, TEST_CARD } from './redact.js';
import type { Redaction } from './types.js';

const run = (v: unknown, path = 'request.body') => {
  const out: Redaction[] = [];
  const value = redactValue(v, DEFAULT_RULES, path, out);
  return { value, out };
};

describe('key-based redaction', () => {
  test('email key gets a stable fake address', () => {
    const { value, out } = run({ customer: { email: 'asha.k@example.com' } });
    expect(value).toEqual({ customer: { email: fakeEmail('asha.k@example.com') } });
    expect(fakeEmail('asha.k@example.com')).toMatch(/^user_[0-9a-f]{4}@redacted\.example$/);
    expect(out).toEqual([{ path: 'request.body.customer.email', type: 'email' }]);
  });

  test('equal emails stay equal, case-insensitively', () => {
    expect(fakeEmail('A@B.com')).toBe(fakeEmail('a@b.com'));
    expect(fakeEmail('a@b.com')).not.toBe(fakeEmail('c@d.com'));
  });

  test('card, phone, password, token and cvv keys', () => {
    const { value, out } = run({ cardNumber: '5555 5555 5555 4444', phone: '+91 98765 43210', password: 'hunter2', token: 'abc', cvv: '123' });
    expect(value).toEqual({
      cardNumber: TEST_CARD,
      phone: '+10000000000',
      password: '[REDACTED:password]',
      token: '[REDACTED:token]',
      cvv: '[REDACTED:card]',
    });
    expect(out.map((r) => r.type)).toEqual(['card', 'phone', 'password', 'token', 'card']);
  });

  test('keys match at any depth and ignore case', () => {
    const { value, out } = run({ a: { b: [{ PassWord: 'x' }, { nested: { EMAIL: 'q@w.io' } }] } });
    expect(value).toEqual({ a: { b: [{ PassWord: '[REDACTED:password]' }, { nested: { EMAIL: fakeEmail('q@w.io') } }] } });
    expect(out.map((r) => r.path)).toEqual(['request.body.a.b[0].PassWord', 'request.body.a.b[1].nested.EMAIL']);
  });

  test('non-string secret values are replaced whole', () => {
    expect(run({ token: { id: 1 } }).value).toEqual({ token: '[REDACTED:token]' });
  });
});

describe('pattern-based redaction', () => {
  test('emails inside free text', () => {
    const { value, out } = run({ note: 'call me at dev@lantern.example.org please' });
    expect(value).toEqual({ note: `call me at ${fakeEmail('dev@lantern.example.org')} please` });
    expect(out).toEqual([{ path: 'request.body.note', type: 'email' }]);
  });

  test('Luhn-valid card numbers only', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    const { value, out } = run({ memo: 'card 4242-4242-4242-4242 ok', order: '1234567890123' });
    expect(value).toEqual({ memo: `card ${TEST_CARD} ok`, order: '1234567890123' });
    expect(out).toHaveLength(1);
  });

  test('JWTs and bearer tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const { value } = run({ a: `t=${jwt}`, b: 'Bearer abc.def-123' });
    expect(value).toEqual({ a: 't=[REDACTED:jwt]', b: '[REDACTED:bearer]' });
  });

  test('a string holding two secrets records both', () => {
    const { value, out } = run({ msg: 'from a@x.io card 4242424242424242' });
    expect(value).toEqual({ msg: `from ${fakeEmail('a@x.io')} card ${TEST_CARD}` });
    expect(out).toEqual([
      { path: 'request.body.msg', type: 'email' },
      { path: 'request.body.msg', type: 'card' },
    ]);
  });

  test('arrays of strings', () => {
    const { value, out } = run({ cc: ['a@x.io', 'plain', 'b@y.io'] });
    expect(value).toEqual({ cc: [fakeEmail('a@x.io'), 'plain', fakeEmail('b@y.io')] });
    expect(out.map((r) => r.path)).toEqual(['request.body.cc[0]', 'request.body.cc[2]']);
  });

  test('a second pass leaves placeholders alone', () => {
    const first = run({ email: 'a@x.io', cardNumber: '4242424242424242', note: 'Bearer xyz' });
    const second = run(first.value);
    expect(second.value).toEqual(first.value);
    expect(second.out).toEqual([]);
  });

  test('never records the original value', () => {
    const { out } = run({ email: 'secret.person@example.com' });
    expect(JSON.stringify(out)).not.toContain('secret');
  });
});

describe('headers', () => {
  test('drops identifying headers and redacts secrets', () => {
    const out: Redaction[] = [];
    const h = redactHeaders(
      {
        'Content-Type': 'application/json',
        'X-Api-Key': 'live_abc',
        authorization: 'Bearer abc',
        'x-forwarded-for': '1.2.3.4',
        'x-amzn-trace-id': 'Root=1',
        'user-agent': 'curl',
        'cloudfront-viewer-country': 'IN',
        host: 'abc.execute-api.ap-south-1.amazonaws.com',
        'x-forwarded-proto': 'https',
        'content-length': '172',
        'sec-fetch-mode': 'cors',
      },
      DEFAULT_RULES,
      'request.headers',
      out,
    );
    expect(h).toEqual({ 'content-type': 'application/json', 'x-api-key': '[REDACTED:key]', authorization: '[REDACTED:token]' });
    expect(out).toEqual([
      { path: 'request.headers.x-api-key', type: 'key' },
      { path: 'request.headers.authorization', type: 'token' },
    ]);
  });
});
