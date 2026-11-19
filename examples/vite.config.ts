// Production build of the bundled examples (vanilla three.js, React Three Fiber, Forest, large forest, Tree Effects, Species, Scene Pipeline, custom Tree Effect):
// `npm run build:examples` -> examples/dist, a static site (relative base) like any app would ship.
// They import the library by its package name, which resolves to src/ in this repo (packageAliases).
// examples/cdn needs no build: it loads the published ES modules through an import map.
// Textures: as in the editor build, src/textures lands in dist/assets/, so its default path is ../textures/.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { packageAliases, textureDefine } from '../vite.config';

export const BUNDLED_EXAMPLES = ['vanilla', 'react', 'forest', 'large-forest', 'effects', 'species', 'material-features', 'scene-pipeline', 'custom-effect'];

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  base: './',
  publicDir: '../assets',
  define: command === 'build' ? { __TREE_TEXTURES_DIR__: JSON.stringify('../textures/') } : textureDefine(command),
  resolve: { alias: packageAliases },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // three.js itself is most of each page.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: Object.fromEntries(BUNDLED_EXAMPLES.map((name) => [name, resolve(import.meta.dirname, name, 'index.html')])),
    },
  },
}));
