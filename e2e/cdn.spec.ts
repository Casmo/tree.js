import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requireBuild, serveStatic } from './static-site';

// The import map example (examples/cdn/index.html) runs untouched, without Vite: the page is served
// as a plain file and the CDN URLs in its import map are answered with the local three.js and the
// built library (`npm run build` -> dist/), so this checks the published ES modules work unbundled.
const root = resolve(import.meta.dirname, '..');
const CDN = 'https://cdn.jsdelivr.net/npm/';
const SITE = 'https://example.test/';

/** Pixels of the canvas that are not sky (trees and ground), decoded in the page. */
async function nonSkyPixels(page: Page): Promise<number> {
  const png = (await page.locator('canvas').screenshot()).toString('base64');
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - 0xcf) + Math.abs(data[i + 1]! - 0xe3) + Math.abs(data[i + 2]! - 0xf0) >= 12) count++;
    }
    return count;
  }, png);
}

test('the import map (CDN) example runs the built ES modules without a bundler', async ({ page }) => {
  requireBuild(resolve(root, 'dist/index.js'), 'npm run build');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requested = await serveStatic(page, {
    [SITE]: resolve(root, 'examples/cdn'),
    [`${CDN}three@0.187.0/`]: resolve(root, 'node_modules/three'),
    [`${CDN}@casmo/tree.js/`]: root,
  });

  await page.goto(SITE);
  await page.waitForFunction(() => document.body.dataset.status !== undefined, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.body.dataset.status)).toBe('rendered');

  // Everything came from the import map's URLs, including the lazily loaded Style chunk.
  expect(requested.filter((url) => !url.startsWith(CDN) && !url.startsWith(SITE) && !url.startsWith('data:'))).toEqual([]);
  expect(requested).toContain(`${CDN}@casmo/tree.js/dist/styles/low-poly.js`);

  const grown = await nonSkyPixels(page);
  expect(grown, 'the trees and the ground are drawn').toBeGreaterThan(20_000);
  // Growth is a uniform: the slider shrinks the trees to saplings.
  await page.locator('#growth').fill('0');
  await page.waitForTimeout(300);
  expect(await nonSkyPixels(page)).toBeLessThan(grown - 2_000);
});
