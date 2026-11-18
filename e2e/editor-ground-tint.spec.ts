// Ground Tint (#49) in the Tree Editor: a toggle with colour, height and strength in the Materials
// panel, rendered in all three shading models, undoable and exported.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GROUND_TINT, parseDefinition } from '../src/index';

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store } = window.treeEditor;
    return { status, error, definition: store!.state.definition };
  });
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

async function fill(page: Page, id: string, value: string): Promise<void> {
  await byId(page, id).fill(value);
  await byId(page, id).press('Enter');
}

/** Pixels of the preview that are clearly magenta (the test tint). */
async function magentaPixels(page: Page): Promise<number> {
  const state = await waitForEditor(page);
  expect(state.status).toBe('rendered');
  const png = await page.locator('#preview canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (r > 90 && b > 90 && g < 0.5 * Math.min(r, b)) count++;
    }
    return count;
  }, png.toString('base64'));
}

test('the Ground Tint toggle adds, tunes, removes and exports materials.bark.groundTint', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const initial = await waitForEditor(page);
  expect(initial.definition.materials.bark).not.toHaveProperty('groundTint');
  const toggle = page.getByLabel('Ground Tint', { exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(byId(page, 'materials.bark.groundTint.height')).toHaveCount(0);

  await toggle.check();
  expect((await waitForEditor(page)).definition.materials.bark.groundTint).toEqual(DEFAULT_GROUND_TINT);
  await byId(page, 'materials.bark.groundTint.color').fill('#2f3a1c');
  await fill(page, 'materials.bark.groundTint.height', '1.2');
  await fill(page, 'materials.bark.groundTint.strength', '0.8');
  const tuned = await waitForEditor(page);
  expect(tuned.error).toBeUndefined();
  expect(tuned.definition.materials.bark.groundTint).toEqual({ color: '#2f3a1c', height: 1.2, strength: 0.8 });

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = parseDefinition(await readFile((await (await jsonDownload).path())!, 'utf8'));
  expect(exported.materials.bark.groundTint).toEqual({ color: '#2f3a1c', height: 1.2, strength: 0.8 });

  await toggle.uncheck();
  expect((await waitForEditor(page)).definition.materials.bark).not.toHaveProperty('groundTint');
  await expect(byId(page, 'materials.bark.groundTint.height')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).definition.materials.bark.groundTint).toEqual(tuned.definition.materials.bark.groundTint);
  await expect(toggle).toBeChecked();
});

for (const shading of ['standard', 'flat', 'toon'] as const) {
  test(`the Ground Tint colours the bark near the ground (${shading} shading)`, async ({ page }) => {
    await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
    await waitForEditor(page);
    await byId(page, 'materials.shading').selectOption(shading);
    const plain = await magentaPixels(page);

    await page.getByLabel('Ground Tint', { exact: true }).check();
    await byId(page, 'materials.bark.groundTint.color').fill('#ff00ff');
    await fill(page, 'materials.bark.groundTint.height', '1.5');
    await fill(page, 'materials.bark.groundTint.strength', '1');
    const tinted = await magentaPixels(page);
    expect(plain).toBeLessThan(20);
    expect(tinted).toBeGreaterThan(plain + 200);
  });
}
