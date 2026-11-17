import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Library build: ESM only, peer dependencies (three, react, @react-three/fiber) stay external.
// Type declarations are emitted separately by `tsc -p tsconfig.build.json`.
// The dev server (`npm run dev`) serves the examples from the repo root.
// The Tree Editor (editor/) imports the library by its package name, like any app would;
// in this repo those names resolve to the sources (see also `paths` in tsconfig.json).
export const packageAliases = [
  { find: /^@casmo\/tree\.js\/styles\/([\w-]+)$/, replacement: resolve(import.meta.dirname, 'src/styles/$1/index.ts') },
  { find: /^@casmo\/tree\.js\/effects$/, replacement: resolve(import.meta.dirname, 'src/effects/index.ts') },
  { find: /^@casmo\/tree\.js$/, replacement: resolve(import.meta.dirname, 'src/index.ts') },
];

// Textures (assets/textures/, made by scripts/generate-textures.mjs) are copied to dist/textures/
// as separate files (publicDir); src/textures finds them relative to its own module URL.
/** The `define` src/textures needs (also used by the editor, which sets its own texture base path). */
export function textureDefine(command: 'build' | 'serve'): Record<string, string> {
  return { __TREE_TEXTURES_DIR__: JSON.stringify(command === 'build' ? './textures/' : '../../assets/textures/') };
}

export default defineConfig(({ command }) => ({
  resolve: { alias: packageAliases },
  publicDir: 'assets',
  define: textureDefine(command),
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        // Styles: one lazily importable chunk each (`await import('@casmo/tree.js/styles/<name>')`).
        'styles/low-poly': resolve(import.meta.dirname, 'src/styles/low-poly/index.ts'),
        'styles/stylized': resolve(import.meta.dirname, 'src/styles/stylized/index.ts'),
        'styles/realistic': resolve(import.meta.dirname, 'src/styles/realistic/index.ts'),
        // React Three Fiber bindings; react and @react-three/fiber are optional peers, kept external.
        react: resolve(import.meta.dirname, 'src/react/index.ts'),
        // Tree Effects: opt-in post-processing nodes (three/addons stay external).
        effects: resolve(import.meta.dirname, 'src/effects/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => /^(three|react|react-dom|@react-three\/fiber)(\/|$)/.test(id),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}', 'editor/**/*.test.ts'],
    environment: 'node',
  },
}));
