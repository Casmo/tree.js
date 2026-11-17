import { expect, test, type Page } from '@playwright/test';

async function render(page: Page, query: string) {
  await page.goto(`/examples/vanilla/?seed=1&${query}`);
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

// Growth order: a small slender sapling, then first-level branches, then second-level ones,
// then leaves late. Growth 1 is the plain static tree (tree-webgpu.png in tree.spec.ts).
for (const growth of [0, 0.3, 0.55, 0.8]) {
  test(`Growth ${growth} on the WebGPU backend`, async ({ page }) => {
    expect(await render(page, `growth=${growth}`)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    await expect(page.locator('canvas')).toHaveScreenshot(`growth-${growth}-webgpu.png`, { mask: [page.locator('#status')] });
  });
}

test('Growth on the WebGL2 fallback of WebGPURenderer', async ({ page }) => {
  expect(await render(page, 'growth=0.55&backend=webgl')).toMatchObject({ status: 'rendered', backend: 'webgl2' });
  await expect(page.locator('canvas')).toHaveScreenshot('growth-0.55-webgl2.png', { mask: [page.locator('#status')] });
});
