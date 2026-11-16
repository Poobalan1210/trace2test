import {
  DEFAULT_RULES, redactHeaders, redactValue, stackTop,
  type Capture, type PatternName, type Redaction,
} from '@t2t/shared';

/**
 * The framework-neutral part of the SDK. Each adapter (Lambda, Express,
 * Fastify) turns its request into a RequestInfo, and everything from there
 * on, redaction, the capture shape and posting it, happens here.
 */

export interface Trace2TestConfig {
  ingestUrl: string | undefined;
  ingestKey: string | undefined;
  service: string;
  /** 'prod' or 'production' captures; any other stage does not, so a replay on staging cannot loop. */
  stage: string | undefined;
  /** Overrides the stage check when set. */
  enabled?: boolean;
  redact?: { keys?: string[]; patterns?: PatternName[] };
  maxBodyBytes?: number;
  /** Budget for posting a capture. Lambda waits for it; Express and Fastify post after the response is sent. */
  timeoutMs?: number;
  codeVersion?: string;
  fetch?: typeof fetch;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

/** The header Trace2Test sets on every replayed request. */
export const REPLAY_HEADER = 'x-t2t-replay';

export type HeaderMap = Record<string, string | string[] | undefined>;

/** One request, already pulled out of whatever framework received it. */
export interface RequestInfo {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: HeaderMap;
  /** The body as text, or '' when there was none. */
  body: string;
}

export interface ResponseInfo {
  status: number;
  /** Response body as text, if one was sent. */
  body?: string;
}

const PROD_STAGES = ['prod', 'production'];

function headerValue(headers: HeaderMap | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * True when this request is a Trace2Test replay. Use it to skip side effects
 * on staging (emails, payments, webhooks) while still running the code path.
 * Takes a Lambda event, an Express or Fastify request, or anything with headers.
 */
export function isReplay(request: { headers?: HeaderMap | null } | null | undefined): boolean {
  return !!headerValue(request?.headers ?? undefined, REPLAY_HEADER);
}

export function shouldCapture(config: Trace2TestConfig, request: { headers?: HeaderMap | null }): boolean {
  const on = config.enabled ?? PROD_STAGES.includes(config.stage ?? '');
  return on && !!config.ingestUrl && !!config.ingestKey && !isReplay(request);
}

export function defaultLog(msg: string, detail?: Record<string, unknown>) {
  console.warn(`[trace2test] ${msg}`, detail ?? '');
}

/** Multi-value headers are joined the way HTTP would fold them. */
export function flatHeaders(headers: HeaderMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function parseJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** An API Gateway-style answer for a request whose handler threw before responding. */
export const THROWN_RESPONSE = { status: 500, body: { message: 'Internal Server Error' } };

export function captureFrom(
  request: RequestInfo,
  response: ResponseInfo | undefined,
  error: unknown,
  config: Pick<Trace2TestConfig, 'service' | 'redact' | 'maxBodyBytes' | 'codeVersion'>,
): Capture {
  const rules = {
    keys: config.redact?.keys ?? DEFAULT_RULES.keys,
    patterns: config.redact?.patterns ?? DEFAULT_RULES.patterns,
  };
  const maxBody = config.maxBodyBytes ?? 262144;
  const redactions: Redaction[] = [];

  let body: unknown = null;
  let bodyOmitted = false;
  if (request.body) {
    if (Buffer.byteLength(request.body) > maxBody) {
      bodyOmitted = true;
    } else {
      try {
        body = JSON.parse(request.body);
      } catch {
        bodyOmitted = true;
      }
    }
  }

  const captured = {
    method: request.method.toUpperCase(),
    path: request.path || '/',
    query: redactValue(request.query, rules, 'request.query', redactions) as Record<string, string>,
    headers: redactHeaders(flatHeaders(request.headers), rules, 'request.headers', redactions),
    body: bodyOmitted ? null : redactValue(body, rules, 'request.body', redactions),
    ...(bodyOmitted ? { bodyOmitted: true } : {}),
  };

  const res = response
    ? { status: response.status, body: redactValue(parseJson(response.body), rules, 'response.body', redactions) }
    : THROWN_RESPONSE;

  const err = error instanceof Error ? error : undefined;
  return {
    schemaVersion: 1,
    service: config.service,
    capturedAt: new Date().toISOString(),
    request: captured,
    response: res,
    error: err
      ? {
          name: err.name,
          // Messages can carry user input, so they get the pattern pass too.
          message: redactValue(err.message, rules, 'error.message', redactions) as string,
          stackTop: stackTop(err),
        }
      : { name: 'HttpError', message: `HTTP ${res.status}`, stackTop: '' },
    redactions,
    runtime: {
      node: `${process.versions.node.split('.')[0]}.x`,
      codeVersion: config.codeVersion ?? process.env.AWS_LAMBDA_FUNCTION_VERSION ?? 'unknown',
    },
  };
}

export async function postCapture(capture: Capture, config: Trace2TestConfig): Promise<void> {
  const doFetch = config.fetch ?? fetch;
  const budget = config.timeoutMs ?? 1500;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race as well as abort, so a fetch that ignores its signal still cannot hold the response.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('ingest timed out'));
    }, budget);
  });
  try {
    const res = await Promise.race([
      doFetch(config.ingestUrl!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-t2t-ingest-key': config.ingestKey! },
        body: JSON.stringify(capture),
        signal: controller.signal,
      }),
      deadline,
    ]);
    if (res.status >= 300) throw new Error(`ingest answered ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Builds and posts a capture. Never throws: a failure is logged and the caller carries on. */
export async function report(request: RequestInfo, response: ResponseInfo | undefined, error: unknown, config: Trace2TestConfig): Promise<void> {
  const log = config.log ?? defaultLog;
  try {
    await postCapture(captureFrom(request, response, error, config), config);
  } catch (err) {
    log('capture not sent', { error: (err as Error)?.name ?? 'unknown' });
  }
}

/** Splits a request URL (path plus query string) into its parts. */
export function splitUrl(url: string): { path: string; query: Record<string, string> } {
  const parsed = new URL(url, 'http://localhost');
  return { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) };
}

/** Turns a parsed body back into text; frameworks hand it over as an object, a string or a Buffer. */
export function bodyText(body: unknown): string {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}
