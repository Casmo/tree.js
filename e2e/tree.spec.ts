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

for (const backend of ['webgpu', 'webgl2'] as const) {
  test(`Wind bends the tree and its shadow, together with Season (autumn, ${backend})`, async ({ page }) => {
    const query = `seed=1&season=0.62&shadows=1&windTime=2${backend === 'webgl2' ? '&backend=webgl' : ''}`;
    const canvas = page.locator('canvas');
    const mask = { mask: [page.locator('#status')] };

    await page.goto(`/examples/vanilla/?${query}&wind=0`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend });
    const calm = await canvas.screenshot(mask);

    await page.goto(`/examples/vanilla/?${query}&wind=2`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend });
    const windy = await canvas.screenshot(mask);
    expect(windy.equals(calm)).toBe(false);
    await expect(canvas).toHaveScreenshot(`tree-wind-${backend}.png`, mask);
  });
}

test.describe('Fruit', () => {
  test('a tree without Fruit has an empty fruit mesh', async ({ page }) => {
    await page.goto('/examples/vanilla/?seed=1');
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', fruitVertices: 0 });
  });

  test('renders Fruit in its own mesh and ripens it over Season (uniforms only)', async ({ page }) => {
    const canvas = page.locator('canvas');
    const mask = { mask: [page.locator('#status')] };
    await page.goto('/examples/vanilla/?seed=1&fruit=round&season=0.3');
    const result = await waitForExample(page);
    expect(result.status).toBe('rendered');
    expect(result.fruitVertices).toBeGreaterThan(0);
    await expect(canvas).toHaveScreenshot('fruit-summer.png', mask);
    const summer = await canvas.screenshot(mask);

    await page.evaluate(() => window.treeExample.setSeason!(0.55));
    await page.waitForFunction(() => window.treeExample.status === 'rendered');
    const ripe = await canvas.screenshot(mask);
    expect(ripe.equals(summer)).toBe(false);
    await expect(canvas).toHaveScreenshot('fruit-ripe.png', mask);
  });

  test('Fruit has dropped in winter: the tree looks as without Fruit', async ({ page }) => {
    const canvas = page.locator('canvas');
    const mask = { mask: [page.locator('#status')] };
    await page.goto('/examples/vanilla/?seed=1&season=0.87');
    expect((await waitForExample(page)).status).toBe('rendered');
    const plain = await canvas.screenshot(mask);
    await page.goto('/examples/vanilla/?seed=1&fruit=round&season=0.87');
    expect((await waitForExample(page)).status).toBe('rendered');
    expect((await canvas.screenshot(mask)).equals(plain)).toBe(true);
  });
});
