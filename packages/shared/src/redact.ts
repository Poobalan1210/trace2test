import { createHash } from 'node:crypto';
import type { Redaction, RedactionType } from './types.js';
import { REDACTED_DOMAIN, TEST_CARD, TEST_PHONE, isDroppedHeader, type PatternName, type RedactRules } from './rules.js';

export { DEFAULT_RULES, REDACTED_DOMAIN, TEST_CARD, TEST_PHONE, isDroppedHeader } from './rules.js';
export type { PatternName, RedactRules } from './rules.js';

export function fakeEmail(original: string): string {
  const hash = createHash('sha256').update(original.trim().toLowerCase()).digest('hex').slice(0, 4);
  return `user_${hash}@${REDACTED_DOMAIN}`;
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 13 to 19 digits, optionally grouped with single spaces or dashes.
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9._~+/=-]+/gi;

/** Values that are already the output of a redaction, so a second pass leaves them alone. */
function isPlaceholder(value: string): boolean {
  return value.startsWith('[REDACTED:') || value === TEST_CARD || value === TEST_PHONE || value.endsWith('@' + REDACTED_DOMAIN);
}

/** Replaces pattern matches inside one string; reports one redaction per match. */
export function redactString(value: string, patterns: PatternName[], onMatch: (type: RedactionType) => void): string {
  let out = value;
  if (patterns.includes('jwt')) {
    out = out.replace(JWT_RE, () => (onMatch('jwt'), '[REDACTED:jwt]'));
  }
  if (patterns.includes('bearer')) {
    out = out.replace(BEARER_RE, () => (onMatch('bearer'), '[REDACTED:bearer]'));
  }
  if (patterns.includes('email')) {
    out = out.replace(EMAIL_RE, (m) => (m.endsWith('@' + REDACTED_DOMAIN) ? m : (onMatch('email'), fakeEmail(m))));
  }
  if (patterns.includes('card')) {
    out = out.replace(CARD_RE, (m) => {
      const digits = m.replace(/[ -]/g, '');
      if (digits === TEST_CARD || digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m;
      onMatch('card');
      return TEST_CARD;
    });
  }
  return out;
}

function typeForKey(key: string): RedactionType {
  const k = key.toLowerCase();
  if (k.includes('email')) return 'email';
  if (k.includes('phone')) return 'phone';
  if (k === 'cardnumber' || k === 'card_number' || k === 'pan') return 'card';
  if (k === 'cvv' || k === 'cvc') return 'card';
  if (k === 'cookie' || k === 'set-cookie') return 'cookie';
  if (k.includes('password')) return 'password';
  if (k === 'x-api-key' || k.endsWith('key')) return 'key';
  if (k === 'authorization' || k.includes('token')) return 'token';
  return 'secret';
}

/** The replacement keeps the value valid so a replay still passes input validation. */
function replacementForKey(key: string, value: unknown): { value: unknown; type: RedactionType } {
  const type = typeForKey(key);
  const k = key.toLowerCase();
  if (typeof value === 'string') {
    if (type === 'email') return { value: fakeEmail(value), type };
    if (type === 'phone') return { value: TEST_PHONE, type };
    if (type === 'card' && k !== 'cvv' && k !== 'cvc') return { value: TEST_CARD, type };
  }
  return { value: `[REDACTED:${type}]`, type };
}

function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : parent ? `${parent}.${key}` : key;
}

/**
 * Walks any JSON value and redacts it in a copy. Key rules apply at any depth,
 * ignoring case; pattern rules scan every string that is left.
 */
export function redactValue(value: unknown, rules: RedactRules, path: string, out: Redaction[]): unknown {
  const keys = new Set(rules.keys.map((k) => k.toLowerCase()));
  const walk = (v: unknown, p: string): unknown => {
    if (typeof v === 'string') {
      if (isPlaceholder(v)) return v;
      return redactString(v, rules.patterns, (type) => out.push({ path: p, type }));
    }
    if (Array.isArray(v)) return v.map((item, i) => walk(item, childPath(p, i)));
    if (v && typeof v === 'object') {
      const copy: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) {
        const cp = childPath(p, k);
        if (keys.has(k.toLowerCase()) && child !== null && child !== undefined && !(typeof child === 'string' && isPlaceholder(child))) {
          const r = replacementForKey(k, child);
          out.push({ path: cp, type: r.type });
          copy[k] = r.value;
        } else {
          copy[k] = walk(child, cp);
        }
      }
      return copy;
    }
    return v;
  };
  return walk(value, path);
}

export function redactHeaders(
  headers: Record<string, string | undefined>,
  rules: RedactRules,
  path: string,
  out: Redaction[],
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || isDroppedHeader(k)) continue;
    kept[k.toLowerCase()] = v;
  }
  return redactValue(kept, rules, path, out) as Record<string, string>;
}
