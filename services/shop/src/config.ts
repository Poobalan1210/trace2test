import type { Trace2TestConfig } from '@trace2tests/sdk';

/** How Lantern Books wires Trace2Test in. This is the whole integration. */
export const trace2testConfig = (): Trace2TestConfig => ({
  ingestUrl: process.env.T2T_INGEST_URL,
  ingestKey: process.env.T2T_INGEST_KEY,
  service: 'lantern-checkout',
  stage: process.env.STAGE, // only 'prod' captures; staging never does
  redact: {
    keys: ['authorization', 'cookie', 'x-api-key', 'password', 'token', 'cardNumber', 'cvv', 'email', 'phone'],
    patterns: ['email', 'card', 'jwt', 'bearer'],
  },
  maxBodyBytes: 262144,
});
