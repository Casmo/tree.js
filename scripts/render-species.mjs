/* global console, process */
// Renders Species in every Style with the e2e renderer (headless Chromium, SwiftShader WebGPU) through
// the vanilla example (`examples/vanilla/?species=<id>&style=<style>`), for checking how they look.
// (The committed gallery, docs/species/, is made by `npm run gallery`.)
//
//   node scripts/render-species.mjs [outDir] [id ...] [--season=<summer>] [--seed=1] [--port=5198]
//
// Writes <outDir>/<id>-<style>.png (outDir default: species-renders/), all Species when no id is given.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { speciesIds } from './generate-species.mjs';
import { startSpeciesRenderer, STYLES, SUMMER } from './species-renderer.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')),
);
const [outDir = 'species-renders', ...ids] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const species = ids.length > 0 ? ids : speciesIds();

mkdirSync(outDir, { recursive: true });
const renderer = await startSpeciesRenderer({ port: Number(options.port ?? 5198) });
try {
  for (const id of species) {
    for (const style of STYLES) {
      const path = resolve(outDir, `${id}-${style}.png`);
      await renderer.render({ id, style, season: options.season ?? SUMMER, seed: options.seed ?? 1, path });
      console.log(path);
    }
  }
} finally {
  await renderer.close();
}
