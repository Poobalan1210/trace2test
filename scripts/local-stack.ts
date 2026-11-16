/**
 * The whole of Trace2Test on localhost, with no AWS account:
 *
 *   :8787  t2t-api      ingest + dashboard API (real handlers, in-memory stores)
 *   :8788  shop-prod    Lantern Books checkout with the bug, wrapped with withTrace2Test
 *   :8789  shop-staging Lantern Books checkout, never captures
 *
 * The state machine is emulated in-process: the five real task functions run
 * in order, and its direct DynamoDB steps (SaveResult and friends) are copied
 * here as plain updates. Usage:
 *
 *   npm run dev          (this, plus the dashboard on http://localhost:5173)
 *   npm run local:stack  (this alone)
 *
 * POST http://localhost:8787/__local/staging-fix toggles the fix on staging
 * (or sets it with {"on": true|false}); GET reads it. The dashboard uses both.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { withTrace2Test } from '@trace2test/sdk';
import { memoryIncidentStore, memoryObjectStore, type Workflow } from '@t2t/aws';
import type { HttpEvent, HttpResult } from '@t2t/shared';
import { createCheckoutHandler } from '../services/shop/src/checkout.js';
import { trace2testConfig } from '../services/shop/src/config.js';
import { STOCK } from '../services/shop/src/catalog.js';
import { inProcessPayments } from '../services/shop/src/testing.js';
import { createIngestHandler } from '../services/ingest/src/ingest.js';
import { createApiHandler } from '../services/api/src/api.js';
import { compare, deliver, generate, replay, sanitize, validate, type TaskDeps } from '../services/pipeline/src/tasks.js';
import { parseDelivery } from '../services/pipeline/src/github.js';

const KEYS = { ingest: 'local-ingest-key', dashboard: 'local-dashboard-token', prod: 'local-prod-key', staging: 'local-staging-key' };
const PORTS = { api: 8787, prod: 8788, staging: 8789 };
const ORIGIN = 'http://localhost:5173';
let stagingHasFix = process.env.STAGING_HAS_FIX === 'true';

const incidents = memoryIncidentStore();
const objects = memoryObjectStore();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const taskDeps: TaskDeps = {
  incidents, objects, stagingApiKey: KEYS.staging,
  targets: { 'lantern-checkout': { baseUrl: `http://127.0.0.1:${PORTS.staging}`, routes: ['POST /checkout'] } },
  // Optional: DELIVERY_TARGETS='{"lantern-checkout":{"repo":"you/sandbox"}}' GITHUB_TOKEN=... opens real pull requests.
  delivery: parseDelivery(process.env.DELIVERY_TARGETS),
  github: process.env.GITHUB_TOKEN ? { token: async () => process.env.GITHUB_TOKEN! } : undefined,
  dashboardUrl: 'http://localhost:5173',
};

/** Emulates t2t-pipeline: the same states, in the same order, with the same writes. */
async function runPipeline(incidentId: string, mode: 'capture' | 'verify') {
  const input = { incidentId, mode };
  try {
    if (mode === 'capture') {
      await pause(300);
      const s = await sanitize(taskDeps, input);
      const v = await validate(taskDeps, input);
      if (!v.replayable && !v.testable) {
        await incidents.update(incidentId, { status: 'NOT_REPLAYABLE', reason: v.reason });
        return;
      }
      if (!v.replayable) {
        const g = await generate(taskDeps, input);
        await deliver(taskDeps, input);
        await incidents.update(incidentId, { status: g.finalStatus as 'TEST_UNVERIFIED' });
        await incidents.addMetrics({ testsGenerated: 1, leaks: s.leakCount, redactions: s.leakCount, pipelineMsTotal: g.captureToTestMs });
        return;
      }
      await pause(300);
      await replay(taskDeps, input);
      const c = await compare(taskDeps, input);
      let generated = 0;
      let ms = 0;
      if (c.verdict === 'REPRODUCED') {
        await pause(300);
        const g = await generate(taskDeps, input);
        await deliver(taskDeps, input);
        generated = 1;
        ms = g.captureToTestMs;
      }
      await incidents.update(incidentId, { status: generated ? 'TEST_READY' : 'NOT_REPRODUCED', verdict: c.verdict });
      await incidents.addMetrics({ replayable: 1, reproduced: c.reproduced, testsGenerated: generated, leaks: s.leakCount, redactions: s.leakCount, pipelineMsTotal: ms });
    } else {
      await pause(300);
      await replay(taskDeps, input);
      const c = await compare(taskDeps, input);
      const inc = await incidents.get(incidentId);
      const now = new Date().toISOString();
      await incidents.update(incidentId, { status: c.verdict === 'FIXED' ? 'FIXED' : 'STILL_FAILING', verifiedAt: now, stagingStatus: c.stagingStatus });
      if (c.verdict === 'FIXED' && !inc?.fixedAt) {
        await incidents.update(incidentId, { fixedAt: now });
        await incidents.addMetrics({ fixed: 1 });
        await deliver(taskDeps, input);
      }
    }
  } catch (err) {
    await incidents.update(incidentId, { status: 'PIPELINE_FAILED', failure: { error: (err as Error).name, cause: (err as Error).message } }).catch(() => {});
  }
}

