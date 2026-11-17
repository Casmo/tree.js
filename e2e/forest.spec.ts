import { expect, test, type Page } from '@playwright/test';

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

test('a forest of 400 trees costs one draw call per Variant and material (WebGPU)', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&variants=4');
  expect(errors).toEqual([]);
  // 4 Variants x (wood + leaves), plus the ground and the background.
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu', trees: 400, drawCalls: 4 * 2 + 2 });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-webgpu.png', mask(page));
});

test('a forest on the WebGL2 fallback of WebGPURenderer', async ({ page }) => {
  const { result, errors } = await render(page, 'trees=400&variants=4&backend=webgl');
  expect(errors).toEqual([]);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgl2', drawCalls: 10 });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-webgl2.png', mask(page));
});

test('per-tree Growth and Season: young at the back, autumn on the right', async ({ page }) => {
  const { result } = await render(page, 'trees=400&uneven=1');
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-uneven-webgpu.png', mask(page));
});

test('cutting trees leaves the others as they were', async ({ page }) => {
  const { result } = await render(page, 'trees=400&cut=3');
  expect(result).toMatchObject({ status: 'rendered', trees: 400 - Math.ceil(400 / 3) });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-cut-webgpu.png', mask(page));
});

test('Wind sways every tree with its own phase', async ({ page }) => {
  const { result } = await render(page, 'trees=400&wind=2&windTime=3');
  expect(result).toMatchObject({ status: 'rendered' });
  await expect(page.locator('canvas')).toHaveScreenshot('forest-wind-webgpu.png', mask(page));
});

for (const [style, form] of [
  ['stylized', 'broadleaf'],
  ['realistic', 'conifer'],
] as const) {
  test(`a ${style} ${form} forest (Style materials and textures, instanced)`, async ({ page }) => {
    const { result, errors } = await render(page, `trees=100&style=${style}&form=${form}`);
    expect(errors).toEqual([]);
    expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu', drawCalls: 4 * 2 + 2 });
    await expect(page.locator('canvas')).toHaveScreenshot(`forest-${style}-${form}-webgpu.png`, mask(page));
  });
}
