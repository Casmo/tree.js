import { expect, test, type Page } from '@playwright/test';

// Forest Detail Levels (ADR 0010) in examples/forest: `?lod=<light>,<impostor>[,<fade>]`. The camera is at
// (0, 22, 46) over a 400-tree grid about 60 m across, so trees are 30 to 85 m away: with light = 55 the
// near half draws Full and the far half Light; with lod=40,60 every Detail Level is on screen.

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

test('far trees draw as lit Impostors: trees at every Detail Level', async ({ page }) => {
  // Full up to 40 m, Light to 60 m, Impostors beyond (the Impostors were baked before lodReady resolved).
  const { result, errors } = await render(page, 'trees=400&lod=40,60');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.full).toBeGreaterThan(50);
  expect(result.levels!.light).toBeGreaterThan(50);
  expect(result.levels!.impostor).toBeGreaterThan(50);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-webgpu.png', mask(page));
});

test('Impostor and Light trees cross-fade side by side in the fade band', async ({ page }) => {
  // fade 0.5: everything from 45 to 75 m is between Light and Impostor.
  const { result, errors } = await render(page, 'trees=400&lod=40,60,0.5');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.full + result.levels!.light + result.levels!.impostor).toBeGreaterThan(400 + 200);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-fade-webgpu.png', mask(page));
  const first = await page.locator('canvas').screenshot();
  await page.evaluate(() => window.forestExample.renderAgain!());
  expect((await page.locator('canvas').screenshot()).equals(first)).toBe(true);
});

test('Impostors cast tree-shaped shadows', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=40,60&shadows=1');
  expect(errors).toEqual([]);
  expect(result.levels!.impostor).toBeGreaterThan(50);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-shadows-webgpu.png', mask(page));
});

test('trees below Growth 1 stay Light and become Impostors once fully grown', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=30,45&growth=0.95');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.impostor).toBe(0);
  expect(result.levels!.light).toBeGreaterThan(300);
  await page.evaluate(() => window.forestExample.setGrowth!(1));
  const grown = await page.evaluate(() => window.forestExample);
  expect(grown.levels).toEqual(grown.expectedLevels);
  expect(grown.levels!.impostor).toBeGreaterThan(200);
});

test('the Impostor atlas follows lod.impostorAtlas', async ({ page }) => {
  // A small atlas still draws every far tree as an Impostor.
  const { result, errors } = await render(page, 'trees=400&lod=40,60&atlas=4,256');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.impostor).toBeGreaterThan(50);
});

test('Light trees follow Season and Growth like Full ones', async ({ page }) => {
  // Autumn (leaves turning and dropping) on a forest at Growth 0.95.
  const { result, errors } = await render(page, 'trees=400&lod=55,200&season=0.66&growth=0.95');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.light).toBeGreaterThan(100);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-autumn-webgpu.png', mask(page));
});

test('lod.camera picks the levels for that camera, not the one drawing', async ({ page }) => {
  // The camera that picks the levels (lod.camera) is 40 m behind the view: almost every tree is past 55 m from it.
  const { result, errors } = await render(page, 'trees=400&lod=55,200&lodCamera=1');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  expect(result.levels!.full).toBeLessThan(20);
});

test('shadow passes draw the levels of the camera that picks them', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=55,200&shadows=1');
  expect(errors).toEqual([]);
  expect(result.levels).toEqual(result.expectedLevels);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-shadows-webgpu.png', mask(page));
});

test('planting past a Variant capacity and cutting trees keeps the levels right', async ({ page }) => {
  // 200 more trees (50 cut again) after Detail Levels are on: every Variant grows past 128.
  const { result, errors } = await render(page, 'trees=400&lod=55,200&plant=200');
  expect(errors).toEqual([]);
  expect(result.trees).toBe(550);
  expect(result.levels).toEqual(result.expectedLevels);
});

// The WebGL2 fallback with lod is in forest.spec.ts, next to the screenshot it must match.
