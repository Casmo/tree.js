import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Library build: ESM only, three stays external (peer dependency).
// Type declarations are emitted separately by `tsc -p tsconfig.build.json`.
// The dev server (`npm run dev`) serves the examples from the repo root.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    lib: {
      entry: { index: resolve(import.meta.dirname, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id === 'three' || id.startsWith('three/'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
