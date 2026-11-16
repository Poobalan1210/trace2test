/** DynamoDB keys and S3 object keys, in one place so every service agrees. */
export const incidentKey = (id: string) => ({ pk: `INC#${id}`, sk: 'META' });
export const fingerprintKey = (fp: string) => ({ pk: `FP#${fp}`, sk: 'META' });
export const METRICS_KEY = { pk: 'METRICS', sk: 'TOTALS' };
export const GSI1_PK = 'INC';

export const rawKey = (id: string) => `raw/${id}.json`;
export const bundleKey = (id: string) => `incidents/${id}/bundle.json`;
export const replayKey = (id: string) => `incidents/${id}/replay.json`;
export const verifyKey = (id: string) => `incidents/${id}/verify.json`;
export const testKey = (id: string, filename: string) => `incidents/${id}/${filename}`;

export const RETENTION_DAYS = 30;
export const expiresAt = (from = Date.now()) => Math.floor(from / 1000) + RETENTION_DAYS * 86400;

/** Incident ids are ULIDs; this also stops a path parameter from reaching into other keys. */
export const isIncidentId = (id: unknown): id is string => typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
