import { expect, test, type Page } from '@playwright/test';

// Detail Levels through the Forest lifecycle (ADR 0010) in examples/forest: trees cut or planted while the
// forest draws by Detail Level (swap-remove, capacity growth on the GPU) leave the other trees as they were.
// Each test draws the same forest twice, changed before and after Detail Levels are on, against one screenshot.

async function render(page: Page, query: string) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/forest/?${query}`);
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 60_000 });
  return { result: await page.evaluate(() => window.forestExample), errors };
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });

test('cutting trees from a forest drawn by Detail Level looks like a forest planted without them', async ({ page }) => {
  const before = await render(page, 'trees=400&lod=55,200&cut=7');
  expect(before.errors).toEqual([]);
  expect(before.result).toMatchObject({ status: 'rendered', backend: 'webgpu', trees: 342 });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-cut-webgpu.png', mask(page));

  const after = await render(page, 'trees=400&lod=55,200&cut=7&cutLater=1');
  expect(after.errors).toEqual([]);
  expect(after.result.trees).toBe(342);
  expect(after.result.levels).toEqual(after.result.expectedLevels);
  expect(after.result.levels).toEqual(before.result.levels);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-cut-webgpu.png', mask(page));
});

test('planting past every Variant capacity and cutting those trees again leaves the forest as it was', async ({ page }) => {
  const before = await render(page, 'trees=400&lod=55,200');
  expect(before.errors).toEqual([]);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-replanted-webgpu.png', mask(page));

  // 200 more trees (each Variant grows past its capacity of 128), drawn, then all cut again.
  const after = await render(page, 'trees=400&lod=55,200&plant=200&unplant=1');
  expect(after.errors).toEqual([]);
  expect(after.result.trees).toBe(400);
  expect(after.result.levels).toEqual(before.result.levels);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-replanted-webgpu.png', mask(page));
});

test('trees planted past capacity draw at their Detail Level next to the ones planted before', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&lod=55,200&plant=200');
  expect(errors).toEqual([]);
  expect(result.trees).toBe(550);
  expect(result.levels).toEqual(result.expectedLevels);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-planted-webgpu.png', mask(page));
});
