import { dynamoIncidentStore, s3ObjectStore, ssmSecret } from '@t2t/aws';
import { parseTargets } from './config.js';
import { parseDelivery } from './github.js';
import { compare, deliver, generate, replay, sanitize, validate, type TaskDeps, type TaskInput } from './tasks.js';

const deps: TaskDeps = {
  incidents: dynamoIncidentStore(process.env.TABLE_NAME!),
  objects: s3ObjectStore(process.env.DATA_BUCKET!),
  targets: parseTargets(process.env.REPLAY_TARGETS),
  stagingApiKey: process.env.STAGING_API_KEY || undefined,
  delivery: parseDelivery(process.env.DELIVERY_TARGETS),
  github: process.env.GITHUB_TOKEN_PARAMETER
    ? { token: ssmSecret(process.env.GITHUB_TOKEN_PARAMETER), apiUrl: process.env.GITHUB_API_URL || undefined }
    : undefined,
  dashboardUrl: process.env.DASHBOARD_URL || undefined,
};

export const sanitizeHandler = (input: TaskInput) => sanitize(deps, input);
export const validateHandler = (input: TaskInput) => validate(deps, input);
export const replayHandler = (input: TaskInput) => replay(deps, input);
export const compareHandler = (input: TaskInput) => compare(deps, input);
export const generateTestHandler = (input: TaskInput) => generate(deps, input);
export const deliverHandler = (input: TaskInput) => deliver(deps, input);
