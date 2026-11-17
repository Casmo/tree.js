import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

test('renders a tree with branches and leaves on the WebGPU backend', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1');
  const result = await waitForExample(page);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
  await expect(page.locator('canvas')).toHaveScreenshot('tree-webgpu.png', { mask: [page.locator('#status')] });
});

test('renders a tree with branches and leaves on the WebGL2 fallback of WebGPURenderer', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1&backend=webgl');
  const result = await waitForExample(page);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgl2' });
  await expect(page.locator('canvas')).toHaveScreenshot('tree-webgl2.png', { mask: [page.locator('#status')] });
});

test('another Seed grows a visibly different tree of the same kind', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=2');
  expect((await waitForExample(page)).status).toBe('rendered');
  await expect(page.locator('canvas')).toHaveScreenshot('tree-seed-2-webgpu.png', { mask: [page.locator('#status')] });
});

test('the classic WebGLRenderer gets a clear error pointing to WebGPURenderer', async ({ page }) => {
  await page.goto('/examples/vanilla/?renderer=classic');
  const result = await waitForExample(page);
  expect(result.status).toBe('error');
  expect(result.error).toMatch(/requires WebGPURenderer/);
});

test.describe('Season', () => {
  for (const [name, season] of [
    ['spring', 0.12],
    ['autumn', 0.62],
    ['winter', 0.87],
  ] as const) {
    test(`the deciduous broadleaf in ${name}`, async ({ page }) => {
      await page.goto(`/examples/vanilla/?seed=1&season=${season}`);
      expect((await waitForExample(page)).status).toBe('rendered');
      await expect(page.locator('canvas')).toHaveScreenshot(`broadleaf-${name}.png`, { mask: [page.locator('#status')] });
    });
  }

  test('the evergreen conifer stays full in winter', async ({ page }) => {
    await page.goto('/examples/vanilla/?seed=1&form=conifer&season=0.87');
    expect((await waitForExample(page)).status).toBe('rendered');
    await expect(page.locator('canvas')).toHaveScreenshot('conifer-winter.png', { mask: [page.locator('#status')] });
  });

  test('changing Season on a live tree only touches uniforms (no regeneration)', async ({ page }) => {
    await page.goto('/examples/vanilla/?seed=1&season=0.37');
    expect((await waitForExample(page)).status).toBe('rendered');
    const before = await page.evaluate(() => window.treeExample.leafGeometryId);
    await page.evaluate(() => window.treeExample.setSeason!(0.87));
    await page.waitForFunction(() => window.treeExample.status === 'rendered');
    expect(await page.evaluate(() => window.treeExample.leafGeometryId)).toBe(before);
    await expect(page.locator('canvas')).toHaveScreenshot('broadleaf-winter.png', { mask: [page.locator('#status')] });
  });
});
