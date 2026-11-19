import { expect, test, type Page } from '@playwright/test';

// Tree Effects and interaction on Forest trees at every Detail Level (ADR 0009, ADR 0010), in the
// effects example: `?lod=full|light|impostor` puts f0 and f1 at that level (and a tree in the first slot,
// behind the camera, in full, so a tree's place in its level list is not its slot).

type Point = { x: number; y: number };
type EffectsExample = {
  status: string;
  error?: string;
  levels?: number[];
  trunks?: Record<string, Point>;
  picked?: { name: string | null } & Point;
  readTreeIds?: () => Promise<{ name: string; id: number; expected: number | undefined; resolved: string | null }[]>;
};
const example = (page: Page) => page.evaluate(() => (window as unknown as { effectsExample: EffectsExample }).effectsExample);

/** Loads the effects example and returns a screenshot of the canvas (status text hidden). */
async function shot(page: Page, query: string): Promise<Buffer> {
  await page.goto(`/examples/effects/?${query}`);
  await page.waitForFunction(() => (window as unknown as { effectsExample?: EffectsExample }).effectsExample?.status !== 'loading', null, { timeout: 60_000 });
  expect(await example(page)).toMatchObject({ status: 'rendered' });
  await page.addStyleTag({ content: '#status { display: none; }' });
  return page.locator('canvas').screenshot();
}

/** f0 and f1 drawn at `level` (index in Full, Light, Impostor), the tree behind the camera in full. */
async function expectLevel(page: Page, level: number): Promise<void> {
  const counts = [1, 0, 0];
  counts[level]! += 2;
  expect((await example(page)).levels, 'trees per Detail Level').toEqual(counts);
}

/** How many pixels differ between two screenshots within `radius` pixels of each point. */
async function changedNear(page: Page, a: Buffer, b: Buffer, points: Point[], radius: number): Promise<number[]> {
  return page.evaluate(
    async ([pa, pb, at, r]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [ia, ib] = await Promise.all([decode(pa), decode(pb)]);
      return at.map(({ x, y }) => {
        let count = 0;
        for (let py = Math.max(0, Math.floor(y - r)); py < Math.min(ia.height, y + r); py++) {
          for (let px = Math.max(0, Math.floor(x - r)); px < Math.min(ia.width, x + r); px++) {
            const i = (py * ia.width + px) * 4;
            const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(ia.data[i + c]! - ib.data[i + c]!)));
            if (diff > 8) count++;
          }
        }
        return count;
      });
    },
    [a.toString('base64'), b.toString('base64'), points, radius] as const,
  );
}

const levels = [
  { name: 'light', index: 1 },
  { name: 'impostor', index: 2 },
];

for (const level of levels) {
  test(`Forest trees drawn ${level.name} write their Tree ID (block base + slot), which resolves back to them`, async ({ page }) => {
    await shot(page, `style=low-poly&view=treeId&lod=${level.name}`);
    await expectLevel(page, level.index);
    const reads = await page.evaluate(() => window.effectsExample.readTreeIds!());
    expect(reads.map((r) => r.name)).toEqual(['tree', 'second', 'f0', 'f1']);
    for (const read of reads) {
      expect(read.id, `${read.name}: its own ID under its trunk`).toBe(read.expected);
      expect(read.resolved, `${read.name}: the ID resolves to it`).toBe(read.name);
    }
    expect(new Set(reads.map((r) => r.id)).size).toBe(reads.length);
  });

  test(`effects.pick() and the Highlight work on Forest trees drawn ${level.name}`, async ({ page }) => {
    const plain = await shot(page, `style=low-poly&pick=f0&lod=${level.name}`);
    expect((await example(page)).picked?.name, 'pick() returns the Forest tree under its trunk').toBe('f0');
    const image = await shot(page, `style=low-poly&highlight=f0&lod=${level.name}`);
    await expectLevel(page, level.index);
    const { picked, trunks } = await example(page);
    expect(picked?.name, 'the highlighted tree').toBe('f0');
    if (level.name === 'impostor') await expect(page.locator('canvas')).toHaveScreenshot('low-poly-highlight-f0-impostor.png');
    // The picked tree is highlighted, the other Forest tree is not.
    const [f0, f1] = await changedNear(page, plain, image, [trunks!.f0!, trunks!.f1!], 12);
    expect(f0, 'f0 is highlighted').toBeGreaterThan(100);
    expect(f1, 'f1 is not').toBe(0);
  });

  test(`the outline draws around Forest trees drawn ${level.name}`, async ({ page }) => {
    const none = await shot(page, `style=low-poly&effects=none&lod=${level.name}`);
    const image = await shot(page, `style=low-poly&effects=outline&lod=${level.name}`);
    await expectLevel(page, level.index);
    const { trunks } = await example(page);
    if (level.name === 'impostor') await expect(page.locator('canvas')).toHaveScreenshot('low-poly-outline-impostor.png');
    for (const [i, changed] of (await changedNear(page, none, image, [trunks!.f0!, trunks!.f1!], 40)).entries()) {
      expect(changed, `f${i} gets the outline`).toBeGreaterThan(30);
    }
  });

  test(`Inner Lines draw inside Forest trees drawn ${level.name}`, async ({ page }) => {
    const none = await shot(page, `style=low-poly&effects=none&lod=${level.name}`);
    const image = await shot(page, `style=low-poly&effects=inner-lines&lod=${level.name}`);
    await expectLevel(page, level.index);
    const { trunks } = await example(page);
    if (level.name === 'impostor') await expect(page.locator('canvas')).toHaveScreenshot('low-poly-inner-lines-impostor.png');
    // f1's crown (above its trunk; f0's crown overlaps the second Tree on screen).
    const crown = { x: trunks!.f1!.x, y: trunks!.f1!.y - 130 };
    const [changed] = await changedNear(page, none, image, [crown], 60);
    expect(changed, 'f1 gets Inner Lines').toBeGreaterThan(30);
  });
}

test('the tree mask covers Impostor trees, leaves where the bake had leaves', async ({ page }) => {
  await shot(page, 'style=low-poly&view=mask&lod=impostor');
  await expectLevel(page, 2);
  await expect(page.locator('canvas')).toHaveScreenshot('low-poly-mask-impostor.png');
});
