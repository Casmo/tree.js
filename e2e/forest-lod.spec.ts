import { expect, test, type Page } from '@playwright/test';

// Forest Detail Levels (ADR 0010) in examples/forest: `?lod=<light>,<impostor>[,<fade>]`. The camera is at
// (0, 22, 46) over a 400-tree grid about 60 m across, so trees are 30 to 85 m away: with light = 55 the
// near half draws Full and the far half Light.

async function render(page: Page, query: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning' && m.text().includes('tree.js')) warnings.push(m.text());
  });
  await page.goto(`/examples/forest/?${query}`);
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 60_000 });
  return { result: await page.evaluate(() => window.forestExample), errors, warnings };
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });

test('near trees draw Full and far trees Light, picked per tree on the GPU', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=55,200');
  expect(errors).toEqual([]);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu', trees: 400 });
  // The compute pass sorts exactly the trees the CPU's selectDetailLevel picks into each level.
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.full).toBeGreaterThan(100);
  expect(result.levels!.light).toBeGreaterThan(100);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-webgpu.png', mask(page));
});

test('trees in the fade band cross-fade with a still ordered dither', async ({ page }) => {
  // fade 0.6: everything from 38.5 to 71.5 m is between Full and Light.
  const { result, errors } = await render(page, 'trees=400&lod=55,200,0.6');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  // Trees in the band are in both levels.
  expect(result.levels!.full + result.levels!.light).toBeGreaterThan(400 + 200);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-fade-webgpu.png', mask(page));
  // No temporal noise: the next frame is identical, pixel for pixel.
  const first = await page.locator('canvas').screenshot();
  await page.evaluate(() => window.forestExample.renderAgain!());
  const second = await page.locator('canvas').screenshot();
  expect(second.equals(first)).toBe(true);
});

test('trees past the Impostor distance draw Light until Impostors exist', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=30,45');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.impostor).toBe(0);
  expect(result.levels!.light).toBeGreaterThan(300);
});

test('lod.camera picks the levels for that camera, not the one drawing', async ({ page }) => {
  // The LOD camera is 40 m behind the view: almost every tree is past 55 m from it.
  const { result, errors } = await render(page, 'trees=400&lod=55,200&lodCamera=1');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.full).toBeLessThan(20);
});

test('shadow passes draw the levels of the LOD camera', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=55,200&shadows=1');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-shadows-webgpu.png', mask(page));
});

// The WebGL2 fallback with lod is in forest.spec.ts, next to the screenshot it must match.
