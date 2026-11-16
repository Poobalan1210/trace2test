export type { Incident, IncidentStatus, Metrics, Redaction, ReplayRecord, DiffEntry, CapturedRequest, StepTiming } from '@shared/types';
import type { CapturedRequest, Incident, Metrics, Redaction, ReplayRecord } from '@shared/types';

export interface IncidentDetail {
  incident: Incident;
  request: (CapturedRequest & { redactions: Redaction[] }) | null;
  production: { status: number; body: unknown } | null;
  replay: ReplayRecord | null;
  verify: ReplayRecord | null;
}

export interface MetricsView extends Metrics {
  reproducedPercent: number | null;
  medianCaptureToTestMs: number | null;
  medianSampleSize: number;
}

export interface TestFile {
  filename: string;
  source: string;
}

export interface TriggerResult {
  status: number;
  body: unknown;
}

export interface Api {
  listIncidents(statuses: string[], cursor?: string): Promise<{ items: Incident[]; cursor: string | null }>;
  getIncident(id: string): Promise<IncidentDetail>;
  getTest(id: string): Promise<TestFile>;
  verify(id: string): Promise<void>;
  metrics(): Promise<MetricsView>;
  trigger(cart?: unknown): Promise<TriggerResult>;
  /** Local stack only: whether staging runs the fixed code. */
  stagingFix(): Promise<boolean>;
  setStagingFix(on: boolean): Promise<boolean>;
}

export class UnauthorizedError extends Error {
  name = 'UnauthorizedError';
}

export class ApiError extends Error {
  name = 'ApiError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
