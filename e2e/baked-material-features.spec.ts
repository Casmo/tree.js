import { expect, test, type Page } from '@playwright/test';

// Baked Tree glTF export of Material Features (#59): the tree exported with exportBakedTree and loaded
// back with three's own GLTFLoader, as another engine gets it. With the features on, the crown is lit as
// one shape (Crown Normals in NORMAL) and darker inside (Structural Occlusion, here in COLOR_0).

async function renderTree(page: Page, query: string) {
  await page.goto(`/examples/vanilla/?${query}`);
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.treeExample)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
}

const mask = (page: Page) => ({ mask: [page.locator('#status')] });
const tree = 'style=stylized&species=oak&seed=1&baked=1';
const features = 'crownNormals=1&occlusion=0.7&translucency=0.5,0.6,0.3&occlusionInVertexColors=1';

test('a Baked Tree with Material Features on, loaded back with GLTFLoader', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await renderTree(page, tree);
  const off = await page.locator('canvas').screenshot(mask(page));
  await expect(page.locator('canvas')).toHaveScreenshot('stylized-oak-baked-off.png', mask(page));

  await renderTree(page, `${tree}&${features}`);
  const on = await page.locator('canvas').screenshot(mask(page));
  await expect(page.locator('canvas')).toHaveScreenshot('stylized-oak-baked-features-on.png', mask(page));
  expect(on.equals(off)).toBe(false);
  expect(errors).toEqual([]);
});

// A Painterly Baked Tree (#120): an approximation of the painted shading (Leaf Mass lighting normals, the crown
// gradient in COLOR_0, the spray strokes as a brightness map), loaded back with GLTFLoader.
for (const form of ['broadleaf', 'conifer']) {
  test(`a painterly ${form} Baked Tree, loaded back with GLTFLoader`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await renderTree(page, `style=painterly&form=${form}&seed=42&view=tycoon&baked=1`);
    await expect(page.locator('canvas')).toHaveScreenshot(`painterly-${form}-baked.png`, mask(page));
    expect(errors).toEqual([]);
  });
}

// The Fantasy Styles' Baked Trees (#142), loaded back with GLTFLoader: Whimsical with its candy stripes in a
// bark map, Enchanted with its Inner Glow as a steady emissive, which at night (no light at all) is all that
// shows. Enchanted pins the Wind clock (`windTime=0`) only so the live tree it is baked from is the same.
for (const [style, extra] of [['whimsical', ''], ['enchanted', '&windTime=0'], ['enchanted', '&windTime=0&night=1']] as const) {
  const night = extra.includes('night');
  test(`${style === 'enchanted' ? 'an' : 'a'} ${style} Baked Tree${night ? ' at night' : ''}, loaded back with GLTFLoader`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await renderTree(page, `style=${style}&seed=1&baked=1${extra}`);
    if (night) {
      // Unlit: the glow is the emissive, so the tree shows against the dark sky (without it, it would be black).
      const png = await page.locator('canvas').screenshot(mask(page));
      const glowing = await page.evaluate(async (base64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) > 60) count++;
        return count;
      }, png.toString('base64'));
      expect(glowing).toBeGreaterThan(2000);
    }
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-baked${night ? '-night' : ''}.png`, mask(page));
    expect(errors).toEqual([]);
  });
}
