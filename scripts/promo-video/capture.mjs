// Captures the promo video (scripts/promo-video/main.ts) frame by frame into an H.264 MP4 that loops:
//   npm run promo-video                                   # promo-video.mp4: 1920x1080, 60 fps, 30 s
//   npm run promo-video -- --out my.mp4 --from 20 --to 26 # a part (seconds)
//   npm run promo-video -- --stills 2,9,15,19,24,28      # PNG stills only (promo-<t>.png), for a quick look
//   npm run promo-video -- --swiftshader                  # no GPU: SwiftShader (slow at 1080p)
//   PROMO_PORT=5281 npm run promo-video                   # another dev server port (default 5199, or the next free one)
// Frames are rendered offline (one at a time, Wind time pinned to the frame), so the video is smooth
// at 60 fps whatever the machine; a GPU makes it minutes instead of hours. Needs ffmpeg with libx264.
/* global window, navigator, process, console */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(root, option('out', 'promo-video.mp4'));
const WIDTH = Number(option('width', 1920));
const HEIGHT = Number(option('height', 1080));
const PORT = Number(process.env.PROMO_PORT ?? 5199);
const stills = option('stills', null)?.split(',').map(Number);

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { port: PORT, strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, ''); // the next free port when PORT is taken

const gpu = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu'];
const swiftshader = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: args.includes('--swiftshader') ? swiftshader : gpu });

let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && console.error(`console: ${message.text()}`));
  await page.goto(`${BASE}/scripts/promo-video/`);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.promo?.status), null, { timeout: 300_000 });
  const state = await page.evaluate(() => ({ status: window.promo.status, error: window.promo.error, frames: window.promo.frames, fps: window.promo.fps }));
  if (state.status === 'error') throw new Error(state.error);
  const adapter = await page.evaluate(async () => (await navigator.gpu?.requestAdapter())?.info?.architecture ?? 'webgl');
  console.log(`renderer: ${adapter}, ${WIDTH}x${HEIGHT}`);

  if (stills) {
    for (const t of stills) {
      // Frames in order up to t (Wind Bursts depend on it) would be slow: a still only shows the frame.
      await page.evaluate((frame) => window.promo.show(frame), Math.round(t * state.fps));
      const file = resolve(root, `promo-${t}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  } else {
    const first = Math.round(Number(option('from', 0)) * state.fps);
    const last = Math.min(state.frames, Math.round(Number(option('to', state.frames / state.fps)) * state.fps));
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(state.fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film',
      '-r', String(state.fps), '-movflags', '+faststart', out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, fail) => ffmpeg.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))));
    const started = Date.now();
    for (let frame = first; frame < last; frame++) {
      await page.evaluate((i) => window.promo.show(i), frame);
      const png = await page.screenshot({ type: 'png' });
      if (!ffmpeg.stdin.write(png)) await new Promise((ok) => ffmpeg.stdin.once('drain', ok));
      if ((frame - first) % 60 === 59) {
        const rate = (frame - first + 1) / ((Date.now() - started) / 1000);
        console.log(`frame ${frame + 1}/${last}  ${rate.toFixed(1)} frames/s`);
      }
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`${out}  ${last - first} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
