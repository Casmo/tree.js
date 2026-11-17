// Tree Editor app build (static site for GitHub Pages): `npm run build:editor` -> editor/dist.
// Relative base so it works under any Pages path (https://<owner>.github.io/tree.js/).
import { defineConfig } from 'vite';
import { packageAliases } from '../vite.config';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  resolve: { alias: packageAliases },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // three.js itself is most of the app.
    chunkSizeWarningLimit: 1500,
  },
});
