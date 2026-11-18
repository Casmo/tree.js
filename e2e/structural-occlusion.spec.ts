import { expect, test, type Page } from '@playwright/test';

// Structural Occlusion (#55): `materials.occlusion` darkens the ambient light deep in the crown and on
// the trunk under it. Off is today's look; on (here at full strength, so it shows clearly) only adds the
// tree's own baked occlusion to its materials.

async function renderTree(page: Page, query: string) {
  await page.goto(`/examples/vanilla/?${query}`);
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.treeExample)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });

for (const style of ['low-poly', 'stylized', 'realistic']) {
  test(`${style}: Structural Occlusion off and on`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await renderTree(page, `style=${style}&species=oak&seed=1`);
    const off = await page.locator('canvas').screenshot(mask(page));
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-oak-occlusion-off.png`, mask(page));

    await renderTree(page, `style=${style}&species=oak&seed=1&occlusion=1`);
    const on = await page.locator('canvas').screenshot(mask(page));
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-oak-occlusion-on.png`, mask(page));
    expect(on.equals(off)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('a Forest with Structural Occlusion: every Variant has its own bake', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/examples/forest/?trees=100&style=stylized&occlusion=1');
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.forestExample)).toMatchObject({ status: 'rendered', backend: 'webgpu', drawCalls: 4 * 2 + 2 });
  expect(errors).toEqual([]);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-stylized-occlusion-webgpu.png', mask(page));
});
