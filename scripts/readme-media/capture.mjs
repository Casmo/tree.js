// Captures the README's screenshots and GIFs into docs/images/.
//   npm run build && npm run readme-media            # everything
//   npm run readme-media -- hero wind                # only these outputs
// Renders headless with SwiftShader (like the e2e tests), so it runs without a GPU. Needs ffmpeg on
// the PATH for the GIFs and side-by-side images, and the built library (dist/) for the CDN example.
/* global window, document, requestAnimationFrame, console, process, URL */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'docs/images');
const PORT = 5198;
const BASE = `http://localhost:${PORT}`;

/** A scene of scripts/readme-media/main.ts: one still (.png) or an animation (.gif). */
const shot = (name, width, height, extra = '') => ({ url: `/scripts/readme-media/?shot=${name}${extra}`, width, height, ready: 'readmeShot' });

const JOBS = {
  hero: { ...shot('hero', 720, 300), gif: { fps: 10, colors: 96, dither: 'none' } },
  'quick-start': shot('quick-start', 720, 405),
  renderer: { side: [shot('renderer', 480, 320), shot('renderer', 480, 320, '&backend=webgl')] },
  styles: shot('styles', 1280, 320),
  seeds: shot('seeds', 960, 320),
  // Painterly from above (#122): a Forest from a tycoon camera (about 55°) and one tree straight down.
  'painterly-views': {
    side: [
      { url: '/examples/forest/?style=painterly&view=tycoon&trees=120', width: 480, height: 360, ready: 'forestExample' },
      { url: '/examples/vanilla/?style=painterly&form=broadleaf&seed=1&view=top', width: 480, height: 360, ready: 'treeExample' },
    ],
  },
  // Twist (#136): Twist Styles side by side, Follow Twist off and on, an extreme Corkscrew.
  'twist-styles': shot('twist-styles', 1280, 400),
  'follow-twist': shot('follow-twist', 960, 480),
  'corkscrew-extreme': shot('corkscrew-extreme', 640, 480),
  'growth-season': { ...shot('growth-season', 400, 400), gif: { fps: 12, colors: 128 } },
  wind: { ...shot('wind', 640, 320), gif: { fps: 15, colors: 128 } },
  forest: shot('forest', 960, 400),
  'material-features': { url: '/examples/material-features/?style=stylized', width: 960, height: 400, ready: 'featuresExample' },
  effects: { side: [shot('effects', 480, 360, '&effects=0'), shot('effects', 480, 360, '&effects=1')] },
  'scene-pipeline': {
    side: ['plain', 'style'].map((scene) => ({ url: `/examples/scene-pipeline/?style=stylized&scene=${scene}`, width: 480, height: 360, ready: 'scenePipelineExample' })),
  },
  baked: { ...shot('baked', 400, 360), gif: { fps: 15, colors: 64 } },
  textures: shot('textures', 960, 400),
  react: { url: '/examples/react/', width: 720, height: 405, ready: 'reactExample' },
  cdn: { url: 'https://example.test/', width: 720, height: 405, ready: 'cdn', gif: { fps: 12, colors: 128 } },
  editor: { url: '/editor/?start=stylized/broadleaf&seed=3', width: 1280, height: 720, ready: 'treeEditor' },
  'example-vanilla': { url: '/examples/vanilla/?style=low-poly&form=conifer&seed=2&season=0.7', width: 480, height: 300, ready: 'treeExample' },
  'example-cdn': { url: 'https://example.test/', width: 480, height: 300, ready: 'cdn' },
  'example-react': { url: '/examples/react/?scene=forest', width: 480, height: 300, ready: 'reactExample' },
  'example-forest': { url: '/examples/forest/?season=0.6', width: 480, height: 300, ready: 'forestExample' },
  'example-large-forest': { url: '/examples/large-forest/?frames=3&orbit=30', width: 480, height: 300, ready: 'largeForestExample', hide: ['#panel'] },
  'example-effects': { url: '/examples/effects/?style=stylized', width: 480, height: 300, ready: 'effectsExample' },
  'example-custom-effect': { url: '/examples/custom-effect/', width: 480, height: 300, ready: 'customEffectExample' },
  'example-material-features': { url: '/examples/material-features/?style=realistic', width: 480, height: 300, ready: 'featuresExample' },
  'example-scene-pipeline': { url: '/examples/scene-pipeline/?style=realistic', width: 480, height: 300, ready: 'scenePipelineExample' },
  'example-species': { url: '/examples/species/?species=maple&style=stylized&season=0.62', width: 480, height: 300, ready: 'speciesExample' },
};

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };

