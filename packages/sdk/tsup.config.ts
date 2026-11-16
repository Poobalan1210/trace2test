import { defineConfig } from 'tsup';

// @t2t/shared is internal to this repository, so it is bundled into the
// published package, code and types both. The package has no runtime dependencies.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node18',
  noExternal: ['@t2t/shared'],
  dts: { resolve: ['@t2t/shared'] },
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
});
