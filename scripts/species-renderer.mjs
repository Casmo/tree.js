/* global URLSearchParams, window */
// Renders Species with the e2e renderer (headless Chromium, SwiftShader WebGPU, as playwright.config.ts)
// through the vanilla example (`examples/vanilla/?species=<id>&style=<style>&seed=&season=`), which
// frames the camera on the tree. Used by render-species.mjs (look checks) and render-gallery.mjs.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

export const STYLES = ['low-poly', 'stylized', 'realistic'];
export const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * Starts a Vite dev server and a headless browser. `render({ id, style, season, seed, path, type, quality })`
 * screenshots one tree (type 'png' or 'jpeg'); `browser` is shared for other pages; call `close()` at the end.
 */
export async function startSpeciesRenderer({ port = 5198, size = 640 } = {}) {
  const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  return {
    browser,
    async render({ id, style, season = 0.37, seed = 1, path, type = 'png', quality }) {
      const query = new URLSearchParams({ species: id, style, season: String(season), seed: String(seed) });
      await page.goto(`http://localhost:${port}/examples/vanilla/?${query}`);
      await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 60_000 });
      const state = await page.evaluate(() => window.treeExample);
      if (state.status !== 'rendered') throw new Error(`${id} / ${style}: ${state.error}`);
      await page.addStyleTag({ content: '#status { display: none; }' }); // the status line is for the tests
      await page.locator('canvas').screenshot({ path, type, ...(type === 'jpeg' ? { quality: quality ?? 80 } : {}) });
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
