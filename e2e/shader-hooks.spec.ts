import { expect, test, type Page } from '@playwright/test';

// Tree Shader Hook on a single Tree (#98, ADR 0012): in the vanilla example a hook that tints a part
// magenta changes that part's pixels only, and removing it gives back today's picture, on WebGPU and on
// WebGPURenderer's WebGL2 fallback (ADR 0002).

type Example = {
  status: string;
  backend?: string;
  setShaderHooks?: (parts: string[]) => void;
  setVisible?: (mesh: string, visible: boolean) => void;
};

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { treeExample?: Example }).treeExample?.status !== 'loading', null, { timeout: 60_000 });

async function shot(page: Page, change?: string): Promise<Buffer> {
  if (change) {
    await page.evaluate(change);
    await settled(page);
  }
  return page.locator('canvas').screenshot();
}

/** Per pixel, whether two screenshots differ there (any channel by more than 8). */
async function changed(page: Page, a: Buffer, b: Buffer): Promise<boolean[]> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      return Array.from({ length: da.length / 4 }, (_, i) => [0, 1, 2].some((c) => Math.abs(da[i * 4 + c]! - db[i * 4 + c]!) > 8));
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

const count = (mask: boolean[]) => mask.filter(Boolean).length;

for (const backend of ['webgpu', 'webgl'] as const) {
  test(`a leaves-only hook changes leaf pixels only, then is removed (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`/examples/vanilla/?style=stylized&form=broadleaf&seed=1${backend === 'webgl' ? '&backend=webgl' : ''}`);
    await settled(page);
    const example = await page.evaluate(() => (window as unknown as { treeExample: Example }).treeExample);
    expect(example).toMatchObject({ status: 'rendered', backend: backend === 'webgl' ? 'webgl2' : 'webgpu' });
    await page.addStyleTag({ content: '#status { display: none; }' });

    const plain = await shot(page);
    const call = (code: string) => `window.treeExample.${code}`;
    const noLeaves = await shot(page, call(`setVisible('leaves', false)`));
    const noWood = await shot(page, call(`setVisible('leaves', true); window.treeExample.setVisible('wood', false)`));
    await shot(page, call(`setVisible('wood', true)`));
    const leafPixels = await changed(page, plain, noLeaves);
    const woodPixels = await changed(page, plain, noWood);

    const leaves = await changed(page, plain, await shot(page, call(`setShaderHooks(['leaves'])`)));
    const outsideLeaves = leaves.filter((c, i) => c && !leafPixels[i]);
    expect(count(leaves)).toBeGreaterThan(1000);
    expect(count(outsideLeaves)).toBeLessThan(count(leaves) * 0.01);

    const bark = await changed(page, plain, await shot(page, call(`setShaderHooks(['bark'])`)));
    expect(count(bark)).toBeGreaterThan(100);
    expect(count(bark.filter((c, i) => c && !woodPixels[i]))).toBeLessThan(count(bark) * 0.01);

    const removed = await changed(page, plain, await shot(page, call(`setShaderHooks([])`)));
    expect(count(removed)).toBe(0);
    expect(errors).toEqual([]);
  });
}
