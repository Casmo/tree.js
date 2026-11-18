/* eslint-disable */
// TEMPORARY: renders every concept of concepts/main.ts (all variants) into concepts/images/<concept>.png.
//   node concepts/capture.mjs              # all
//   node concepts/capture.mjs bloom gtao   # some
// Headless SwiftShader like scripts/readme-media, so no GPU needed; needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'concepts/images');
const PORT = 5199;
const W = 480, H = 360;
/** Concepts rendered at a lower resolution and blown up (to see pixel-level differences). */
const SCALE = { 'anti-aliasing': 2 };

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});

async function load(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => ['rendered', 'error'].includes(window.concept?.status), null, { timeout: 240_000 });
  const state = await page.evaluate(() => window.concept);
  if (state.status === 'error') throw new Error(state.error);
  return state;
}

let failed = false;
try {
  const listPage = await browser.newPage();
  const { list } = await load(listPage, `http://localhost:${PORT}/concepts/?list`);
  await listPage.close();
  const only = process.argv.slice(2);
  for (const [name, variants] of Object.entries(list)) {
    if (only.length && !only.includes(name)) continue;
    const started = Date.now();
    const dir = mkdtempSync(join(tmpdir(), `concept-${name}-`));
    try {
      const scale = SCALE[name] ?? 1;
      const files = [];
      for (let v = 0; v < variants.length; v++) {
        const page = await browser.newPage({ viewport: { width: W, height: H } });
        page.on('pageerror', (e) => console.error(`  ${name}[${v}] page error: ${e.message}`));
        await load(page, `http://localhost:${PORT}/concepts/?c=${name}&v=${v}&scale=${scale}`);
        const file = join(dir, `${v}.png`);
        await page.screenshot({ path: file });
        await page.close();
        files.push(file);
      }
      const inputs = files.flatMap((f) => ['-i', f]);
      const target = join(out, `${name}.png`);
      const pads = files.map((_, i) => `[${i}]pad=iw+4:ih+4:2:2:white[p${i}]`).join(';');
      const tags = files.map((_, i) => `[p${i}]`).join('');
      let filter;
      if (files.length === 4) filter = `${pads};${tags}xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0`;
      else filter = `${pads};${tags}hstack=inputs=${files.length}`;
      ffmpeg(...inputs, '-filter_complex', filter, '-frames:v', '1', '-update', '1', target);
      console.log(`${name}.png  ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      failed = true;
      console.error(`${name}: ${error instanceof Error ? error.message : error}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
