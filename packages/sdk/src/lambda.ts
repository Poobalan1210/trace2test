import { attachedError, rawBody, type Capture, type HttpEvent } from '@t2t/shared';
import { captureFrom, report, shouldCapture, type RequestInfo, type Trace2TestConfig } from './core.js';

interface LambdaLikeResult {
  statusCode?: number;
  body?: string;
}

type Handler<E, R> = (event: E, context?: unknown) => Promise<R>;

const joined = (m: Record<string, string[] | undefined> | null | undefined) =>
  Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v!.join(', ')]));

/**
 * Reads any of the HTTP event shapes Lambda receives: API Gateway HTTP APIs
 * and function URLs (payload v2), REST APIs (payload v1) and ALB targets.
 */
export function fromLambdaEvent(event: HttpEvent): RequestInfo {
  const query: Record<string, string> = {};
  const q = event.queryStringParameters ?? joined(event.multiValueQueryStringParameters);
  for (const [k, v] of Object.entries(q)) if (v !== undefined) query[k] = v;
  return {
    method: event.requestContext?.http?.method ?? event.httpMethod ?? 'GET',
    path: event.rawPath ?? event.requestContext?.http?.path ?? event.path ?? '/',
    query,
    headers: event.headers ?? joined(event.multiValueHeaders),
    body: rawBody(event),
  };
}

/**
 * Wraps a Lambda handler. Successful responses pass through untouched and
 * nothing is recorded. A thrown error or a 5xx is redacted and posted to
 * Trace2Test, then the original response (or error) is returned unchanged.
 */
export function withTrace2Test<E extends HttpEvent, R>(handler: Handler<E, R>, config: Trace2TestConfig): Handler<E, R> {
  return async (event, context) => {
    let result: R | undefined;
    let thrown: unknown;
    let didThrow = false;
    try {
      result = await handler(event, context);
    } catch (err) {
      thrown = err;
      didThrow = true;
    }

    const status = didThrow ? 500 : ((result as LambdaLikeResult | undefined)?.statusCode ?? 200);
    // Lambda freezes once the handler returns, so the capture is sent before it does.
    if (status >= 500 && shouldCapture(config, event)) {
      const r = result as LambdaLikeResult | undefined;
      await report(
        fromLambdaEvent(event),
        didThrow ? undefined : { status: r?.statusCode ?? 500, body: r?.body },
        didThrow ? thrown : attachedError(result),
        config,
      );
    }

    if (didThrow) throw thrown;
    return result as R;
  };
}

/** The capture withTrace2Test would send for this event and result. */
export function buildCapture(
  event: HttpEvent,
  result: LambdaLikeResult | undefined,
  error: unknown,
  config: Pick<Trace2TestConfig, 'service' | 'redact' | 'maxBodyBytes' | 'codeVersion'>,
): Capture {
  return captureFrom(fromLambdaEvent(event), result ? { status: result.statusCode ?? 500, body: result.body } : undefined, error, config);
}
