import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

test('renders a tree with branches and leaves on the WebGPU backend', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1');
  const result = await waitForExample(page);
  expect(result).toEqual({ status: 'rendered', backend: 'webgpu' });
  await expect(page.locator('canvas')).toHaveScreenshot('tree-webgpu.png', { mask: [page.locator('#status')] });
});

test('renders a tree with branches and leaves on the WebGL2 fallback of WebGPURenderer', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1&backend=webgl');
  const result = await waitForExample(page);
  expect(result).toEqual({ status: 'rendered', backend: 'webgl2' });
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

for (const backend of ['webgpu', 'webgl2'] as const) {
  test(`Wind bends the tree and its shadow (${backend})`, async ({ page }) => {
    const query = `seed=1&shadows=1&windTime=2${backend === 'webgl2' ? '&backend=webgl' : ''}`;
    const canvas = page.locator('canvas');
    const mask = { mask: [page.locator('#status')] };

    await page.goto(`/examples/vanilla/?${query}&wind=0`);
    expect(await waitForExample(page)).toEqual({ status: 'rendered', backend });
    const calm = await canvas.screenshot(mask);

    await page.goto(`/examples/vanilla/?${query}&wind=2`);
    expect(await waitForExample(page)).toEqual({ status: 'rendered', backend });
    const windy = await canvas.screenshot(mask);
    expect(windy.equals(calm)).toBe(false);
    await expect(canvas).toHaveScreenshot(`tree-wind-${backend}.png`, mask);
  });
}
