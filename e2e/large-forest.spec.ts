import { expect, test, type Page } from '@playwright/test';

// examples/large-forest: a Forest with Detail Levels on or off, measured over a fixed number of frames.
// SwiftShader is slow, so the tests use fewer trees and frames than the example's defaults (10,000 / 120),
// and pin the camera. Frame times are reported, never asserted: CI hardware varies.

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/large-forest/?${query}`);
  await page.waitForFunction(() => window.largeForestExample?.status !== 'loading', null, { timeout: 120_000 });
  return { result: await page.evaluate(() => window.largeForestExample), errors };
}

const QUERY = 'trees=2000&frames=5&orbit=30';

test('draws a large forest by Detail Level and reports the run', async ({ page }) => {
  test.setTimeout(180_000);
  const { result, errors } = await open(page, QUERY);
  expect(errors).toEqual([]);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu', trees: 2000, lod: true });
  const run = result.runs!.on!;
  expect(result.runs!.off).toBeUndefined();
  // Every tree is at some Detail Level (trees in a fade band count at both), and all three are on screen.
  const { full, light, impostor } = run.levels;
  expect(full + light + impostor).toBeGreaterThanOrEqual(2000);
  expect(full).toBeGreaterThan(0);
  expect(light).toBeGreaterThan(0);
  expect(impostor).toBeGreaterThan(0);
  expect(run.drawCalls).toBeGreaterThan(0);
  expect(run.triangles).toBeGreaterThan(0);
  expect(run.frameTime.frames).toBe(5);
  expect(run.frameTime.average).toBeGreaterThan(0);
  // The panel shows the numbers.
  await expect(page.locator('#rows')).toContainText('trees Impostor');
  await expect(page.locator('#rows')).toContainText(impostor.toLocaleString('en'));
  console.log(`large-forest, 2000 trees, Detail Levels on: ${JSON.stringify(run)}`);
});

test('rebuilding without Detail Levels draws every tree in full, with more triangles', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await open(page, QUERY);
  await page.evaluate(() => window.largeForestExample.setLod!(false));
  const result = await page.evaluate(() => window.largeForestExample);
  expect(errors).toEqual([]);
  expect(result).toMatchObject({ status: 'rendered', lod: false, trees: 2000 });
  const { on, off } = result.runs!;
  expect(off!.levels).toEqual({ full: 2000, light: 0, impostor: 0 });
  // The same views: Detail Levels draw far fewer triangles (counted from the indirect draw arguments).
  expect(on!.triangles).toBeLessThan(off!.triangles / 2);
  // Both runs stay in the panel.
  await expect(page.locator('#rows')).toContainText(off!.triangles.toLocaleString('en'));
  await expect(page.locator('#rows')).toContainText(on!.triangles.toLocaleString('en'));
  console.log(`large-forest, 2000 trees: off ${JSON.stringify(off!.frameTime)}, on ${JSON.stringify(on!.frameTime)}`);
});

test('?lod=0 starts without Detail Levels; the toggle button rebuilds with them', async ({ page }) => {
  test.setTimeout(240_000);
  const { result, errors } = await open(page, `${QUERY}&lod=0`);
  expect(result).toMatchObject({ status: 'rendered', lod: false });
  expect(result.runs!.on).toBeUndefined();
  await page.locator('#toggle').click();
  await page.waitForFunction(() => window.largeForestExample.status === 'rendered' && window.largeForestExample.lod === true, null, {
    timeout: 120_000,
  });
  const after = await page.evaluate(() => window.largeForestExample);
  expect(errors).toEqual([]);
  expect(after.runs!.on!.levels.impostor).toBeGreaterThan(0);
  expect(after.runs!.on!.triangles).toBeLessThan(after.runs!.off!.triangles);
});
