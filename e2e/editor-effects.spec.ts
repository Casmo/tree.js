import { expect, test, type Page } from '@playwright/test';

/** Waits until the preview has drawn the latest change, then screenshots the canvas. */
async function shot(page: Page): Promise<Buffer> {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.treeEditor.status)).toBe('rendered');
  return page.locator('#preview canvas').screenshot();
}

/** Number of pixels that differ between two screenshots (decoded in the page). */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [pa, pb] = await Promise.all([decode(x), decode(y)]);
      let changed = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!)) > 2) changed++;
      }
      return changed;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

test('each Tree Effect can be toggled in the preview', async ({ page }) => {
  await page.goto('/editor/?start=stylized/broadleaf&seed=1');
  const none = await shot(page);
  for (const label of ['Colour grade', 'Leaf glow', 'Outline']) {
    const toggle = page.getByLabel(label, { exact: true });
    await toggle.check();
    const on = await shot(page);
    expect(await changedPixels(page, none, on), `${label} changes the preview`).toBeGreaterThan(300);
    await toggle.uncheck();
    expect(await changedPixels(page, none, await shot(page)), `${label} off again`).toBe(0);
  }
  expect(await page.evaluate(() => window.treeEditor.effects?.settings)).toBeNull();
});

test("applies the current Style's suggested combination with one action", async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  await shot(page);
  await expect(page.getByLabel('Effects Style')).toHaveValue('low-poly');
  await page.getByRole('button', { name: 'Apply low-poly suggestion' }).click();
  await shot(page);
  await expect(page.getByLabel('Colour grade', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Leaf glow', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Outline', { exact: true })).toBeChecked();
  await expect(page.locator('#preview canvas')).toHaveScreenshot('low-poly-suggested.png');

  // A new starting point brings its Style's settings; its suggestion is one click away.
  await page.getByLabel('Style / Form').selectOption('stylized/broadleaf');
  await expect(page.getByLabel('Effects Style')).toHaveValue('stylized');
  await page.getByRole('button', { name: 'Apply stylized suggestion' }).click();
  await expect(page.getByLabel('Leaf glow', { exact: true })).toBeChecked();
  await expect(page.locator('#preview canvas')).toHaveScreenshot('stylized-suggested.png');
});

test('Tree Effects preview works on the WebGL2 fallback', async ({ page }) => {
  await page.goto('/editor/?start=stylized/conifer&seed=1&backend=webgl');
  const none = await shot(page);
  await page.getByRole('button', { name: 'Apply stylized suggestion' }).click();
  const styled = await shot(page);
  expect(await page.evaluate(() => window.treeEditor.backend)).toBe('webgl2');
  expect(await changedPixels(page, none, styled)).toBeGreaterThan(300);
});
