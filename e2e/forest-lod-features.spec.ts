import { expect, test, type Page } from '@playwright/test';

// Material Features on Impostors (#77, ADR 0008 / 0010) in examples/forest: with `lod=0,0,0` every tree
// is an Impostor. Each feature the Definition sets changes the Impostors, and tuning the Forest's live
// values reaches them without a rebake: the tuned forest looks like one built with those values.

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

/** The canvas as RGBA bytes. */
async function pixels(page: Page): Promise<number[]> {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
  }, png.toString('base64'));
}

/** Share of pixels whose colour differs by more than 8 (of 255) in any channel. */
function changed(a: number[], b: number[]): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) > 8) count++;
  }
  return count / (a.length / 4);
}

const IMPOSTORS = 'trees=400&lod=0,0,0';

async function impostors(page: Page, features: string): Promise<number[]> {
  const { result, errors } = await render(page, `${IMPOSTORS}${features ? `&${features}` : ''}`);
  expect(errors).toEqual([]);
  expect(result.status).toBe('rendered');
  expect(result.levels).toEqual({ full: 0, light: 0, impostor: 400 });
  return pixels(page);
}

test('each Material Feature visibly applies to Impostors', async ({ page }) => {
  test.setTimeout(120_000); // four forests, each baked on the CPU (SwiftShader)
  const plain = await impostors(page, '');
  for (const features of ['crownNormals=1', 'translucency=1,1,1', 'occlusion=1']) {
    // The trees cover about a third of the view: each feature changes a good part of them.
    expect(changed(plain, await impostors(page, features)), features).toBeGreaterThan(0.03);
  }
});

test('Impostors with every Material Feature', async ({ page }) => {
  await impostors(page, 'crownNormals=1&translucency=1,1,1&occlusion=1');
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-features-webgpu.png', mask(page));
});

test('tuning the live Material Features reaches the Impostors without a rebake', async ({ page }) => {
  test.setTimeout(120_000); // two forests, each baked on the CPU (SwiftShader)
  const built = await impostors(page, 'crownNormals=0.3&translucency=0.2,0.5,0.4&occlusion=0.4');
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-features-tuned-webgpu.png', mask(page));

  const before = await impostors(page, 'crownNormals=1&translucency=1,1,1&occlusion=1');
  expect(changed(built, before)).toBeGreaterThan(0.03);
  await page.evaluate(() =>
    window.forestExample.setMaterialFeatures!({ crownNormals: 0.3, translucency: { strength: 0.2, edge: 0.5, ambient: 0.4 }, occlusionStrength: 0.4 }),
  );
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-impostor-features-tuned-webgpu.png', mask(page));
});
