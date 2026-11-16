import { bodyText, report, shouldCapture, splitUrl, type HeaderMap, type Trace2TestConfig } from './core.js';

/*
 * Fastify 4 and 5. Call it on the root instance before registering routes,
 * so the hooks apply to every route:
 *
 *   trace2testFastify(app, config);
 *
 * The capture is posted from onResponse, after the reply has gone out.
 */

export interface FastifyLikeRequest {
  method: string;
  url: string;
  headers: HeaderMap;
  body?: unknown;
}

export interface FastifyLikeReply {
  statusCode: number;
}

export interface FastifyLikeInstance {
  addHook(name: string, hook: (...args: never[]) => unknown): unknown;
}

export function trace2testFastify(app: FastifyLikeInstance, config: Trace2TestConfig): void {
  const errors = new WeakMap<object, unknown>();
  const payloads = new WeakMap<object, string>();

  const onError = async (req: FastifyLikeRequest, _reply: FastifyLikeReply, err: unknown) => {
    errors.set(req, err);
  };
  const onSend = async (req: FastifyLikeRequest, reply: FastifyLikeReply, payload: unknown) => {
    if (reply.statusCode >= 500 && (typeof payload === 'string' || Buffer.isBuffer(payload))) payloads.set(req, bodyText(payload));
    return payload;
  };
  const onResponse = async (req: FastifyLikeRequest, reply: FastifyLikeReply) => {
    if (reply.statusCode < 500 || !shouldCapture(config, req)) return;
    const { path, query } = splitUrl(req.url);
    void report(
      { method: req.method, path, query, headers: req.headers, body: bodyText(req.body) },
      { status: reply.statusCode, body: payloads.get(req) },
      errors.get(req),
      config,
    );
  };

  app.addHook('onError', onError as never);
  app.addHook('onSend', onSend as never);
  app.addHook('onResponse', onResponse as never);
}
