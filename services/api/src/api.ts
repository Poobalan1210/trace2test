import {
  IN_PROGRESS, INCIDENT_STATUSES, bundleKey, header, isIncidentId, json, method, parseJsonBody, path, rawBody, replayKey,
  secretsEqual, verifyKey, type Bundle, type HttpEvent, type HttpResult, type IncidentStatus, type ReplayRecord,
} from '@t2t/shared';
import { getJson, type IncidentStore, type ObjectStore, type Workflow } from '@t2t/aws';

export interface ApiDeps {
  incidents: IncidentStore;
  objects: ObjectStore;
  workflow: Workflow;
  dashboardToken: string | undefined;
  shopProdUrl: string | undefined;
  prodApiKey: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The cart the demo button sends: two books, READ15, paid by UPI. */
export const SEEDED_CART = {
  items: [
    { sku: 'BK-1042', price: 1299, qty: 1 },
    { sku: 'BK-2210', price: 349.5, qty: 1 },
  ],
  coupon: 'READ15',
  paymentMethod: 'upi',
  customer: { email: 'asha.k@example.com' },
};

const PAGE_SIZE = 25;
const MAX_DEMO_BODY = 10 * 1024;

const notFound = () => json(404, { error: 'not found' });

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function createApiHandler(deps: ApiDeps) {
  const routes: { method: string; pattern: RegExp; run: (event: HttpEvent, id?: string) => Promise<HttpResult> }[] = [
    { method: 'GET', pattern: /^\/incidents$/, run: listIncidents },
    { method: 'GET', pattern: /^\/incidents\/([^/]+)$/, run: (_e, id) => getIncident(id!) },
    { method: 'GET', pattern: /^\/incidents\/([^/]+)\/test$/, run: (_e, id) => getTest(id!) },
    { method: 'POST', pattern: /^\/incidents\/([^/]+)\/verify$/, run: (_e, id) => verify(id!) },
    { method: 'GET', pattern: /^\/metrics$/, run: metrics },
    { method: 'POST', pattern: /^\/demo\/trigger$/, run: demoTrigger },
  ];

  async function listIncidents(event: HttpEvent) {
    const q = event.queryStringParameters ?? {};
    const statuses = (q.status ?? '').split(',').filter(Boolean);
    if (!statuses.every((s) => (INCIDENT_STATUSES as readonly string[]).includes(s))) return json(400, { error: 'unknown status' });
    const page = await deps.incidents.list({ statuses: statuses as IncidentStatus[], cursor: q.cursor, limit: PAGE_SIZE });
    return json(200, { items: page.items, cursor: page.cursor ?? null });
  }

  async function getIncident(id: string) {
    if (!isIncidentId(id)) return notFound();
    const incident = await deps.incidents.get(id);
    if (!incident) return notFound();
    const [bundle, replay, verifyRecord] = await Promise.all([
      getJson<Bundle>(deps.objects, bundleKey(id)),
      getJson<ReplayRecord>(deps.objects, replayKey(id)),
      getJson<ReplayRecord>(deps.objects, verifyKey(id)),
    ]);
    return json(200, {
      incident,
      // Only the sanitized bundle is ever served; the raw capture is gone by now.
      request: bundle ? { ...bundle.request, redactions: bundle.redactions } : null,
      production: bundle ? bundle.response : null,
      replay: replay ?? null,
      verify: verifyRecord ?? null,
    });
  }

  async function getTest(id: string) {
    if (!isIncidentId(id)) return notFound();
    const incident = await deps.incidents.get(id);
    if (!incident?.testKey || !incident.testFilename) return notFound();
    const source = await deps.objects.getText(incident.testKey);
    if (source === undefined) return notFound();
    return json(200, { filename: incident.testFilename, source });
  }

  async function verify(id: string) {
    if (!isIncidentId(id)) return notFound();
    const incident = await deps.incidents.get(id);
    if (!incident) return notFound();
    if (!incident.replayable) return json(409, { error: 'this incident cannot be replayed' });
    if (IN_PROGRESS.includes(incident.status)) return json(409, { error: 'the pipeline is still running for this incident' });
    const name = `${id}-verify-${deps.now?.() ?? Date.now()}`;
    await deps.incidents.update(id, { status: 'VERIFYING' });
    const executionArn = await deps.workflow.start(name, { incidentId: id, mode: 'verify' });
    return json(202, { incidentId: id, executionArn });
  }

  async function metrics() {
    const [totals, recent] = await Promise.all([deps.incidents.getMetrics(), deps.incidents.recent(200)]);
    const times = recent.map((i) => i.captureToTestMs).filter((ms): ms is number => typeof ms === 'number' && ms > 0);
    return json(200, {
      ...totals,
      reproducedPercent: totals.replayable ? Math.round((totals.reproduced / totals.replayable) * 100) : null,
      medianCaptureToTestMs: median(times),
      medianSampleSize: times.length,
    });
  }

  async function demoTrigger(event: HttpEvent) {
    if (!deps.shopProdUrl || !deps.prodApiKey) return json(503, { error: 'the demo shop is not configured' });
    const text = rawBody(event);
    if (Buffer.byteLength(text) > MAX_DEMO_BODY) return json(413, { error: 'cart too large' });
    let cart: unknown = SEEDED_CART;
    if (text) {
      cart = parseJsonBody(event);
      if (!cart || typeof cart !== 'object' || Array.isArray(cart)) return json(400, { error: 'cart must be a JSON object' });
    }
    // The browser never holds the production key; this endpoint adds it.
    const res = await (deps.fetch ?? fetch)(`${deps.shopProdUrl.replace(/\/+$/, '')}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': deps.prodApiKey },
      body: JSON.stringify(cart),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    return { statusCode: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' }, body };
  }

  return async (event: HttpEvent): Promise<HttpResult> => {
    if (!secretsEqual(header(event, 'x-t2t-token'), deps.dashboardToken)) return json(401, { error: 'unauthorized' });
    const m = method(event);
    const p = path(event);
    for (const route of routes) {
      const match = route.method === m ? p.match(route.pattern) : null;
      if (match) {
        try {
          return await route.run(event, match[1] && decodeURIComponent(match[1]));
        } catch (err) {
          console.log(JSON.stringify({ route: `${m} ${route.pattern.source}`, error: (err as Error)?.name ?? 'Error' }));
          return json(500, { error: 'internal error' });
        }
      }
    }
    return notFound();
  };
}
