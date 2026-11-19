import { expect, test, type Page } from '@playwright/test';

// Impostors follow Season and Wind (ADR 0010, #76) in examples/forest. `lod=0,0,0` draws every tree as
// an Impostor (so whole renders can be compared with the same forest drawn in full); `lod=40,60` puts
// every Detail Level on screen (Impostors at the back). The forest is deciduous: green in summer
// (0.37), turning and dropping in autumn (0.64), bare in winter (0.85). `style=stylized` blossoms in
// early spring (0.06).

// Each test loads the example several times.
test.describe.configure({ timeout: 180_000 });

/** Loads the forest example and returns a screenshot of the canvas (status text hidden). */
async function shot(page: Page, query: string): Promise<Buffer> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/forest/?${query}`);
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.forestExample.status)).toBe('rendered');
  expect(errors).toEqual([]);
  await page.addStyleTag({ content: '#status { display: none; }' });
  return page.locator('canvas').screenshot();
}

/** The trees in a screenshot: the pixels that differ from the same view without trees, their mean colour and how many are blossom pink. */
interface Trees {
  pixels: number;
  mean: [number, number, number];
  pink: number;
}

async function trees(page: Page, image: Buffer, empty: Buffer): Promise<Trees> {
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [pa, pb] = await Promise.all([decode(a), decode(b)]);
      const sum: [number, number, number] = [0, 0, 0];
      let pixels = 0;
      let pink = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const [r, g, bl] = [pa[i]!, pa[i + 1]!, pa[i + 2]!];
        if (Math.max(Math.abs(r - pb[i]!), Math.abs(g - pb[i + 1]!), Math.abs(bl - pb[i + 2]!)) <= 8) continue;
        pixels++;
        sum[0] += r;
        sum[1] += g;
        sum[2] += bl;
        if (r > 200 && bl > 150 && g < r - 20) pink++;
      }
      return { pixels, mean: sum.map((s) => s / Math.max(pixels, 1)) as [number, number, number], pink };
    },
    [image.toString('base64'), empty.toString('base64')] as const,
  );
}

/** Pixels that differ between two screenshots. */
async function changed(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return (await trees(page, a, b)).pixels;
}

test('Impostor leaves take the Season Profile colour: green in summer, autumn colours in autumn', async ({ page }) => {
  const empty = await shot(page, 'trees=0&lod=0,0,0');
  const summer = await trees(page, await shot(page, 'lod=0,0,0&season=0.37'), empty);
  const autumn = await trees(page, await shot(page, 'lod=0,0,0&season=0.64'), empty);
  const fullAutumn = await trees(page, await shot(page, 'season=0.64'), empty);
  // Tree pixels are wood (brown, red above green) and leaves: the leaves turn the mix.
  const redness = (t: Trees) => t.mean[0] / t.mean[1];
  expect(redness(autumn)).toBeGreaterThan(redness(summer) * 1.1);
  // As red as the same forest drawn in full (wood and orange leaves), within a margin.
  expect(Math.abs(redness(autumn) - redness(fullAutumn))).toBeLessThan(0.25);
});

test('Impostors drop their leaves one by one in autumn and show bare branches, not holes, in winter', async ({ page }) => {
  const empty = await shot(page, 'trees=0&lod=0,0,0');
  const drawn = async (lod: string) => {
    const winter = await shot(page, `${lod}season=0.85`);
    // Leaves: where a Season differs from the bare trees of winter. From 0.68 on the leaf colour holds
    // and only the leaf coverage falls (0.43, 0.29, 0.14 before each tree's and leaf's timing shift).
    const leaves = async (season: number) => changed(page, await shot(page, `${lod}season=${season}`), winter);
    return { leaves: [await leaves(0.68), await leaves(0.7), await leaves(0.72)], wood: (await trees(page, winter, empty)).pixels };
  };
  const impostors = await drawn('lod=0,0,0&');
  const full = await drawn('');
  // Fewer and fewer leaves, never all at once: as on the same forest drawn in full.
  for (const { leaves } of [impostors, full]) {
    expect(leaves[1]!).toBeLessThan(leaves[0]! * 0.9);
    expect(leaves[2]!).toBeLessThan(leaves[1]! * 0.9);
    expect(leaves[2]!).toBeGreaterThan(0);
  }
  // In winter the wood behind the dropped leaves shows (the wood layer): most of the bare forest drawn in
  // full (fine twigs are lost in the atlas). Leaving holes instead covers under half.
  expect(impostors.wood).toBeGreaterThan(full.wood * 0.6);
});

test('Impostors blossom in spring', async ({ page }) => {
  const empty = await shot(page, 'trees=0&lod=0,0,0&style=stylized');
  const spring = await trees(page, await shot(page, 'lod=0,0,0&style=stylized&season=0.06'), empty);
  const full = await trees(page, await shot(page, 'style=stylized&season=0.06'), empty);
  const summer = await trees(page, await shot(page, 'lod=0,0,0&style=stylized&season=0.37'), empty);
  expect(summer.pink / summer.pixels).toBeLessThan(0.05);
  expect(spring.pink / spring.pixels).toBeGreaterThan(0.3);
  expect(spring.pink / spring.pixels).toBeGreaterThan((full.pink / full.pixels) * 0.7);
});

test('Impostors sway in the Wind', async ({ page }) => {
  const calm = await shot(page, 'lod=0,0,0&wind=2&windTime=0');
  const later = await shot(page, 'lod=0,0,0&wind=2&windTime=1.5');
  const still = await shot(page, 'lod=0,0,0');
  expect(await changed(page, calm, still)).toBeGreaterThan(5000);
  expect(await changed(page, later, calm)).toBeGreaterThan(5000);
  // A pinned Wind clock draws the same frame again.
  expect((await shot(page, 'lod=0,0,0&wind=2&windTime=1.5')).equals(later)).toBe(true);
});

for (const [name, season] of [
  ['spring', 'style=stylized&season=0.06'],
  ['autumn', 'season=0.64'],
  ['winter', 'season=0.85'],
] as const) {
  test(`Impostors in ${name}, with Full and Light trees in front`, async ({ page }) => {
    await shot(page, `trees=400&lod=40,60&${season}`);
    await expect(page.locator('canvas')).toHaveScreenshot(`forest-lod-impostor-${name}-webgpu.png`);
  });
}
