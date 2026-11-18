/* global console, process, URLSearchParams, window */
// Renders Species in every Style with the e2e renderer (headless Chromium, SwiftShader WebGPU) through
// the vanilla example (`examples/vanilla/?species=<id>&style=<style>`), for checking how they look.
//
//   node scripts/render-species.mjs [outDir] [id ...] [--season=0.37] [--seed=1] [--port=5198]
//
// Writes <outDir>/<id>-<style>.png (outDir default: species-renders/), all Species when no id is given.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { speciesIds } from './generate-species.mjs';

const STYLES = ['low-poly', 'stylized', 'realistic'];
const options = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')),
);
const [outDir = 'species-renders', ...ids] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const species = ids.length > 0 ? ids : speciesIds();
const port = Number(options.port ?? 5198);

mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  for (const id of species) {
    for (const style of STYLES) {
      const query = new URLSearchParams({ species: id, style, season: options.season ?? '0.37', seed: options.seed ?? '1' });
      await page.goto(`http://localhost:${port}/examples/vanilla/?${query}`);
      await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 60_000 });
      const state = await page.evaluate(() => window.treeExample);
      if (state.status !== 'rendered') throw new Error(`${id} / ${style}: ${state.error}`);
      const file = resolve(outDir, `${id}-${style}.png`);
      await page.locator('canvas').screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
