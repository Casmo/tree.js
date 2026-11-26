import { expect, test, type Page } from '@playwright/test';

// The Fantasy Styles at every Detail Level (#142, ADR 0010 / 0017) in examples/forest: a Whimsical and an
// Enchanted forest look alike drawn all Full (`lod=1000,1000`), all Light (`lod=0,1000,0`) and all as
// Impostors (`lod=0,0,0`), with their Leaf Palettes per tree, Whimsical's candy stripes and Enchanted's Inner
// Glow, so trees don't pop as they change level; at night (`night=1`, no light at all) the Impostors glow.
// Enchanted shots pin the Wind clock (`windTime=0`): the Inner Glow pulses with it.

test.describe.configure({ timeout: 180_000 });

async function render(page: Page, query: string) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/forest/?${query}`);
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 120_000 });
  await page.addStyleTag({ content: '#status { display: none; }' });
  return { result: await page.evaluate(() => window.forestExample), errors };
}

/** The mean colour (0..255 per channel) of the pixels that are neither sky nor ground (the trees), and how many there are. */
async function treePixels(page: Page): Promise<{ count: number; mean: [number, number, number] }> {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const at = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * width + x) * 4 + c]!);
    const sky = at(2, 2);
    const ground = at(width >> 1, height - 3);
    const near = (i: number, ref: number[]) => ref.every((v, c) => Math.abs(data[i + c]! - v) < 6);
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (near(i, sky) || near(i, ground)) continue;
      for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
      count++;
    }
    return { count, mean: sum.map((s) => s / Math.max(count, 1)) as [number, number, number] };
  }, png.toString('base64'));
}

const LEVELS = { full: 'lod=1000,1000', light: 'lod=0,1000,0', impostor: 'lod=0,0,0' } as const;

for (const [style, pinned] of [['whimsical', ''], ['enchanted', '&windTime=0']] as const) {
  for (const night of style === 'enchanted' ? ['', '&night=1'] : ['']) {
    const label = `${style === 'enchanted' ? 'an' : 'a'} ${style} forest${night ? ' at night' : ''}`;
    test(`${label} looks alike at every Detail Level: no pop`, async ({ page }) => {
      const seen: Record<string, { count: number; mean: [number, number, number] }> = {};
      for (const [level, lod] of Object.entries(LEVELS)) {
        const { result, errors } = await render(page, `style=${style}&trees=100&${lod}${pinned}${night}`);
        expect(errors).toEqual([]);
        expect(result.levels![level as keyof typeof LEVELS]).toBe(100);
        seen[level] = await treePixels(page);
      }
      const full = seen.full!;
      for (const level of ['light', 'impostor']) {
        const { count, mean } = seen[level]!;
        // About as many tree pixels, and each channel's mean close to the Full trees' (the Impostors lose a
        // little of the thinnest leaves, the ones that glow most).
        expect(count, level).toBeGreaterThan(full.count * 0.85);
        mean.forEach((c, i) => expect(Math.abs(c - full.mean[i]!), `${level} channel ${i}: ${mean} vs ${full.mean}`).toBeLessThan(Math.max(12, full.mean[i]! * 0.22)));
      }
      if (night) {
        // With no light at all, only the Inner Glow shows: the Impostors glow (the sky is about 0.05 bright).
        expect(Math.max(...seen.impostor!.mean)).toBeGreaterThan(40);
      }
    });
  }
}

test('Impostors of Whimsical trees keep their Leaf Palettes and candy stripes', async ({ page }) => {
  const { result, errors } = await render(page, 'style=whimsical&trees=100&lod=0,0,0');
  expect(errors).toEqual([]);
  expect(result.levels!.impostor).toBe(100);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-whimsical-impostor-webgpu.png');
});

for (const night of ['', '&night=1']) {
  test(`Impostors of Enchanted trees glow${night ? ' at night' : ''}`, async ({ page }) => {
    const { result, errors } = await render(page, `style=enchanted&trees=100&lod=0,0,0&windTime=0${night}`);
    expect(errors).toEqual([]);
    expect(result.levels!.impostor).toBe(100);
    await expect(page.locator('canvas')).toHaveScreenshot(`forest-lod-enchanted-impostor${night ? '-night' : ''}-webgpu.png`);
  });
}

test('an Enchanted forest at every Detail Level at night, cross-fading', async ({ page }) => {
  const { result, errors } = await render(page, 'style=enchanted&trees=100&lod=40,60,0.5&windTime=0&night=1');
  expect(errors).toEqual([]);
  expect(result.levels!.full).toBeGreaterThan(0);
  expect(result.levels!.impostor).toBeGreaterThan(0);
  await expect(page.locator('canvas')).toHaveScreenshot('forest-lod-enchanted-levels-night-webgpu.png');
});
