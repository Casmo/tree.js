import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Library build: ESM only, three stays external (peer dependency).
// Type declarations are emitted separately by `tsc -p tsconfig.build.json`.
// The dev server (`npm run dev`) serves the examples from the repo root.
// Textures (assets/textures/, made by scripts/generate-textures.mjs) are copied to dist/textures/
// as separate files (publicDir); src/textures finds them relative to its own module URL.
export default defineConfig(({ command }) => ({
  publicDir: 'assets',
  define: {
    __TREE_TEXTURES_DIR__: JSON.stringify(command === 'build' ? './textures/' : '../../assets/textures/'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        // Styles: one lazily importable chunk each (`await import('@casmo/tree.js/styles/<name>')`).
        'styles/low-poly': resolve(import.meta.dirname, 'src/styles/low-poly/index.ts'),
        'styles/realistic': resolve(import.meta.dirname, 'src/styles/realistic/index.ts'),
      },
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
}));
