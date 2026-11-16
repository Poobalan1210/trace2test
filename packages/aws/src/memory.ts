import type { Incident, Metrics } from '@t2t/shared';
import { ZERO_METRICS, type IncidentStore, type ObjectStore, type Workflow } from './stores.js';

/** In-memory fakes with the same semantics as the AWS stores, for tests and local runs. */
export function memoryObjectStore(): ObjectStore & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async getText(key) { return objects.get(key); },
    async putText(key, text) { objects.set(key, text); },
    async delete(key) { objects.delete(key); },
  };
}

export function memoryIncidentStore(): IncidentStore & { incidents: Map<string, Incident>; metrics: Metrics } {
  const incidents = new Map<string, Incident>();
  const fps = new Map<string, { incidentId: string; count: number }>();
  const metrics: Metrics = { ...ZERO_METRICS };
  const clone = <T>(v: T): T => structuredClone(v);
  const sorted = () => [...incidents.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id)));
  const mustGet = (id: string) => {
    const inc = incidents.get(id);
    if (!inc) throw Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' });
    return inc;
  };
  return {
    incidents,
    metrics,
    async claimFingerprint(fp, incidentId) {
      const entry = fps.get(fp) ?? { incidentId, count: 0 };
      entry.count += 1;
      fps.set(fp, entry);
      return { ownerId: entry.incidentId, count: entry.count };
    },
    async reassignFingerprint(fp, fromId, toId) {
      const entry = fps.get(fp);
      if (!entry || entry.incidentId !== fromId) return false;
      entry.incidentId = toId;
      return true;
    },
    async get(id) { const i = incidents.get(id); return i && clone(i); },
    async create(incident) { if (!incidents.has(incident.id)) incidents.set(incident.id, clone(incident)); },
    async update(id, fields) {
      const inc = mustGet(id);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) (inc as unknown as Record<string, unknown>)[k] = clone(v);
    },
    async recordStep(id, name, timing) { mustGet(id).steps[name] = clone(timing); },
    async bumpOccurrence(id, now) { const inc = mustGet(id); inc.occurrences += 1; inc.lastSeenAt = now; },
    async addMetrics(deltas) {
      for (const [k, v] of Object.entries(deltas)) if (typeof v === 'number') metrics[k as keyof Metrics] += v;
    },
    async getMetrics() { return { ...metrics }; },
    async list(q) {
      const all = sorted().filter((i) => !q.statuses?.length || q.statuses.includes(i.status));
      const start = q.cursor ? Number(q.cursor) : 0;
      const items = all.slice(start, start + q.limit).map(clone);
      const next = start + q.limit < all.length ? String(start + q.limit) : undefined;
      return { items, cursor: next };
    },
    async recent(limit) { return sorted().slice(0, limit).map(clone); },
  };
}

export function memoryWorkflow(): Workflow & { started: { name: string; input: unknown }[] } {
  const started: { name: string; input: unknown }[] = [];
  return {
    started,
    async start(name, input) {
      if (!started.some((s) => s.name === name)) started.push({ name, input });
      return `arn:aws:states:local:000000000000:execution:t2t-pipeline:${name}`;
    },
  };
}
