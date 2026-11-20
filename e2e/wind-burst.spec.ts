import { expect, test, type Page } from '@playwright/test';

/** Loads the two-tree example with a pinned, calm Wind and returns a screenshot of the canvas. */
async function load(page: Page, query: string): Promise<Buffer> {
  await page.goto(`/examples/vanilla/?burst=1&windTime=10${query}`);
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.treeExample.status)).toBe('rendered');
  await page.addStyleTag({ content: '#status { display: none; }' });
  return shot(page);
}

async function shot(page: Page): Promise<Buffer> {
  return page.locator('canvas').screenshot();
}

/** Pixels that differ at all between two screenshots, in the left and the right half of the canvas. */
async function changed(page: Page, a: Buffer, b: Buffer): Promise<{ left: number; right: number }> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      const result = { left: 0, right: 0 };
      for (let i = 0; i < da.data.length; i += 4) {
        const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(da.data[i + c]! - db.data[i + c]!)));
        if (diff === 0) continue;
        if ((i / 4) % da.width < da.width / 2) result.left++;
        else result.right++;
      }
      return result;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

for (const backend of [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
  // Painterly (#116): Leaf Masses sway (and settle back) with the burst like any crown.
  { name: 'painterly, webgpu', query: '&style=painterly' },
]) {
  test(`a Wind Burst bends the trees near it, not those beyond its radius, and is over after its lifetime (${backend.name})`, async ({ page }) => {
    const before = await load(page, backend.query);
    const near = (await page.evaluate(() => window.treeExample.trees!.near))!;
    // Just beside the near (left) tree, on its outer side; the far tree is ~10 m away.
    await page.evaluate(([x, z]) => window.treeExample.burst!({ x: x - 1.5, z: z + 1.5, strength: 1, radius: 5 }), near);
    await page.evaluate(() => window.treeExample.setWindTime!(10.15));
    const during = await shot(page);
    const bent = await changed(page, before, during);
    expect(bent.left, 'the near tree bends').toBeGreaterThan(500);
    expect(bent.right, 'the far tree does not move').toBe(0);

    await page.evaluate(() => window.treeExample.setWindTime!(11.5));
    expect(await changed(page, before, await shot(page))).toEqual({ left: 0, right: 0 });
  });
}
