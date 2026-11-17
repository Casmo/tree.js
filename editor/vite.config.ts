// Tree Editor app build (static site for GitHub Pages): `npm run build:editor` -> editor/dist.
// Relative base so it works under any Pages path (https://<owner>.github.io/tree.js/).
// The library's textures (assets/textures/) are copied to dist/textures/ (publicDir). In the build,
// src/textures ends up in a chunk in dist/assets/, so its default texture path is ../textures/;
// in dev it is ../../assets/textures/ from src/textures/ (served from the repo, as for the examples).
import { defineConfig } from 'vite';
import { packageAliases, textureDefine } from '../vite.config';

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
    sourcemap: true,
    // three.js itself is most of the app.
    chunkSizeWarningLimit: 1500,
  },
}));
