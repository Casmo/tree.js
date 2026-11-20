import { expect, test, type Page } from '@playwright/test';

// Suggested Material Features (#57): per Style the same back-lit tree off and on with that Style's
// full SUGGESTED_MATERIAL_FEATURES (applied with withMaterialFeatures), the side-by-side example and a
// Forest with the features on. Off is today's look.

/** Renders an example page; returns its hook object and console errors. */
async function render(page: Page, path: string, hook: string) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/${path}`);
  await page.waitForFunction((h) => (window as unknown as Record<string, { status: string }>)[h]?.status !== 'loading', hook, {
    timeout: 60_000,
  });
  const result = await page.evaluate((h) => (window as unknown as Record<string, unknown>)[h], hook);
  return { result, errors };
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });

for (const style of ['low-poly', 'stylized', 'realistic', 'painterly']) {
  test(`${style}: suggested Material Features off and on`, async ({ page }) => {
    const query = `vanilla/?style=${style}&form=broadleaf&seed=1&backlight=1`;
    const off = await render(page, query, 'treeExample');
    expect(off.result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    const offShot = await page.locator('canvas').screenshot(mask(page));
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-features-off.png`, mask(page));

    const on = await render(page, `${query}&features=suggested`, 'treeExample');
    expect(on.result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    const onShot = await page.locator('canvas').screenshot(mask(page));
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-features-suggested.png`, mask(page));
    expect(onShot.equals(offShot)).toBe(false);
    expect([...off.errors, ...on.errors]).toEqual([]);
  });

  test(`${style}: the Material Features example shows off and suggested side by side`, async ({ page }) => {
    const { result, errors } = await render(page, `material-features/?style=${style}`, 'featuresExample');
    expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`example-${style}.png`, mask(page));
  });
}

test('a Forest with the suggested Material Features on', async ({ page }) => {
  const { result, errors } = await render(page, 'forest/?trees=100&style=stylized&features=suggested', 'forestExample');
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu', drawCalls: 4 * 2 + 2 });
  expect(errors).toEqual([]);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-stylized-features-suggested.png', mask(page));
});
