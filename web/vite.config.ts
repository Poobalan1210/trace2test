import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Browser-safe modules shared with the backend (no Node imports).
      '@shared': fileURLToPath(new URL('../packages/shared/src', import.meta.url)),
      // The demo scenarios, shared with the tests and the local scripts.
      '@shop': fileURLToPath(new URL('../services/shop/src', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
});
