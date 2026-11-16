import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { fingerprint, lanternCapture, type HttpEvent } from '@t2t/shared';
import {
  dynamoIncidentStore, memoryIncidentStore, memoryObjectStore, memoryWorkflow, s3ObjectStore, stepFunctionsWorkflow,
} from '@t2t/aws';
import { createIngestHandler, MAX_CAPTURE_BYTES } from './ingest.js';

vi.spyOn(console, 'log').mockImplementation(() => {});

const post = (body: unknown, key = 'ik'): HttpEvent => ({
  rawPath: '/incidents',
  headers: { 'x-t2t-ingest-key': key, 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  requestContext: { http: { method: 'POST', path: '/incidents' } },
});

const ids = ['01JCXK2M8Q4T9V6B3N7RZ5WDH1', '01JCXK2M8Q4T9V6B3N7RZ5WDH2', '01JCXK2M8Q4T9V6B3N7RZ5WDH3'];

function setup() {
  const incidents = memoryIncidentStore();
  const objects = memoryObjectStore();
  const workflow = memoryWorkflow();
  let n = 0;
  const handler = createIngestHandler({
    incidents, objects, workflow, ingestKey: 'ik',
    now: () => new Date('2026-11-14T09:12:45.000Z'),
    newId: () => ids[n++],
  });
  return { incidents, objects, workflow, handler };
}

describe('ingest', () => {
  test('stores the capture, creates the incident and starts the workflow', async () => {
    const { incidents, objects, workflow, handler } = setup();
    const res = await handler(post(lanternCapture()));
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body!)).toEqual({ incidentId: ids[0] });
    expect(JSON.parse(objects.objects.get(`raw/${ids[0]}.json`)!)).toEqual(lanternCapture());
    const inc = incidents.incidents.get(ids[0])!;
    expect(inc).toMatchObject({
      status: 'RECEIVED', service: 'lantern-checkout', method: 'POST', path: '/checkout',
      errorName: 'PaymentProviderError', fingerprint: fingerprint(lanternCapture()), occurrences: 1, prodStatus: 500, redactionCount: 2,
    });
    expect(inc.steps.Captured).toEqual({ startedAt: '2026-11-14T09:12:44.120Z', endedAt: '2026-11-14T09:12:45.000Z', ms: 880, ok: true });
    expect(workflow.started).toEqual([{ name: ids[0], input: { incidentId: ids[0], mode: 'capture' } }]);
    expect(incidents.metrics).toMatchObject({ captured: 1, redactions: 2 });
  });

  test('a repeat of an in-progress or tested failure is counted, not re-run', async () => {
    const { incidents, workflow, handler } = setup();
    await handler(post(lanternCapture()));
    const second = await handler(post(lanternCapture()));
    expect(JSON.parse(second.body!)).toEqual({ incidentId: ids[0], duplicate: true });
    await incidents.update(ids[0], { status: 'FIXED', testKey: 'k' });
    await handler(post(lanternCapture()));
    await handler(post(lanternCapture()));
    expect(workflow.started).toHaveLength(1);
    expect(incidents.incidents.size).toBe(1);
    expect(incidents.incidents.get(ids[0])!.occurrences).toBe(4);
  });

  test('a repeat of a failure that ended without a test starts a new incident', async () => {
    const { incidents, workflow, handler } = setup();
    await handler(post(lanternCapture()));
    await incidents.update(ids[0], { status: 'NOT_REPRODUCED' });
    const res = await handler(post(lanternCapture()));
    expect(JSON.parse(res.body!)).toEqual({ incidentId: ids[1] });
    expect(workflow.started).toHaveLength(2);
  });

  test('a different failure gets its own incident', async () => {
    const { workflow, handler } = setup();
    await handler(post(lanternCapture()));
    await handler(post(lanternCapture({ error: { name: 'TypeError', message: 'x', stackTop: 'f (a.ts:1)' } })));
    expect(workflow.started).toHaveLength(2);
  });

  test('401 without detail on a bad or missing key', async () => {
    const { handler } = setup();
    for (const key of ['wrong', '']) {
      const res = await handler(post(lanternCapture(), key));
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body!)).toEqual({ error: 'unauthorized' });
    }
  });

  test('413 over 300 KB, 400 on invalid captures', async () => {
    const { handler, workflow } = setup();
    expect((await handler(post('x'.repeat(MAX_CAPTURE_BYTES + 1)))).statusCode).toBe(413);
    expect((await handler(post('not json'))).statusCode).toBe(400);
    expect((await handler(post({ ...lanternCapture(), schemaVersion: 2 }))).statusCode).toBe(400);
    expect((await handler(post({ ...lanternCapture(), request: { ...lanternCapture().request, path: 'checkout' } }))).statusCode).toBe(400);
    expect(workflow.started).toHaveLength(0);
  });
});

describe('ingest against mocked AWS clients', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const s3 = mockClient(S3Client);
  const sfn = mockClient(SFNClient);
  beforeEach(() => { ddb.reset(); s3.reset(); sfn.reset(); });

  test('writes the raw object and the incident item', async () => {
    ddb.on(UpdateCommand).callsFake((input) =>
      input.Key.pk.startsWith('FP#') ? { Attributes: { incidentId: ids[0], count: 1 } } : {});
    ddb.on(PutCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});
    sfn.on(StartExecutionCommand).resolves({ executionArn: 'arn:exec' });

    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const handler = createIngestHandler({
      incidents: dynamoIncidentStore('t2t', doc),
      objects: s3ObjectStore('data-bucket', new S3Client({ region: 'us-east-1' })),
      workflow: stepFunctionsWorkflow('arn:aws:states:us-east-1:1:stateMachine:t2t-pipeline', new SFNClient({ region: 'us-east-1' })),
      ingestKey: 'ik',
      newId: () => ids[0],
    });
    const res = await handler(post(lanternCapture()));
    expect(res.statusCode).toBe(202);

    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(put).toMatchObject({ Bucket: 'data-bucket', Key: `raw/${ids[0]}.json` });
    expect(JSON.parse(put.Body as string)).toEqual(lanternCapture());

    const item = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(item.TableName).toBe('t2t');
    expect(item.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(item.Item).toMatchObject({ pk: `INC#${ids[0]}`, sk: 'META', status: 'RECEIVED', gsi1pk: 'INC', occurrences: 1 });
    expect(typeof item.Item!.expiresAt).toBe('number');

    const start = sfn.commandCalls(StartExecutionCommand)[0].args[0].input;
    expect(start).toEqual({ stateMachineArn: expect.any(String), name: ids[0], input: JSON.stringify({ incidentId: ids[0], mode: 'capture' }) });

    const metrics = ddb.commandCalls(UpdateCommand).find((c) => c.args[0].input.Key!.pk === 'METRICS')!;
    expect(metrics.args[0].input.UpdateExpression).toMatch(/^ADD /);
    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });
});
