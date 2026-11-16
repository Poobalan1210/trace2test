import { dynamoIncidentStore, s3ObjectStore, stepFunctionsWorkflow } from '@t2t/aws';
import { createIngestHandler } from './ingest.js';

export const handler = createIngestHandler({
  incidents: dynamoIncidentStore(process.env.TABLE_NAME!),
  objects: s3ObjectStore(process.env.DATA_BUCKET!),
  workflow: stepFunctionsWorkflow(process.env.STATE_MACHINE_ARN!),
  ingestKey: process.env.INGEST_KEY,
});
