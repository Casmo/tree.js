import { expect, test, type Page } from '@playwright/test';

type EffectsExample = { status: string; backend?: string; error?: string };

/** Loads the effects example and returns a screenshot of the canvas (status text hidden). */
async function shot(page: Page, query: string): Promise<Buffer> {
  await page.goto(`/examples/effects/?${query}`);
  await page.waitForFunction(() => (window as unknown as { effectsExample?: EffectsExample }).effectsExample?.status !== 'loading', null, {
    timeout: 30_000,
  });
  const example = await page.evaluate(() => (window as unknown as { effectsExample: EffectsExample }).effectsExample);
  expect(example).toMatchObject({ status: 'rendered' });
  await page.addStyleTag({ content: '#status { display: none; }' });
  return page.locator('canvas').screenshot();
}

/**
 * Compares two screenshots under the tree mask (decoded in the page): how many non-tree pixels
 * differ at all, and how many tree pixels differ visibly.
 */
async function compare(page: Page, before: Buffer, after: Buffer, mask: Buffer) {
  return page.evaluate(
    async ([a, b, m]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [pa, pb, pm] = await Promise.all([decode(a), decode(b), decode(m)]);
      let treePixels = 0;
      let treeChanged = 0;
      let otherChanged = 0;
      let otherMaxDiff = 0;
      for (let i = 0; i < pm.length; i += 4) {
        const diff = Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!));
        if (pm[i]! > 127) {
          treePixels++;
          if (diff > 2) treeChanged++;
        } else if (diff > 0) {
          otherChanged++;
          otherMaxDiff = Math.max(otherMaxDiff, diff);
        }
      }
      return { treePixels, treeChanged, otherChanged, otherMaxDiff };
    },
    [before.toString('base64'), after.toString('base64'), mask.toString('base64')] as const,
  );
}

const styles = ['low-poly', 'stylized', 'realistic'];
const effects = ['outline', 'glow', 'grade'];
const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

for (const backend of backends) {
  for (const style of backend.name === 'webgpu' ? styles : ['stylized']) {
    test(`Tree Effects for ${style} only change tree pixels (${backend.name})`, async ({ page }) => {
      const base = `style=${style}${backend.query}`;
      const mask = await shot(page, `${base}&view=mask`);
      const none = await shot(page, `${base}&effects=none`);
      for (const effect of [...effects, 'style']) {
        const image = await shot(page, `${base}&effects=${effect}`);
        const result = await compare(page, none, image, mask);
        expect(result.treePixels, 'the tree is in view').toBeGreaterThan(2000);
        expect(result, `${effect}: non-tree pixels unchanged`).toMatchObject({ otherChanged: 0 });
        expect(result.treeChanged, `${effect}: changes the tree`).toBeGreaterThan(300);
        await expect(page.locator('canvas')).toHaveScreenshot(`${style}-${effect}-${backend.name}.png`);
      }
    });
  }
}

test('Tree Effects compose with a hand-built pipeline and the user\'s own effects', async ({ page }) => {
  const mask = await shot(page, 'style=stylized&view=mask');
  const none = await shot(page, 'style=stylized&pipeline=custom&effects=none');
  const image = await shot(page, 'style=stylized&pipeline=custom&effects=style');
  const result = await compare(page, none, image, mask);
  // The vignette is compiled into a different shader in each case, so a pixel may round 1/255 apart.
  expect(result.otherMaxDiff).toBeLessThanOrEqual(1);
  expect(result.otherChanged).toBeLessThan(10);
  expect(result.treeChanged).toBeGreaterThan(300);
  await expect(page.locator('canvas')).toHaveScreenshot('stylized-custom-pipeline-webgpu.png');
});
