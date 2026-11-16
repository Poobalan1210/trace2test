import { ulid } from 'ulid';
import {
  IN_PROGRESS, fingerprint, header, json, rawBody, rawKey, secretsEqual, validateCapture,
  type Capture, type HttpEvent, type HttpResult, type Incident,
} from '@t2t/shared';
import { putJson, type IncidentStore, type ObjectStore, type Workflow } from '@t2t/aws';

export const MAX_CAPTURE_BYTES = 300 * 1024;

export interface IngestDeps {
  incidents: IncidentStore;
  objects: ObjectStore;
  workflow: Workflow;
  ingestKey: string | undefined;
  now?: () => Date;
  newId?: () => string;
}

/** A fingerprint keeps its incident while that incident is in progress or has a test. */
function stillOwns(incident: Incident | undefined): incident is Incident {
  return !!incident && (!!incident.testKey || IN_PROGRESS.includes(incident.status));
}

/** POST /incidents: store a capture and start the pipeline, or count a duplicate. */
export function createIngestHandler(deps: IngestDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => ulid());

  return async (event: HttpEvent): Promise<HttpResult> => {
    if (!secretsEqual(header(event, 'x-t2t-ingest-key'), deps.ingestKey)) return json(401, { error: 'unauthorized' });

    const text = rawBody(event);
    if (Buffer.byteLength(text) > MAX_CAPTURE_BYTES) return json(413, { error: 'capture too large' });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'body must be JSON' });
    }
    const invalid = validateCapture(body);
    if (invalid) return json(400, { error: invalid });
    const capture = body as Capture;

    const at = now().toISOString();
    const fp = fingerprint(capture);
    const id = newId();

    const { ownerId } = await deps.incidents.claimFingerprint(fp, id, at);
    if (ownerId !== id) {
      const existing = await deps.incidents.get(ownerId);
      if (stillOwns(existing)) {
        await deps.incidents.bumpOccurrence(existing.id, at);
        console.log(JSON.stringify({ incidentId: existing.id, step: 'Ingest', duplicate: true }));
        return json(202, { incidentId: existing.id, duplicate: true });
      }
      // The earlier incident ended without a test (or never landed): this capture starts afresh.
      const moved = await deps.incidents.reassignFingerprint(fp, ownerId, id);
      if (!moved) {
        // Another capture won the race to replace it; count this one against the winner.
        const winner = (await deps.incidents.claimFingerprint(fp, id, at)).ownerId;
        await deps.incidents.bumpOccurrence(winner, at).catch(() => {});
        return json(202, { incidentId: winner, duplicate: true });
      }
    }

    await putJson(deps.objects, rawKey(id), capture);

    const ingestMs = Math.max(0, Date.parse(at) - Date.parse(capture.capturedAt));
    const incident: Incident = {
      id,
      status: 'RECEIVED',
      service: capture.service,
      method: capture.request.method,
      path: capture.request.path,
      errorName: capture.error.name,
      errorMessage: capture.error.message,
      fingerprint: fp,
      occurrences: 1,
      capturedAt: capture.capturedAt,
      createdAt: at,
      lastSeenAt: at,
      steps: { Captured: { startedAt: capture.capturedAt, endedAt: at, ms: ingestMs, ok: true } },
      prodStatus: capture.response.status,
      redactionCount: capture.redactions.length,
      leakCount: 0,
    };
    await deps.incidents.create(incident);
    await deps.incidents.addMetrics({ captured: 1, redactions: capture.redactions.length });

    const executionArn = await deps.workflow.start(id, { incidentId: id, mode: 'capture' });
    await deps.incidents.update(id, { executionArn });

    console.log(JSON.stringify({ incidentId: id, step: 'Ingest', ok: true }));
    return json(202, { incidentId: id });
  };
}
