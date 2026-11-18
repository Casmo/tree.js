import { expect, test, type Page } from '@playwright/test';

type EffectsExample = { status: string; backend?: string; error?: string; rebuilt?: boolean };

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
  for (const style of styles) {
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

for (const style of styles) {
  test(`set() with other colours and numbers for the same effects updates the look without a new graph (${style})`, async ({ page }) => {
    await shot(page, `style=${style}&from=tweaked`);
    const example = await page.evaluate(() => (window as unknown as { effectsExample: EffectsExample }).effectsExample);
    expect(example.rebuilt, 'the same output node').toBe(false);
    // Pixel-identical to the pipeline built with these settings from the start.
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-style-webgpu.png`);
  });
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

test('the tree mask and the outline cover Fruit', async ({ page }) => {
  const base = 'style=low-poly&fruit=round';
  const plainMask = await shot(page, 'style=low-poly&view=mask');
  const fruitMask = await shot(page, `${base}&view=mask`);
  await expect(page.locator('canvas')).toHaveScreenshot('low-poly-fruit-mask-webgpu.png');
  // Fruit hanging outside the canopy adds tree pixels to the mask.
  const added = await compare(page, plainMask, fruitMask, fruitMask);
  expect(added.treeChanged, 'Fruit pixels are tree pixels in the mask').toBeGreaterThan(200);

  const none = await shot(page, `${base}&effects=none`);
  const outlined = await shot(page, `${base}&effects=outline`);
  const result = await compare(page, none, outlined, fruitMask);
  expect(result, 'outline: only tree pixels (Fruit included) change').toMatchObject({ otherChanged: 0 });
  // The outline runs along the Fruit too: pixels that are Fruit only (not in the plain tree's mask) change.
  const onFruit = await compare(page, none, outlined, await onlyIn(page, fruitMask, plainMask));
  expect(onFruit.treeChanged, 'outline on Fruit').toBeGreaterThan(50);
  await expect(page.locator('canvas')).toHaveScreenshot('low-poly-fruit-outline-webgpu.png');
});

/** A mask image (PNG) of the pixels that are tree in `a` but not in `b`. */
async function onlyIn(page: Page, a: Buffer, b: Buffer): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [ia, ib] = await Promise.all([decode(pa), decode(pb)]);
      const out = new ImageData(ia.width, ia.height);
      for (let i = 0; i < out.data.length; i += 4) {
        out.data[i] = ia.data[i]! > 127 && ib.data[i]! <= 127 ? 255 : 0;
        out.data[i + 3] = 255;
      }
      const canvas = new OffscreenCanvas(out.width, out.height);
      canvas.getContext('2d')!.putImageData(out, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
  return Buffer.from(base64, 'base64');
}

for (const backend of backends) {
  test(`the Tree ID channel gives every Tree and Forest tree its own ID, read back under a point (${backend.name})`, async ({ page }) => {
    await shot(page, `style=low-poly&view=treeId${backend.query}`);
    const reads = await page.evaluate(() => window.effectsExample.readTreeIds!());
    expect(reads.map((r) => r.name)).toEqual(['tree', 'second', 'f0', 'f1']);
    for (const read of reads) {
      expect(read.id, `${read.name}: its own ID under its trunk`).toBe(read.expected);
      expect(read.resolved, `${read.name}: the ID resolves to it`).toBe(read.name);
    }
    expect(new Set(reads.map((r) => r.id)).size).toBe(reads.length);
    if (backend.name === 'webgl2') await expect(page.locator('canvas')).toHaveScreenshot('low-poly-tree-id-webgl2.png');
    // A tree that is no longer drawn leaves no ID behind (the integer target is cleared every frame).
    await page.evaluate(() => window.effectsExample.hideTree!());
    const after = await page.evaluate(() => window.effectsExample.readTreeIds!());
    expect(after[0]!.id, "nothing is drawn under the hidden tree's trunk").toBe(0);
    expect(after.slice(1)).toEqual(reads.slice(1));
  });
}

for (const backend of backends) {
  test(`effects.pick() resolves the Tree or Forest tree under a point (${backend.name})`, async ({ page }) => {
    for (const name of ['f0', 'f1', 'second']) {
      await shot(page, `style=low-poly&pick=${name}${backend.query}`);
      const picked = await page.evaluate(() => window.effectsExample.picked);
      expect(picked?.name, `the tree under ${name}'s trunk`).toBe(name);
    }
  });
}

/** The pixels that differ between two screenshots (decoded in the page): how many, and their bounding box. */
async function changedPixels(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [ia, ib] = await Promise.all([decode(pa), decode(pb)]);
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      let count = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        const diff = Math.max(Math.abs(ia.data[i]! - ib.data[i]!), Math.abs(ia.data[i + 1]! - ib.data[i + 1]!), Math.abs(ia.data[i + 2]! - ib.data[i + 2]!));
        if (diff === 0) continue;
        const x = (i / 4) % ia.width;
        const y = Math.floor(i / 4 / ia.width);
        count++;
        box.left = Math.min(box.left, x);
        box.right = Math.max(box.right, x);
        box.top = Math.min(box.top, y);
        box.bottom = Math.max(box.bottom, y);
      }
      return { count, box, width: ia.width };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

for (const backend of backends) {
  test(`a Forest tree picked through effects.pick() is highlighted, the rest only gets its ring (${backend.name})`, async ({ page }) => {
    const plain = await shot(page, `style=low-poly&pick=f0${backend.query}`);
    const image = await shot(page, `style=low-poly&highlight=f0${backend.query}`);
    const picked = await page.evaluate(() => window.effectsExample.picked);
    expect(picked?.name, 'pick() returns the Forest tree under its trunk').toBe('f0');
    await expect(page.locator('canvas')).toHaveScreenshot(`low-poly-highlight-f0-${backend.name}.png`);
    // Only the highlighted tree and its ring change: around the picked point, not the other trees.
    const changed = await changedPixels(page, plain, image);
    expect(changed.count, 'the highlighted tree changes').toBeGreaterThan(300);
    expect(changed.box.left).toBeLessThanOrEqual(picked!.x);
    expect(changed.box.right).toBeGreaterThanOrEqual(picked!.x);
    expect(changed.box.bottom).toBeGreaterThanOrEqual(picked!.y);
    expect(changed.box.right - changed.box.left, 'one tree changes').toBeLessThan(changed.width / 2);
  });
}
