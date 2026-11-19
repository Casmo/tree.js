import { expect, test, type Page } from '@playwright/test';

// Wind Bursts on a Forest (examples/forest): the camera is at (0, 22, 46) looking down -z over a
// 400-tree grid about 60 m across, so trees left of x = 0 are in the left half of the canvas. A burst
// at x = -20 with a radius of 8 m only reaches trees in the left half.

/** Loads the forest with a pinned, calm Wind and returns a screenshot of the canvas. */
async function load(page: Page, query: string) {
  await page.goto(`/examples/forest/?trees=400&variants=2&windTime=10${query}`);
  await page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 90_000 });
  const result = await page.evaluate(() => window.forestExample);
  expect(result.status).toBe('rendered');
  await page.addStyleTag({ content: '#status { display: none; }' });
  return { result, before: await shot(page) };
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

/** Bursts at x = -20, checks the left half bends and the right half not, then that it is over after its lifetime. */
async function expectBurst(page: Page, before: Buffer) {
  await page.evaluate(() => window.forestExample.burst!({ x: -20, z: 0, strength: 1, radius: 8 }));
  await page.evaluate(() => window.forestExample.setWindTime!(10.3));
  const bent = await changed(page, before, await shot(page));
  expect(bent.left, 'the trees near the burst bend').toBeGreaterThan(300);
  expect(bent.right, 'the trees beyond its radius do not move').toBe(0);

  await page.evaluate(() => window.forestExample.setWindTime!(11.5));
  expect(await changed(page, before, await shot(page)), 'over after its lifetime').toEqual({ left: 0, right: 0 });
}

// WebGPU: every tree at one Detail Level at a time (the camera is 30 to 85 m from the trees).
for (const level of [
  { name: 'Full', lod: '500,1000', key: 'full' },
  { name: 'Light', lod: '0.01,1000', key: 'light' },
  { name: 'Impostor', lod: '0.01,0.02', key: 'impostor' },
] as const) {
  test(`a Wind Burst bends Forest trees drawn ${level.name} near it, not those beyond its radius (webgpu)`, async ({ page }) => {
    const { result, before } = await load(page, `&lod=${level.lod},0`);
    expect(result.backend).toBe('webgpu');
    expect(result.levels![level.key]).toBe(400);
    await expectBurst(page, before);
  });
}

test('a Wind Burst bends Forest instances near it, not those beyond its radius (webgl2)', async ({ page }) => {
  const { result, before } = await load(page, '&backend=webgl');
  expect(result.backend).toBe('webgl2');
  await expectBurst(page, before);
});
