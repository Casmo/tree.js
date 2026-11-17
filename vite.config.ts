import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Library build: ESM only, three stays external (peer dependency).
// Type declarations are emitted separately by `tsc -p tsconfig.build.json`.
// The dev server (`npm run dev`) serves the examples from the repo root.
// The Tree Editor (editor/) imports the library by its package name, like any app would;
// in this repo those names resolve to the sources (see also `paths` in tsconfig.json).
export const packageAliases = [
  { find: /^@casmo\/tree\.js\/styles\/([\w-]+)$/, replacement: resolve(import.meta.dirname, 'src/styles/$1/index.ts') },
  { find: /^@casmo\/tree\.js$/, replacement: resolve(import.meta.dirname, 'src/index.ts') },
];

export default defineConfig({
  resolve: { alias: packageAliases },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        // Styles: one lazily importable chunk each (`await import('@casmo/tree.js/styles/<name>')`).
        'styles/low-poly': resolve(import.meta.dirname, 'src/styles/low-poly/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id === 'three' || id.startsWith('three/'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'editor/**/*.test.ts'],
    environment: 'node',
  },
});
