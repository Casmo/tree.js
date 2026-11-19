import { expect, test, type Page } from '@playwright/test';

// Tree Shader Hooks on a Forest (#99, ADR 0010 / 0012) in examples/forest: a magenta hook visibly changes
// near trees and far ones, which with `lod=40,60` (WebGPU) are Impostors that apply it at draw time, so a
// live hook setting reaches them without a rebake. The scene-wide default does the same. Removing the hook
// gives back today's picture. On WebGPURenderer's WebGL2 fallback (ADR 0002) the forest draws every tree
// in full (lod is ignored there), and the hook reaches near and far trees just the same.

const settled = (page: Page) => page.waitForFunction(() => window.forestExample?.status !== 'loading', null, { timeout: 90_000 });

/** How many pixels changed (any channel by more than 8) in the top `far` and bottom `near` share of the rows. */
async function changedRows(page: Page, a: Buffer, b: Buffer): Promise<{ far: number; near: number; all: number }> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return { data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      const counts = { far: 0, near: 0, all: 0 };
      for (let i = 0; i < da.data.length / 4; i++) {
        if (![0, 1, 2].some((c) => Math.abs(da.data[i * 4 + c]! - db.data[i * 4 + c]!) > 8)) continue;
        const row = Math.floor(i / da.width) / da.height;
        counts.all++;
        if (row < 0.42) counts.far++;
        if (row > 0.65) counts.near++;
      }
      return counts;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

async function open(page: Page, query: string, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/examples/forest/?trees=400&${query}`);
  await settled(page);
  await page.addStyleTag({ content: '#status { display: none; }' });
}

const shot = (page: Page) => page.locator('canvas').screenshot();
const setHooks = async (page: Page, options: { parts?: string[]; sceneParts?: string[]; amount?: number }) => {
  await page.evaluate((o) => window.forestExample.setShaderHooks!(o), options);
  return shot(page);
};

for (const backend of ['webgpu', 'webgl'] as const) {
  test(`a Forest hook changes near trees and far ${backend === 'webgpu' ? 'Impostors' : 'trees'}, live, then is removed (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    await open(page, `lod=40,60${backend === 'webgl' ? '&backend=webgl' : ''}`, errors);
    const result = await page.evaluate(() => window.forestExample);
    expect(result).toMatchObject({ status: 'rendered', backend: backend === 'webgl' ? 'webgl2' : 'webgpu' });
    if (backend === 'webgpu') expect(result.levels!.impostor).toBeGreaterThan(50);

    const plain = await shot(page);
    const leaves = await changedRows(page, plain, await setHooks(page, { parts: ['leaves'] }));
    expect(leaves.near).toBeGreaterThan(2000);
    expect(leaves.far).toBeGreaterThan(1000);

    // A live hook setting (a uniform) reaches the far trees too: no rebake, no rebuild.
    const tinted = await shot(page);
    const weaker = await changedRows(page, tinted, await setHooks(page, { amount: 0.3 }));
    expect(weaker.near).toBeGreaterThan(1000);
    expect(weaker.far).toBeGreaterThan(500);

    // Bark too: the far trees' wood texels.
    const bark = await changedRows(page, plain, await setHooks(page, { parts: ['bark'], amount: 0.8 }));
    expect(bark.near).toBeGreaterThan(500);
    expect(bark.far).toBeGreaterThan(200);

    const removed = await changedRows(page, plain, await setHooks(page, { parts: [] }));
    expect(removed.all).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`the scene-wide default hook reaches the Forest and its Impostors, then is removed (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    await open(page, `lod=40,60${backend === 'webgl' ? '&backend=webgl' : ''}`, errors);
    const plain = await shot(page);
    const scene = await changedRows(page, plain, await setHooks(page, { sceneParts: ['leaves'] }));
    expect(scene.near).toBeGreaterThan(2000);
    expect(scene.far).toBeGreaterThan(1000);
    await page.evaluate(() => window.forestExample.setShaderHooks!({ sceneParts: [] }));
    expect((await changedRows(page, plain, await shot(page))).all).toBe(0);
    expect(errors).toEqual([]);
  });
}
