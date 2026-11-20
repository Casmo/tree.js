import { expect, test, type Page } from '@playwright/test';

// Wetness (#101, ADR 0012) in the vanilla example, as the scene-wide default hooks: at amount 0 the tree
// looks exactly as with no hook; wet, it is darker, in every Style; its settings (darkening, sheen) take
// effect live. On WebGPU and on WebGPURenderer's WebGL2 fallback (ADR 0002).

type Options = { amount?: number; hooks?: boolean; settings?: { darkening?: number; sheen?: number } };

const settled = (page: Page) => page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 60_000 });

async function shot(page: Page, options?: Options): Promise<Buffer> {
  if (options) await page.evaluate((o) => window.treeExample.setWetness!(o), options);
  return page.locator('canvas').screenshot();
}

/** The pixels that differ (any channel by more than 8), and the mean brightness of those pixels in each shot. */
async function compare(page: Page, a: Buffer, b: Buffer): Promise<{ changed: number; before: number; after: number }> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      let changed = 0;
      let before = 0;
      let after = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (![0, 1, 2].some((c) => Math.abs(da[i + c]! - db[i + c]!) > 8)) continue;
        changed++;
        before += da[i]! + da[i + 1]! + da[i + 2]!;
        after += db[i]! + db[i + 1]! + db[i + 2]!;
      }
      return { changed, before: before / Math.max(1, changed * 3), after: after / Math.max(1, changed * 3) };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

const cases = [
  ...(['low-poly', 'stylized', 'realistic', 'painterly'] as const).map((style) => ({ style, backend: 'webgpu' as const })),
  ...(['low-poly', 'stylized', 'realistic', 'painterly'] as const).map((style) => ({ style, backend: 'webgl' as const })),
];

for (const { style, backend } of cases) {
  test(`Wetness darkens a ${style} tree, live, and at 0 changes nothing (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`/examples/vanilla/?style=${style}&form=broadleaf&seed=1&wetness=0${backend === 'webgl' ? '&backend=webgl' : ''}`);
    await settled(page);
    expect(await page.evaluate(() => window.treeExample)).toMatchObject({ status: 'rendered', backend: backend === 'webgl' ? 'webgl2' : 'webgpu' });
    await page.addStyleTag({ content: '#status { display: none; }' });

    const dry = await shot(page);
    const none = await shot(page, { hooks: false });
    expect((await compare(page, none, dry)).changed).toBe(0); // amount 0: as with no hook at all

    const wet = await shot(page, { hooks: true, amount: 1 });
    const wetting = await compare(page, dry, wet);
    expect(wetting.changed).toBeGreaterThan(1000);
    expect(wetting.after).toBeLessThan(wetting.before * 0.9);

    const darker = await compare(page, wet, await shot(page, { settings: { darkening: 0.9 } }));
    expect(darker.changed).toBeGreaterThan(1000);
    expect(darker.after).toBeLessThan(darker.before);

    // The sheen: less rough (a standard material's highlights), or the toon glint band.
    const sheen = await shot(page, { settings: { sheen: 1 } });
    expect((await compare(page, await shot(page, { settings: { sheen: 0 } }), sheen)).changed).toBeGreaterThan(50);

    expect((await compare(page, dry, await shot(page, { amount: 0 }))).changed).toBe(0);
    expect(errors).toEqual([]);
  });
}
