/**
 * The redaction rules as data. Kept free of Node imports so the dashboard's
 * setup page can show exactly what the wrapper and the Sanitize step apply.
 */
export type PatternName = 'email' | 'card' | 'jwt' | 'bearer';

export interface RedactRules {
  keys: string[];
  patterns: PatternName[];
}

export const DEFAULT_RULES: RedactRules = {
  keys: ['authorization', 'cookie', 'x-api-key', 'password', 'token', 'cardNumber', 'cvv', 'email', 'phone'],
  patterns: ['email', 'card', 'jwt', 'bearer'],
};

/**
 * The spec's list (who called, and through which path), plus transport
 * headers that say nothing about the request and would only add noise to
 * the replay and the generated test.
 */
export const DROPPED_HEADERS = [
  'x-forwarded-for', 'x-amzn-trace-id', 'user-agent', 'cloudfront-*',
  'host', 'connection', 'content-length', 'accept-encoding', 'forwarded', 'via',
  'x-forwarded-*', 'x-real-ip', 'x-amz-cf-id', 'sec-*',
];

/** Headers that identify the caller or the network path and are never kept. */
export function isDroppedHeader(name: string): boolean {
  const n = name.toLowerCase();
  return DROPPED_HEADERS.some((h) => (h.endsWith('*') ? n.startsWith(h.slice(0, -1)) : n === h));
}

export const REDACTED_DOMAIN = 'redacted.example';
export const TEST_CARD = '4111111111111111';
export const TEST_PHONE = '+10000000000';
