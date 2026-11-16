import { dynamoIncidentStore, s3ObjectStore, stepFunctionsWorkflow } from '@t2t/aws';
import { createApiHandler } from './api.js';

export const handler = createApiHandler({
  incidents: dynamoIncidentStore(process.env.TABLE_NAME!),
  objects: s3ObjectStore(process.env.DATA_BUCKET!),
  workflow: stepFunctionsWorkflow(process.env.STATE_MACHINE_ARN!),
  dashboardToken: process.env.DASHBOARD_TOKEN,
  shopProdUrl: process.env.SHOP_PROD_URL,
  prodApiKey: process.env.PROD_API_KEY,
});
