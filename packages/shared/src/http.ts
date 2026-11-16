import { timingSafeEqual, createHash } from 'node:crypto';

/**
 * The subset of a Lambda HTTP event that our handlers read. HTTP APIs and
 * function URLs send payload v2 (rawPath, requestContext.http); REST APIs and
 * ALB targets send v1 (httpMethod, path, optionally multi-value maps).
 */
export interface HttpEvent {
  rawPath?: string;
  httpMethod?: string;
  path?: string;
  multiValueHeaders?: Record<string, string[] | undefined> | null;
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null;
  rawQueryString?: string;
  headers?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string; path?: string } };
}

export interface HttpResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/** Header lookup that ignores case, since API Gateway lower-cases but local tools may not. */
export function header(event: HttpEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === wanted) return v;
  }
  return undefined;
}

export function rawBody(event: HttpEvent): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

/** Parses a JSON body; returns undefined when it is missing or not JSON. */
export function parseJsonBody(event: HttpEvent): unknown {
  const text = rawBody(event);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function method(event: HttpEvent): string {
  return (event.requestContext?.http?.method ?? event.httpMethod ?? 'GET').toUpperCase();
}

export function path(event: HttpEvent): string {
  return event.rawPath ?? event.requestContext?.http?.path ?? event.path ?? '/';
}

/**
 * Constant-time secret comparison. Both sides are hashed first so that
 * unequal lengths do not short-circuit and leak the secret's length.
 */
export function secretsEqual(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A handler that answers an unexpected failure with its own 500 can still tell
 * Trace2Test what went wrong: the error rides along under a symbol key, which
 * JSON serialisation (and so the real HTTP response) ignores.
 */
export const ERROR_SYMBOL = Symbol.for('trace2test.error');

export function serverError(err: unknown, body: unknown = { error: 'Internal error' }): HttpResult {
  const result = json(500, body);
  Object.defineProperty(result, ERROR_SYMBOL, { value: err, enumerable: false });
  return result;
}

export function attachedError(result: unknown): unknown {
  return result && typeof result === 'object' ? (result as Record<symbol, unknown>)[ERROR_SYMBOL] : undefined;
}
