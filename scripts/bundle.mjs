// Bundles one Lambda entry point into SAM's artifacts directory.
// Called by the Makefile, which `sam build` runs for each function.
// Usage: node scripts/bundle.mjs <entry.ts> <artifacts-dir>
import { build } from 'esbuild';
import { basename } from 'node:path';

const [entry, outdir] = process.argv.slice(2);
if (!entry || !outdir) {
  console.error('usage: node scripts/bundle.mjs <entry.ts> <artifacts-dir>');
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile: `${outdir}/${basename(entry).replace(/\.ts$/, '.mjs')}`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Readable function names keep stack tops (and so fingerprints) meaningful.
  minify: false,
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
  logLevel: 'warning',
});
