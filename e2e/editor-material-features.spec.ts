// Material Features (#58) in the Tree Editor: the "Material features" group in the Materials panel
// (a toggle and sliders per feature, "Use suggested for <Style>" and "Off"), undoable and exported.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseDefinition, type TreeDefinition } from '../src/index';

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store, preview } = window.treeEditor;
    return { status, error, definition: store!.state.definition, tree: preview!.tree!.uuid, occlusionStrength: preview!.tree!.occlusionStrength };
  });
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

async function fill(page: Page, id: string, value: string): Promise<void> {
  await byId(page, id).fill(value);
  await byId(page, id).press('Enter');
}

const features = (definition: TreeDefinition) => ({
  crownNormals: definition.materials.leaf.crownNormals,
  translucency: definition.materials.leaf.translucency,
  occlusion: definition.materials.occlusion,
});

const OFF = { crownNormals: undefined, translucency: undefined, occlusion: undefined };
const STYLIZED = { crownNormals: 1, translucency: { strength: 0.3, edge: 0.8, ambient: 0.2 }, occlusion: { strength: 0.9 } };

/** The preview as RGBA pixels, once it has rendered. */
async function pixels(page: Page): Promise<number[]> {
  const state = await waitForEditor(page);
  expect(state.status).toBe('rendered');
  const png = await page.locator('#preview canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
  }, png.toString('base64'));
}

/** Mean absolute difference per channel (0..255) between two previews. */
function difference(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

test('each feature toggle and slider changes the tree; the occlusion strength without a new tree', async ({ page }) => {
  test.setTimeout(120_000); // many renders on the CPU (SwiftShader)
  await page.goto('/editor/?start=oak/stylized&seed=1');
  const initial = await waitForEditor(page);
  expect(features(initial.definition)).toEqual(OFF);
  const plain = await pixels(page);

  for (const [label, slider] of [
    ['Crown Normals', 'materials.leaf.crownNormals'],
    ['Leaf Translucency', 'materials.leaf.translucency.strength'],
    ['Structural Occlusion', 'materials.occlusion.strength'],
  ] as const) {
    const toggle = page.getByLabel(label, { exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(byId(page, slider)).toHaveCount(0);
    await toggle.check();
    await expect(byId(page, slider)).toHaveCount(1);
    expect(difference(plain, await pixels(page)), `${label} on`).toBeGreaterThan(0.2);
    await toggle.uncheck();
    await expect(byId(page, slider)).toHaveCount(0);
    expect(difference(plain, await pixels(page)), `${label} off`).toBeLessThan(0.05);
  }
  expect(features((await waitForEditor(page)).definition)).toEqual(OFF);

  // Sliders: each tunes the tree on show.
  await page.getByLabel('Crown Normals', { exact: true }).check();
  const crown1 = await pixels(page);
  await fill(page, 'materials.leaf.crownNormals', '0.2');
  expect((await waitForEditor(page)).definition.materials.leaf.crownNormals).toBe(0.2);
  expect(difference(crown1, await pixels(page))).toBeGreaterThan(0.1);

  await page.getByLabel('Leaf Translucency', { exact: true }).check();
  const glow = await pixels(page);
  for (const [id, value] of [['strength', '1'], ['edge', '0'], ['ambient', '1']] as const) await fill(page, `materials.leaf.translucency.${id}`, value);
  expect((await waitForEditor(page)).definition.materials.leaf.translucency).toEqual({ strength: 1, edge: 0, ambient: 1 });
  expect(difference(glow, await pixels(page))).toBeGreaterThan(0.1);

  await page.getByLabel('Structural Occlusion', { exact: true }).check();
  const occluded = await waitForEditor(page);
  const dark = await pixels(page);
  await fill(page, 'materials.occlusion.strength', '0');
  const tuned = await waitForEditor(page);
  expect(tuned.error).toBeUndefined();
  expect(tuned.definition.materials.occlusion).toEqual({ strength: 0 });
  expect(tuned.occlusionStrength).toBe(0);
  expect(tuned.tree).toBe(occluded.tree); // a uniform, not a new tree
  expect(difference(dark, await pixels(page))).toBeGreaterThan(0.1);
});

test('"Use suggested for <Style>" and "Off" set and remove all three features, undoably, and the export carries them', async ({ page }) => {
  await page.goto('/editor/?start=oak/stylized&seed=1');
  await waitForEditor(page);
  const suggested = page.getByRole('button', { name: 'Use suggested for stylized' });
  const off = page.locator('#material-features-off');
  await expect(off).toBeDisabled();

  await suggested.click();
  expect(features((await waitForEditor(page)).definition)).toEqual(STYLIZED);
  for (const label of ['Crown Normals', 'Leaf Translucency', 'Structural Occlusion']) await expect(page.getByLabel(label, { exact: true })).toBeChecked();
  await expect(byId(page, 'materials.leaf.translucency.edge')).toHaveValue('0.8');

  await fill(page, 'materials.leaf.crownNormals', '0.4');
  const tuned = { ...STYLIZED, crownNormals: 0.4 };
  expect(features((await waitForEditor(page)).definition)).toEqual(tuned);

  // Saved in the exported JSON and in the code export.
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = parseDefinition(await readFile((await (await jsonDownload).path())!, 'utf8'));
  expect(features(exported)).toEqual(tuned);
  const code = await page.locator('#export-code').inputValue();
  expect(code).toContain('crownNormals: 0.4');
  expect(code).toMatch(/occlusion: \{\s*strength: 0.9\s*\}/);

  await off.click();
  expect(features((await waitForEditor(page)).definition)).toEqual(OFF);
  await expect(off).toBeDisabled();
  for (const label of ['Crown Normals', 'Leaf Translucency', 'Structural Occlusion']) await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();

  // Undo restores the tuned values, then the suggestion; redo goes forward again.
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(features((await waitForEditor(page)).definition)).toEqual(tuned);
  await expect(byId(page, 'materials.leaf.crownNormals')).toHaveValue('0.4');
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(features((await waitForEditor(page)).definition)).toEqual(STYLIZED);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(features((await waitForEditor(page)).definition)).toEqual(OFF);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(features((await waitForEditor(page)).definition)).toEqual(STYLIZED);

  // The button follows the Style the editor is in.
  await byId(page, 'start-style').selectOption('low-poly');
  await expect(page.getByRole('button', { name: 'Use suggested for low-poly' })).toBeVisible();
  // Material Features are the app's choice, never a Style's: a Style switch keeps them.
  expect(features((await waitForEditor(page)).definition)).toEqual(STYLIZED);
});
