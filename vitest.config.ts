import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Inside the repo the SDK runs from source; its package.json points at the published build.
    alias: { '@trace2tests/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
