import type { IncidentStore } from './stores.js';

/**
 * Runs one task and records its startedAt, endedAt and ms in the incident's
 * steps map, so the dashboard can show timings without the Step Functions API.
 */
export async function timed<T>(store: IncidentStore, incidentId: string, step: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const record = (ok: boolean, reason?: string) =>
    store.recordStep(incidentId, step, {
      startedAt: new Date(started).toISOString(),
      endedAt: new Date().toISOString(),
      ms: Date.now() - started,
      ok,
      ...(reason ? { reason } : {}),
    });
  try {
    const out = await fn();
    await record(true);
    console.log(JSON.stringify({ incidentId, step, ms: Date.now() - started, ok: true }));
    return out;
  } catch (err) {
    const reason = (err as Error)?.name ?? 'Error';
    await record(false, reason).catch(() => {});
    console.log(JSON.stringify({ incidentId, step, ms: Date.now() - started, ok: false, error: reason }));
    throw err;
  }
}
