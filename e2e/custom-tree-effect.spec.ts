import { expect, test, type Page } from '@playwright/test';

type CustomEffectExample = { status: string; backend?: string; error?: string };

/** Loads the custom Tree Effect example and returns a screenshot of the canvas (status text hidden). */
async function load(page: Page, query: string): Promise<{ example: CustomEffectExample; image: Buffer }> {
  await page.goto(`/examples/custom-effect/?${query}`);
  await page.waitForFunction(() => (window as unknown as { customEffectExample?: CustomEffectExample }).customEffectExample?.status !== 'loading', null, {
    timeout: 60_000,
  });
  const example = await page.evaluate(() => (window as unknown as { customEffectExample: CustomEffectExample }).customEffectExample);
  expect(example).toMatchObject({ status: 'rendered' });
  await page.addStyleTag({ content: '#status { display: none; }' });
  return { example, image: await page.locator('canvas').screenshot() };
}

/**
 * Compares two screenshots against a tree-mask screenshot (red = tree, green = leaves): how many
 * pixels changed, and how many of those are not leaf pixels.
 */
async function changes(page: Page, a: Buffer, b: Buffer, mask: Buffer): Promise<{ changed: number; offLeaves: number; leaves: number }> {
  return page.evaluate(
    async ([pa, pb, pm]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db, dm] = await Promise.all([decode(pa), decode(pb), decode(pm)]);
      let changed = 0;
      let offLeaves = 0;
      let leaves = 0;
      for (let i = 0; i < da.length; i += 4) {
        const leaf = dm[i + 1]! > 127;
        if (leaf) leaves++;
        const diff = Math.max(Math.abs(da[i]! - db[i]!), Math.abs(da[i + 1]! - db[i + 1]!), Math.abs(da[i + 2]! - db[i + 2]!));
        if (diff === 0) continue;
        changed++;
        if (!leaf) offLeaves++;
      }
      return { changed, offLeaves, leaves };
    },
    [a.toString('base64'), b.toString('base64'), mask.toString('base64')] as const,
  );
}

for (const backend of [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
]) {
  test(`a foliage-only custom Tree Effect changes leaf pixels and nothing else (${backend.name})`, async ({ page }) => {
    const mask = await load(page, `view=mask${backend.query}`);
    const off = await load(page, `effect=off${backend.query}`);
    const on = await load(page, `effect=on${backend.query}`);
    expect(on.example.backend).toBe(backend.name);
    const { changed, offLeaves, leaves } = await changes(page, off.image, on.image, mask.image);
    expect(leaves, 'the tree has leaves in view').toBeGreaterThan(5_000);
    expect(changed, 'the effect changes most leaf pixels').toBeGreaterThan(leaves * 0.5);
    expect(offLeaves, 'no bark, ground, sky or crate pixel changes').toBe(0);
  });

  test(`the bare pass-through custom Tree Effect leaves the frame as it is (${backend.name})`, async ({ page }) => {
    const off = await load(page, `effect=off${backend.query}`);
    const through = await load(page, `effect=pass-through${backend.query}`);
    const mask = await load(page, `view=mask${backend.query}`);
    expect((await changes(page, off.image, through.image, mask.image)).changed).toBe(0);
  });
}