/** Answers the CDN example's import map from local files (three.js and the built dist/), as e2e/cdn.spec.ts does. */
async function serveCdnExample(page) {
  if (!existsSync(join(root, 'dist/index.js'))) throw new Error('The CDN example needs the built library: run `npm run build` first.');
  const sites = {
    'https://example.test/': join(root, 'examples/cdn'),
    'https://cdn.jsdelivr.net/npm/three@0.187.0/': join(root, 'node_modules/three'),
    'https://cdn.jsdelivr.net/npm/@casmo/tree.js/': root,
  };
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const prefix = Object.keys(sites).find((p) => url.startsWith(p));
    if (!prefix) return route.continue();
    let file = join(sites[prefix], decodeURIComponent(new URL(url).pathname.slice(new URL(prefix).pathname.length)));
    if (existsSync(file) && statSync(file).isDirectory()) file += '/index.html';
    if (!existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
}

const twoFrames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

/** Opens a job's page and waits until it has drawn; returns the element to screenshot. */
async function open(browser, job) {
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height } });
  page.on('pageerror', (error) => console.error(`  page error: ${error.message}`));
  if (job.ready === 'cdn') await serveCdnExample(page);
  await page.goto(job.url.startsWith('http') ? job.url : BASE + job.url);
  // No overlays: the examples' status lines are for the tests, not for the pictures.
  await page.addStyleTag({ content: `${['#status', ...(job.hide ?? [])].join(', ')} { display: none !important; }` });
  if (job.ready === 'cdn') {
    await page.waitForFunction(() => document.body.dataset.status !== undefined, null, { timeout: 120_000 });
  } else if (job.ready === 'treeEditor') {
    await page.waitForFunction(() => window.treeEditor?.status === 'rendered', null, { timeout: 120_000 });
  } else {
    await page.waitForFunction((key) => ['ready', 'rendered', 'error'].includes(window[key]?.status), job.ready, { timeout: 120_000 });
    const state = await page.evaluate((key) => window[key], job.ready);
    if (state.status === 'error') throw new Error(`${job.url}: ${state.error}`);
  }
  await page.evaluate(twoFrames);
  return page;
}

/** Writes frames 0..n-1 of a job into dir as 000.png, 001.png, ...; returns n. */
async function frames(browser, job, dir) {
  const page = await open(browser, job);
  let count = 1;
  if (job.ready === 'readmeShot') {
    count = await page.evaluate(() => window.readmeShot.frames);
    for (let i = 0; i < count; i++) {
      await page.evaluate((frame) => window.readmeShot.show(frame), i);
      await page.screenshot({ path: join(dir, `${String(i).padStart(3, '0')}.png`) });
    }
  } else if (job.ready === 'cdn' && job.gif) {
    // Drag the Growth slider down and up again.
    count = 48;
    for (let i = 0; i < count; i++) {
      const growth = Math.abs(1 - (2 * i) / (count - 1)) ** 0.8;
      await page.locator('#growth').fill(growth.toFixed(2));
      await page.evaluate(twoFrames);
      await page.screenshot({ path: join(dir, `${String(i).padStart(3, '0')}.png`) });
    }
  } else {
    if (job.ready === 'treeEditor') await page.waitForTimeout(500);
    await page.screenshot({ path: join(dir, '000.png') });
  }
  await page.close();
  return count;
}

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

async function capture(browser, name, job) {
  const dir = mkdtempSync(join(tmpdir(), `readme-${name}-`));
  try {
    if (job.side) {
      const parts = [];
      for (const [i, part] of job.side.entries()) {
        const partDir = join(dir, String(i));
        mkdirSync(partDir);
        await frames(browser, part, partDir);
        parts.push('-i', join(partDir, '000.png'));
      }
      // Two renders side by side, with a thin white divider.
      ffmpeg(...parts, '-filter_complex', '[0]pad=iw+4:ih:0:0:white[a];[a][1]hstack', '-frames:v', '1', '-update', '1', join(out, `${name}.png`));
      return `${name}.png`;
    }
    await frames(browser, job, dir);
    if (!job.gif) {
      ffmpeg('-i', join(dir, '000.png'), '-frames:v', '1', '-update', '1', join(out, `${name}.png`));
      return `${name}.png`;
    }
    const { fps, colors, dither = 'bayer:bayer_scale=3' } = job.gif;
    ffmpeg(
      '-framerate', String(fps), '-i', join(dir, '%03d.png'),
      '-filter_complex', `split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`,
      '-loop', '0', join(out, `${name}.gif`),
    );
    return `${name}.gif`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  for (const [name, job] of Object.entries(JOBS)) {
    if (only.length && !only.includes(name)) continue;
    const started = Date.now();
    try {
      const file = await capture(browser, name, job);
      const kb = Math.round(statSync(join(out, file)).size / 1024);
      console.log(`${file}  ${kb} kB  ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      failed = true;
      console.error(`${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