const workflow: Workflow = {
  async start(name, input) {
    setTimeout(() => void runPipeline(input.incidentId, input.mode), 0);
    return `arn:aws:states:local:000000000000:execution:t2t-pipeline:${name}`;
  },
};

const ingest = createIngestHandler({ incidents, objects, workflow, ingestKey: KEYS.ingest });
const api = createApiHandler({
  incidents, objects, workflow, dashboardToken: KEYS.dashboard,
  shopProdUrl: `http://127.0.0.1:${PORTS.prod}`, prodApiKey: KEYS.prod,
});
const prod = withTrace2Test(
  createCheckoutHandler({ payments: inProcessPayments, apiKey: KEYS.prod, inventory: STOCK.prod, fixUpiRounding: false, fixAddressLine2: false }),
  { ...trace2testConfig(), ingestUrl: `http://127.0.0.1:${PORTS.api}/incidents`, ingestKey: KEYS.ingest, stage: 'prod', codeVersion: 'local' },
);
const staging = (event: HttpEvent) =>
  createCheckoutHandler({ payments: inProcessPayments, apiKey: KEYS.staging, inventory: STOCK.staging, fixUpiRounding: stagingHasFix, fixAddressLine2: stagingHasFix })(event);

async function toEvent(req: IncomingMessage): Promise<HttpEvent> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  return {
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers,
    body: Buffer.concat(chunks).toString('utf8') || undefined,
    requestContext: { http: { method: req.method ?? 'GET', path: url.pathname } },
  };
}

function send(res: ServerResponse, out: HttpResult, cors = false) {
  res.writeHead(out.statusCode, { ...(out.headers ?? {}), ...(cors ? { 'access-control-allow-origin': ORIGIN } : {}) }).end(out.body ?? '');
}

function serve(port: number, handle: (event: HttpEvent, req: IncomingMessage) => Promise<HttpResult>, cors = false) {
  createServer(async (req, res) => {
    if (cors && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-headers': 'content-type, x-t2t-token',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      }).end();
      return;
    }
    try {
      send(res, await handle(await toEvent(req), req), cors);
    } catch (err) {
      console.error(err);
      send(res, { statusCode: 500, body: '{"message":"Internal Server Error"}' }, cors);
    }
  }).listen(port, '127.0.0.1');
}

serve(PORTS.api, async (event) => {
  if (event.rawPath === '/incidents' && event.requestContext?.http?.method === 'POST') return ingest(event);
  if (event.rawPath === '/__local/staging-fix' && event.requestContext?.http?.method === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ stagingHasFix }) };
  }
  if (event.rawPath === '/__local/staging-fix' && event.requestContext?.http?.method === 'POST') {
    // {"on": true|false} sets it; an empty body toggles, as the curl one-liner expects.
    let on: unknown;
    try {
      on = event.body ? (JSON.parse(event.body) as { on?: unknown }).on : undefined;
    } catch {
      on = undefined;
    }
    stagingHasFix = typeof on === 'boolean' ? on : !stagingHasFix;
    console.log(`staging fixes (UPI rounding, address line 2) are now ${stagingHasFix ? 'ON' : 'OFF'}`);
    return { statusCode: 200, body: JSON.stringify({ stagingHasFix }) };
  }
  return api(event);
}, true);
serve(PORTS.prod, (event) => (event.rawPath === '/checkout' ? prod(event) : Promise.resolve({ statusCode: 404, body: '' })));
serve(PORTS.staging, (event) => (event.rawPath === '/checkout' ? staging(event) : Promise.resolve({ statusCode: 404, body: '' })));

console.log(`Trace2Test local stack
  t2t-api       http://localhost:${PORTS.api}      dashboard token: ${KEYS.dashboard}
  shop-prod     http://localhost:${PORTS.prod}      x-api-key: ${KEYS.prod}
  shop-staging  http://localhost:${PORTS.staging}      x-api-key: ${KEYS.staging}  (fix ${stagingHasFix ? 'ON' : 'OFF'})

Dashboard:  http://localhost:5173 (npm run dev starts it too)
Toggle fix: curl -X POST http://localhost:${PORTS.api}/__local/staging-fix`);
