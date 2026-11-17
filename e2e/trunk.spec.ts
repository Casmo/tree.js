import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

test('renders a trunk on the WebGPU backend', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1');
  const result = await waitForExample(page);
  expect(result).toEqual({ status: 'rendered', backend: 'webgpu' });
  await expect(page.locator('canvas')).toHaveScreenshot('trunk-webgpu.png', { mask: [page.locator('#status')] });
});

test('renders a trunk on the WebGL2 fallback of WebGPURenderer', async ({ page }) => {
  await page.goto('/examples/vanilla/?seed=1&backend=webgl');
  const result = await waitForExample(page);
  expect(result).toEqual({ status: 'rendered', backend: 'webgl2' });
  await expect(page.locator('canvas')).toHaveScreenshot('trunk-webgl2.png', { mask: [page.locator('#status')] });
});

test('the classic WebGLRenderer gets a clear error pointing to WebGPURenderer', async ({ page }) => {
  await page.goto('/examples/vanilla/?renderer=classic');
  const result = await waitForExample(page);
  expect(result.status).toBe('error');
  expect(result.error).toMatch(/requires WebGPURenderer/);
});
