import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCheckoutHandler } from './checkout.js';
import { inProcessPayments } from './testing.js';
import { STOCK } from './catalog.js';

/**
 * Lantern Books checkout on a local port, with PayMock in-process. Used to
 * run replays and generated tests without a deployed staging service.
 */
export async function startLocalShop(opts: { apiKey: string; fixed: boolean; stage?: 'prod' | 'staging'; port?: number }): Promise<{ url: string; server: Server }> {
  const handler = createCheckoutHandler({
    payments: inProcessPayments,
    apiKey: opts.apiKey,
    inventory: STOCK[opts.stage ?? 'staging'],
    fixUpiRounding: opts.fixed,
    fixAddressLine2: opts.fixed,
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'POST' || url.pathname !== '/checkout') {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}');
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    const out = await handler({
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      body: Buffer.concat(chunks).toString('utf8'),
      requestContext: { http: { method: req.method, path: url.pathname } },
    });
    res.writeHead(out.statusCode, out.headers).end(out.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}
