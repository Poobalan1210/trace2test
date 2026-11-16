export type RedactionType =
  | 'email' | 'card' | 'phone' | 'jwt' | 'bearer' | 'key' | 'token' | 'password' | 'cookie' | 'secret';

export interface Redaction {
  path: string;
  type: RedactionType;
}

export interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  bodyOmitted?: boolean;
}

export interface Capture {
  schemaVersion: 1;
  service: string;
  capturedAt: string;
  request: CapturedRequest;
  response: { status: number; body: unknown };
  error: { name: string; message: string; stackTop: string };
  redactions: Redaction[];
  runtime: { node: string; codeVersion: string };
}

export const INCIDENT_STATUSES = [
  'RECEIVED', 'SANITIZED', 'REPLAYING', 'REPRODUCED', 'NOT_REPRODUCED', 'NOT_REPLAYABLE',
  'TEST_READY', 'TEST_UNVERIFIED', 'VERIFYING', 'FIXED', 'STILL_FAILING', 'PIPELINE_FAILED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface StepTiming {
  startedAt: string;
  endedAt: string;
  ms: number;
  ok: boolean;
  reason?: string;
}

/** The sanitized bundle the pipeline replays from (S3 incidents/<id>/bundle.json). */
export interface Bundle {
  incidentId: string;
  service: string;
  capturedAt: string;
  fingerprint: string;
  request: CapturedRequest;
  response: { status: number; body: unknown };
  error: Capture['error'];
  redactions: Redaction[];
  leakCount: number;
}

/** What Replay and Compare write to incidents/<id>/replay.json. */
export interface ReplayRecord {
  mode: 'capture' | 'verify';
  replayedAt: string;
  target: string; // service name, never a host
  staging: { status: number; body: unknown; ms: number } | { networkError: string; ms: number };
  verdict?: Verdict;
  reason?: string;
  diff?: DiffEntry[];
}

export type Verdict = 'REPRODUCED' | 'NOT_REPRODUCED' | 'FIXED' | 'STILL_FAILING';

export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  prod?: unknown;
  staging?: unknown;
}

/** The incident item (pk INC#<id>, sk META) as the API and tasks see it. */
export interface Incident {
  id: string;
  status: IncidentStatus;
  service: string;
  method: string;
  path: string;
  errorName: string;
  errorMessage: string;
  fingerprint: string;
  occurrences: number;
  capturedAt: string;
  createdAt: string;
  lastSeenAt: string;
  steps: Record<string, StepTiming>;
  prodStatus: number;
  stagingStatus?: number;
  verdict?: Verdict;
  reason?: string;
  redactionCount: number;
  leakCount: number;
  replayable?: boolean;
  testKey?: string;
  testFilename?: string;
  captureToTestMs?: number;
  executionArn?: string;
  verifiedAt?: string;
  fixedAt?: string;
  failure?: { error: string; cause: string };
  /** Where the test was delivered, or why delivery failed. */
  delivery?: Delivery;
}

export interface Delivery {
  repo: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  branch?: string;
  deliveredAt?: string;
  error?: string;
}

export interface Metrics {
  captured: number;
  replayable: number;
  reproduced: number;
  testsGenerated: number;
  fixed: number;
  redactions: number;
  leaks: number;
  pipelineMsTotal: number;
}

export const IN_PROGRESS: IncidentStatus[] = ['RECEIVED', 'SANITIZED', 'REPLAYING', 'REPRODUCED', 'VERIFYING'];
