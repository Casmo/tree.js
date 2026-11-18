import { expect, test, type Page } from '@playwright/test';

// Leaf Translucency (#56, a Material Feature): the same back-lit scene per Style with the feature off
// and on. On, leaves seen against the low sun glow in their own Season colour (more at the crown's thin
// edge); leaves in shadow stay dark. Off must look like today.
async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

const styles = ['low-poly', 'stylized', 'realistic'];
const backlit = '&form=broadleaf&seed=1&backlight=1';
const TRANSLUCENCY = '&translucency=0.6,0.7,0.3';

const shots = [
  // Off and on per Style, the low sun behind the tree.
  ...styles.flatMap((style) => [
    { name: `${style}-backlit-off`, query: `?style=${style}${backlit}` },
    { name: `${style}-backlit-on`, query: `?style=${style}${backlit}${TRANSLUCENCY}` },
  ]),
  // With shadows: leaf cards in the shadow of other leaves don't glow, sunlit ones do.
  { name: 'realistic-backlit-shadows-off', query: `?style=realistic${backlit}&shadows=1` },
  { name: 'realistic-backlit-shadows-on', query: `?style=realistic${backlit}&shadows=1${TRANSLUCENCY}` },
  // Autumn leaves glow orange: the glow is the leaf's own Season colour.
  { name: 'stylized-backlit-autumn-on', query: `?style=stylized${backlit}${TRANSLUCENCY}&season=0.62` },
];

for (const { name, query } of shots) {
  test(`leaf translucency: ${name}`, async ({ page }) => {
    await page.goto(`/examples/vanilla/${query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    await expect(page.locator('canvas')).toHaveScreenshot(`${name}.png`, { mask: [page.locator('#status')] });
  });
}
