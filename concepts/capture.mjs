/* eslint-disable */
// TEMPORARY: renders every Painterly concept of concepts/main.ts (all variants x all views) into
// concepts/images/<concept>.png (rows = variants, columns = views), plus concepts/images/overview.png.
//   env -u DISPLAY node concepts/capture.mjs           # all
//   env -u DISPLAY node concepts/capture.mjs A tier    # some
//   env -u DISPLAY node concepts/capture.mjs A:1@0     # one pane (variant 1, view 0) -> /tmp/concept-A-1-0.png
// Headless SwiftShader like scripts/readme-media, so no GPU needed; needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'concepts/images');
const PORT = Number(process.env.PORT ?? 5198);
const W = 640, H = 480;
/** The panes of the overview image: [concept, variant] in the tycoon view. */
const OVERVIEW = [
  ['current', 0], ['B', 1], ['D', 1], ['BD', 0],
  ['B-more', 0], ['B-more', 2], ['D-more', 0], ['D-more', 6],
  ['saturation', 1], ['saturation', 4], ['grove', 0], ['grove', 1],
];

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

/** Joins equally sized images into a grid of `cols` columns (2 px white border around each). */
function grid(files, cols, target) {
  const rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap((f) => ['-i', f]);
  const pads = files.map((_, i) => `[${i}]pad=iw+4:ih+4:2:2:white[p${i}]`).join(';');
  const tags = files.map((_, i) => `[p${i}]`).join('');
  const layout = files.map((_, i) => `${(i % cols) * (W + 4)}_${Math.floor(i / cols) * (H + 4)}`).join('|');
  const filter = files.length === 1 ? '[0]pad=iw+4:ih+4:2:2:white' : `${pads};${tags}xstack=inputs=${files.length}:layout=${layout}:fill=white`;
  ffmpeg(...inputs, '-filter_complex', filter, '-frames:v', '1', '-update', '1', target);
  return rows;
}

mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});

async function load(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => ['rendered', 'error'].includes(window.concept?.status), null, { timeout: 600_000 });
  const state = await page.evaluate(() => window.concept);
  if (state.status === 'error') throw new Error(state.error);
  return state;
}

/** Renders every view of one variant; returns the files. */
async function variantViews(name, v, views, dir, onlyView = null) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error(`  ${name}[${v}] page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`  ${name}[${v}] ${m.text()}`); });
  await load(page, `http://localhost:${PORT}/concepts/?c=${name}&v=${v}&view=${onlyView ?? 0}`);
  const files = [];
  for (let i = 0; i < views.length; i++) {
    if (onlyView !== null && i !== onlyView) continue;
    if (i !== (onlyView ?? 0)) await page.evaluate((x) => window.showView(x), i);
    const file = join(dir, `${name}-${v}-${i}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await page.close();
  return files;
}

let failed = false;
const tmp = mkdtempSync(join(tmpdir(), 'painterly-concepts-'));
try {
  const listPage = await browser.newPage();
  const { list, views } = await load(listPage, `http://localhost:${PORT}/concepts/?list`);
  await listPage.close();
  const only = process.argv.slice(2);
  const single = only.find((a) => a.includes(':'));
  if (single) {
    const [name, rest] = single.split(':');
    const [v, view] = rest.split('@').map(Number);
    const [file] = await variantViews(name, v, views, tmp, Number.isNaN(view) ? 0 : view);
    const target = `/tmp/concept-${name}-${v}-${Number.isNaN(view) ? 0 : view}.png`;
    copyFileSync(file, target);
    console.log(target);
  } else {
    const panes = {};
    for (const [name, variants] of Object.entries(list)) {
      if (only.length && !only.includes(name)) continue;
      const started = Date.now();
      try {
        const files = [];
        for (let v = 0; v < variants.length; v++) {
          const f = await variantViews(name, v, views, tmp);
          files.push(...f);
          panes[`${name}:${v}`] = f[0];
        }
        grid(files, views.length, join(out, `${name}.png`));
        console.log(`${name}.png  ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        failed = true;
        console.error(`${name}: ${error instanceof Error ? error.stack : error}`);
      }
    }
    if (!only.length || only.includes('overview')) {
      const files = [];
      for (const [name, v] of OVERVIEW) files.push(panes[`${name}:${v}`] ?? (await variantViews(name, v, views, tmp, 0))[0]);
      grid(files, 4, join(out, 'overview.png'));
      console.log('overview.png');
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
