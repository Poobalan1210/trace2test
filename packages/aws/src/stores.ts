import type { Incident, IncidentStatus, Metrics, StepTiming } from '@t2t/shared';

export interface ObjectStore {
  getText(key: string): Promise<string | undefined>;
  putText(key: string, text: string, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ListQuery {
  statuses?: IncidentStatus[];
  cursor?: string;
  limit: number;
}

export interface IncidentStore {
  /**
   * Counts an occurrence of a fingerprint and returns which incident owns it.
   * The first caller's incidentId becomes the owner; later callers get that owner back.
   */
  claimFingerprint(fp: string, incidentId: string, now: string): Promise<{ ownerId: string; count: number }>;
  /** Moves a fingerprint to a new incident, only if it still points at `fromId`. */
  reassignFingerprint(fp: string, fromId: string, toId: string): Promise<boolean>;
  get(id: string): Promise<Incident | undefined>;
  /** Creates the incident; a second create of the same id is a no-op. */
  create(incident: Incident): Promise<void>;
  update(id: string, fields: Partial<Incident>): Promise<void>;
  recordStep(id: string, name: string, timing: StepTiming): Promise<void>;
  bumpOccurrence(id: string, now: string): Promise<void>;
  addMetrics(deltas: Partial<Metrics>): Promise<void>;
  getMetrics(): Promise<Metrics>;
  list(q: ListQuery): Promise<{ items: Incident[]; cursor?: string }>;
  /** Recent incidents for computing medians; bounded. */
  recent(limit: number): Promise<Incident[]>;
}

export interface Workflow {
  /** Starts an execution. Starting the same name twice is a no-op that returns the same ARN. */
  start(name: string, input: { incidentId: string; mode: 'capture' | 'verify' }): Promise<string>;
}

export async function getJson<T>(store: ObjectStore, key: string): Promise<T | undefined> {
  const text = await store.getText(key);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

export const putJson = (store: ObjectStore, key: string, value: unknown) =>
  store.putText(key, JSON.stringify(value, null, 2), 'application/json');

export const ZERO_METRICS: Metrics = {
  captured: 0, replayable: 0, reproduced: 0, testsGenerated: 0, fixed: 0, redactions: 0, leaks: 0, pipelineMsTotal: 0,
};
