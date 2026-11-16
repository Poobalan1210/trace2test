/**
 * Runs Trace2Test end to end on this machine, with in-memory stores in place
 * of S3 and DynamoDB and a local Lantern Books standing in for staging:
 *
 *   wrapped checkout (prod, buggy) -> ingest -> Sanitize -> Validate
 *     -> Replay (local staging) -> Compare -> GenerateTest
 *
 * The generated test is written to .local/. Usage: npm run local:pipeline
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { withTrace2Test } from '@trace2tests/sdk';
import { memoryIncidentStore, memoryObjectStore, memoryWorkflow } from '@t2t/aws';
import { createCheckoutHandler } from '../services/shop/src/checkout.js';
import { trace2testConfig } from '../services/shop/src/config.js';
import { STOCK } from '../services/shop/src/catalog.js';
import { checkoutEvent, inProcessPayments, LANTERN_CART } from '../services/shop/src/testing.js';
import { startLocalShop } from '../services/shop/src/local-server.js';
import { createIngestHandler } from '../services/ingest/src/ingest.js';
import { compare, generate, replay, sanitize, validate, type TaskDeps } from '../services/pipeline/src/tasks.js';

const quiet = console.log;
console.log = () => {};
console.error = () => {};
const say = (msg: string) => quiet(msg);

const incidents = memoryIncidentStore();
const objects = memoryObjectStore();
const workflow = memoryWorkflow();
const ingest = createIngestHandler({ incidents, objects, workflow, ingestKey: 'local-ingest-key' });

// 1. Production checkout, wrapped. Its capture goes straight to the ingest handler.
const prod = withTrace2Test(
  createCheckoutHandler({ payments: inProcessPayments, apiKey: 'prod-key', inventory: STOCK.prod, fixUpiRounding: false, fixAddressLine2: false }),
  {
    ...trace2testConfig(),
    ingestUrl: 'http://ingest.local/incidents',
    ingestKey: 'local-ingest-key',
    stage: 'prod',
    fetch: (async (_url: string, init: RequestInit) => {
      const res = await ingest({ headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(res.body, { status: res.statusCode });
    }) as unknown as typeof fetch,
  },
);
const res = await prod(checkoutEvent(LANTERN_CART, { 'x-api-key': 'prod-key' }));
say(`prod checkout (READ15 + UPI)  -> ${res.statusCode}`);

const started = workflow.started[0];
if (!started) throw new Error('no workflow was started');
const incidentId = (started.input as { incidentId: string }).incidentId;
say(`captured incident             -> ${incidentId}`);

// 2. The five tasks, in the order the state machine runs them.
const staging = await startLocalShop({ apiKey: 'staging-key', fixed: false });
const deps: TaskDeps = {
  incidents, objects, stagingApiKey: 'staging-key',
  targets: { 'lantern-checkout': { baseUrl: staging.url, routes: ['POST /checkout'] } },
};
const input = { incidentId, mode: 'capture' as const };
try {
  const s = await sanitize(deps, input);
  say(`Sanitize                      -> ${s.redactionCount} redactions, ${s.leakCount} leaked`);
  const v = await validate(deps, input);
  say(`Validate                      -> replayable: ${v.replayable}${v.reason ? ` (${v.reason})` : ''}`);
  if (!v.replayable) process.exit(1);
  const r = await replay(deps, input);
  say(`Replay on local staging       -> ${r.stagingStatus}`);
  const c = await compare(deps, input);
  say(`Compare                       -> ${c.verdict}: ${c.reason}`);
  if (c.verdict !== 'REPRODUCED') process.exit(1);
  const g = await generate(deps, input);
  mkdirSync('.local', { recursive: true });
  writeFileSync(`.local/${g.filename}`, (await objects.getText(g.testKey))!);
  say(`GenerateTest                  -> .local/${g.filename}`);

  const steps = incidents.incidents.get(incidentId)!.steps;
  say('\nstep timings: ' + Object.entries(steps).map(([k, t]) => `${k} ${t.ms} ms`).join(', '));
  say(`\nRun it against the local buggy shop:\n  T2T_TARGET_URL=${staging.url} T2T_TARGET_API_KEY=staging-key npx jest --rootDir .local .local/${g.filename}`);
} finally {
  staging.server.close();
}
