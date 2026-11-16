import { bodyText, report, shouldCapture, splitUrl, type HeaderMap, type Trace2TestConfig } from './core.js';

/*
 * Express (4 and 5) and anything Connect-shaped. The types are structural so
 * the SDK does not depend on Express itself.
 *
 *   const t2t = trace2testExpress(config);
 *   app.use(t2t.capture);          // first, before your routes
 *   app.use(express.json());
 *   ...routes...
 *   app.use(t2t.recordErrors);     // after your routes, before your error handler
 *
 * The capture is posted after the response has gone out, so it never delays
 * the customer. The request body is whatever the body parser left on req.body.
 */

export interface ExpressLikeRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: HeaderMap;
  body?: unknown;
}

export interface ExpressLikeResponse {
  statusCode: number;
  write: (...args: never[]) => unknown;
  end: (...args: never[]) => unknown;
  on(event: 'finish', listener: () => void): unknown;
}

type Next = (err?: unknown) => void;
type AnyFn = (...args: unknown[]) => unknown;

export function trace2testExpress(config: Trace2TestConfig) {
  const errors = new WeakMap<object, unknown>();
  const max = config.maxBodyBytes ?? 262144;

  function capture(req: ExpressLikeRequest, res: ExpressLikeResponse, next: Next) {
    if (!shouldCapture(config, req)) return next();

    // Keep the response body only once the status says it failed; by the first write the status is fixed.
    const chunks: Buffer[] = [];
    let size = 0;
    const keep = (chunk: unknown, encoding: unknown) => {
      if (res.statusCode < 500 || chunk == null || typeof chunk === 'function' || size > max) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
      size += buf.length;
      if (size <= max) chunks.push(buf);
    };
    const write = res.write as unknown as AnyFn;
    const end = res.end as unknown as AnyFn;
    (res as unknown as { write: AnyFn }).write = function (this: unknown, ...args: unknown[]) {
      keep(args[0], args[1]);
      return write.apply(this, args);
    };
    (res as unknown as { end: AnyFn }).end = function (this: unknown, ...args: unknown[]) {
      keep(args[0], args[1]);
      return end.apply(this, args);
    };

    res.on('finish', () => {
      if (res.statusCode < 500) return;
      const { path, query } = splitUrl(req.originalUrl ?? req.url ?? '/');
      void report(
        { method: req.method ?? 'GET', path, query, headers: req.headers, body: bodyText(req.body) },
        { status: res.statusCode, body: size <= max ? Buffer.concat(chunks).toString('utf8') : undefined },
        errors.get(res),
        config,
      );
    });
    next();
  }

  /** Remembers the error for the capture, then hands it on unchanged. */
  function recordErrors(err: unknown, _req: ExpressLikeRequest, res: ExpressLikeResponse, next: Next) {
    errors.set(res, err);
    next(err);
  }

  return { capture, recordErrors };
}
