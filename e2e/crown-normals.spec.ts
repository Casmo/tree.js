import { expect, test, type Page } from '@playwright/test';

// Crown Normals (#54): `materials.leaf.crownNormals` lights the crown as one rounded volume.
// Off/on per Style (the off shots are the plain Style trees), plus a partial amount, Growth, Wind,
// the WebGL2 fallback and a Forest.

/** Renders an example page; returns its console errors. */
async function render(page: Page, path: string, global: 'treeExample' | 'forestExample', query: string) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/${path}/?${query}`);
  await page.waitForFunction((g) => (window as unknown as Record<string, { status: string }>)[g]?.status !== 'loading', global, {
    timeout: 60_000,
  });
  const result = await page.evaluate((g) => (window as unknown as Record<string, unknown>)[g], global);
  return { result, errors };
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });

for (const style of ['low-poly', 'stylized', 'realistic']) {
  for (const [name, amount] of [
    ['off', null],
    ['on', 1],
  ] as const) {
    test(`${style} broadleaf with Crown Normals ${name}`, async ({ page }) => {
      const query = `style=${style}&form=broadleaf&seed=1${amount === null ? '' : `&crownNormals=${amount}`}`;
      const { result, errors } = await render(page, 'vanilla', 'treeExample', query);
      expect(errors).toEqual([]);
      expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
      await expect(page.locator('canvas')).toHaveScreenshot(`${style}-broadleaf-crown-normals-${name}.png`, mask(page));
    });
  }
}

const variations = [
  // Flat shading below 1: the facets stay visible.
  { name: 'low-poly-half', query: 'style=low-poly&form=broadleaf&crownNormals=0.5' },
  // A growing tree is lit as a crown too (the Volume scales with Growth).
  { name: 'stylized-growth-0-9', query: 'style=stylized&form=broadleaf&crownNormals=1&growth=0.9' },
  // Measured before Wind: swaying leaves keep the crown's lighting.
  { name: 'stylized-wind', query: 'style=stylized&form=broadleaf&crownNormals=1&wind=2&windTime=3' },
  { name: 'stylized-webgl2', query: 'style=stylized&form=broadleaf&crownNormals=1&backend=webgl', backend: 'webgl2' },
];
for (const { name, query, backend = 'webgpu' } of variations) {
  test(`Crown Normals: ${name}`, async ({ page }) => {
    const { result, errors } = await render(page, 'vanilla', 'treeExample', `${query}&seed=1`);
    expect(errors).toEqual([]);
    expect(result).toMatchObject({ status: 'rendered', backend });
    await expect(page.locator('canvas')).toHaveScreenshot(`crown-normals-${name}.png`, mask(page));
  });
}

test('Crown Normals in a Forest: every rotated and scaled tree is lit as a crown', async ({ page }) => {
  const { result, errors } = await render(page, 'forest', 'forestExample', 'style=stylized&trees=100&crownNormals=1');
  expect(errors).toEqual([]);
  expect(result).toMatchObject({ status: 'rendered', backend: 'webgpu' });
  await expect(page.locator('canvas')).toHaveScreenshot('crown-normals-forest.png', mask(page));
});
