// Fantasy Styles (#143) in the Tree Editor: the Whimsical and Enchanted starts and shadings, the Leaf
// Palettes editor, the Inner Glow sliders (enchanted shading only, retuning the tree live) and the
// Style switch rules of ADR 0017. Enchanted previews pin the Wind clock: the glow pulses with it.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_INNER_GLOW, parseDefinition } from '../src/index';

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store, preview } = window.treeEditor;
    const tree = preview?.tree;
    return {
      status,
      error,
      state: store!.state,
      tree: tree && { id: tree.id, innerGlow: tree.innerGlow, leafPalette: tree.leafPalette },
    };
  });
}

/** Pins the Wind clock (the Inner Glow pulse) and waits for the redraw. */
async function pinWind(page: Page) {
  await waitForEditor(page);
  await page.evaluate(() => {
    window.treeEditor.wind!.time = 0;
    window.treeEditor.preview!.requestRender();
  });
  return waitForEditor(page);
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

async function fill(page: Page, id: string, value: string): Promise<void> {
  await byId(page, id).fill(value);
  await byId(page, id).press('Enter');
}

/** Mean brightness (0..255) of the preview. */
async function brightness(page: Page): Promise<number> {
  const png = await page.locator('#preview canvas').screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (data.length / 4);
  }, png.toString('base64'));
}

test('the Fantasy starts load from the picker and the Shading field offers both new shadings', async ({ page }) => {
  await page.goto('/editor/?start=oak/realistic&seed=1');
  await waitForEditor(page);
  const shading = byId(page, 'materials.shading');
  await expect(shading.locator('option')).toHaveText(['standard', 'flat', 'toon', 'painted', 'whimsical', 'enchanted']);
  const style = page.getByLabel('Style', { exact: true });
  await expect(style.locator('option')).toContainText(['Whimsical', 'Enchanted']);

  await page.getByLabel('Species', { exact: true }).selectOption('pine');
  await style.selectOption('whimsical');
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('pine/whimsical');
  const species = page.getByLabel('Species', { exact: true });
  await species.selectOption('oak');
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('oak/whimsical');
  const whimsical = await waitForEditor(page);
  expect(whimsical.status).toBe('rendered');
  expect(whimsical.state.definition).toMatchObject({ species: 'oak', materials: { shading: 'whimsical' } });
  await expect(shading).toHaveValue('whimsical');

  await shading.selectOption('enchanted');
  const enchanted = await waitForEditor(page);
  expect(enchanted.error).toBeUndefined();
  expect(enchanted.state.definition.materials.shading).toBe('enchanted');
});

test('Inner Glow sliders show only for the enchanted shading and retune the tree live; undo restores', async ({ page }) => {
  await page.goto('/editor/?start=oak/enchanted&seed=1');
  const start = await pinWind(page);
  expect(start.status).toBe('rendered');
  expect(start.tree?.innerGlow).toEqual(DEFAULT_INNER_GLOW);
  const toggle = page.getByLabel('Inner Glow', { exact: true });
  await expect(toggle).toBeChecked();
  await expect(byId(page, 'materials.innerGlow.leaf')).toHaveValue('1');
  await expect(byId(page, 'materials.innerGlow.veins')).toHaveValue('1');
  const own = await brightness(page);

  await fill(page, 'materials.innerGlow.leaf', '4');
  await fill(page, 'materials.innerGlow.veins', '0');
  const tuned = await pinWind(page);
  expect(tuned.error).toBeUndefined();
  expect(tuned.state.definition.materials.innerGlow).toEqual({ leaf: 4, veins: 0 });
  expect(tuned.tree).toMatchObject({ id: start.tree!.id, innerGlow: { leaf: 4, veins: 0 } }); // live: the same tree
  const bright = await brightness(page);
  expect(bright).toBeGreaterThan(own + 1);

  await fill(page, 'materials.innerGlow.leaf', '0');
  await pinWind(page);
  expect(await brightness(page)).toBeLessThan(own);

  await toggle.uncheck();
  const off = await waitForEditor(page);
  expect(off.state.definition.materials).not.toHaveProperty('innerGlow');
  expect(off.tree?.innerGlow).toBeNull();
  await expect(byId(page, 'materials.innerGlow.leaf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await waitForEditor(page);
  expect(undone.state.definition.materials.innerGlow).toEqual({ leaf: 0, veins: 0 });
  await expect(toggle).toBeChecked();
  await expect(byId(page, 'materials.innerGlow.leaf')).toHaveValue('0');
  await toggle.uncheck();
  await toggle.check();
  expect((await waitForEditor(page)).state.definition.materials.innerGlow).toEqual(DEFAULT_INNER_GLOW);

  // Another shading draws no glow: the controls hide (the field stays, for switching back).
  await byId(page, 'materials.shading').selectOption('toon');
  const toon = await waitForEditor(page);
  expect(toon.state.definition.materials.innerGlow).toEqual(DEFAULT_INNER_GLOW);
  await expect(toggle).toBeHidden();
  await expect(byId(page, 'materials.innerGlow.leaf')).toBeHidden();
  await byId(page, 'materials.shading').selectOption('enchanted');
  await waitForEditor(page);
  await expect(toggle).toBeVisible();
  await expect(byId(page, 'materials.innerGlow.leaf')).toBeVisible();
});

test('Leaf Palettes: add, edit keyframes and accent, remove, with the tree updating live; undo, reload and export keep them', async ({ page }) => {
  await page.goto('/editor/?start=oak/realistic&seed=1');
  const start = await waitForEditor(page);
  expect(start.state.definition.season).not.toHaveProperty('leafPalettes');
  expect(start.tree?.leafPalette).toBeNull();
  const leafColor = start.state.definition.season.leafColor;
  await expect(byId(page, 'leaf-palettes-note')).toContainText('None');

  await page.getByRole('button', { name: 'Add Leaf Palette' }).click();
  const one = await waitForEditor(page);
  expect(one.state.definition.season.leafPalettes).toEqual([{ leafColor, accent: leafColor[0]!.value }]);
  expect(one.tree?.leafPalette).toEqual(one.state.definition.season.leafPalettes![0]);
  await expect(byId(page, 'leaf-palettes-note')).toContainText('Seed 1 picks Palette 1 of 1');

  await page.getByLabel('Palette 1 accent', { exact: true }).fill('#ff40c0');
  await byId(page, 'season.leafPalettes.0.leafColor.0.value').fill('#20c0a0');
  await page.getByRole('button', { name: 'Add Palette 1 leaf colour keyframe' }).click();
  const added = await waitForEditor(page);
  const keys = added.state.definition.season.leafPalettes![0]!.leafColor;
  expect(keys).toHaveLength(leafColor.length + 1);
  const at = leafColor.filter((key) => key.t <= added.state.season).length; // added at the preview Season
  await byId(page, `season.leafPalettes.0.leafColor.${at}.value`).fill('#c02080');
  await waitForEditor(page);
  await fill(page, `season.leafPalettes.0.leafColor.${at}.t`, '0.42');
  const edited = await waitForEditor(page);
  expect(edited.error).toBeUndefined();
  const palette = edited.state.definition.season.leafPalettes![0]!;
  expect(palette.accent).toBe('#ff40c0');
  expect(palette.leafColor.at(0)?.value).toBe('#20c0a0');
  expect(palette.leafColor).toContainEqual({ t: 0.42, value: '#c02080' });
  expect(edited.tree?.leafPalette).toEqual(palette); // the preview follows
  expect(edited.tree?.id).not.toBe(one.tree?.id);

  await page.getByRole('button', { name: 'Add Leaf Palette' }).click();
  const two = await waitForEditor(page);
  expect(two.state.definition.season.leafPalettes).toEqual([palette, palette]);
  await byId(page, 'season.leafPalettes.1.accent').fill('#40e0ff');
  await expect(byId(page, 'leaf-palettes-note')).toContainText('of 2');
  // Every Seed picks one: over a few Seeds both palettes show up.
  const picks = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await page.evaluate((value) => window.treeEditor.store!.set({ seed: value }), seed);
    picks.add((await waitForEditor(page)).tree!.leafPalette!.accent);
  }
  expect([...picks].sort()).toEqual(['#40e0ff', '#ff40c0']);

  await page.getByRole('button', { name: 'Remove Leaf Palette 1' }).click();
  const removed = await waitForEditor(page);
  expect(removed.state.definition.season.leafPalettes?.map((p) => p.accent)).toEqual(['#40e0ff']);
  await expect(byId(page, 'leaf-palette-1')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await waitForEditor(page);
  expect(undone.state.definition.season.leafPalettes?.map((p) => p.accent)).toEqual(['#ff40c0', '#40e0ff']);
  await expect(byId(page, 'season.leafPalettes.1.accent')).toHaveValue('#40e0ff');

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = parseDefinition(await readFile((await (await downloading).path())!, 'utf8'));
  expect(exported).toEqual(undone.state.definition);

  // Autosave: a reload (no ?start) brings the palettes back.
  await page.goto('/editor/');
  const reloaded = await waitForEditor(page);
  expect(reloaded.state.definition.season.leafPalettes).toEqual(undone.state.definition.season.leafPalettes);
  await expect(byId(page, 'leaf-palette-1')).toBeVisible();
});

test('the Style switch keeps a fantasy tree\'s Twist, palettes and Inner Glow; Whimsical and Enchanted replace them', async ({ page }) => {
  await page.goto('/editor/?start=oak/enchanted&seed=1');
  await waitForEditor(page);
  await fill(page, 'materials.innerGlow.leaf', '2.5');
  const enchanted = (await waitForEditor(page)).state.definition;
  const style = page.getByLabel('Style', { exact: true });

  await style.selectOption('realistic');
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('oak/realistic');
  const realistic = await waitForEditor(page);
  expect(realistic.status).toBe('rendered');
  expect(realistic.state.definition).toMatchObject({
    materials: { shading: 'standard', innerGlow: { leaf: 2.5, veins: 1 } },
    trunk: { twist: enchanted.trunk.twist, twistStyle: enchanted.trunk.twistStyle },
    season: { leafPalettes: enchanted.season.leafPalettes, leafColor: enchanted.season.leafColor },
  });
  await expect(page.getByLabel('Inner Glow', { exact: true })).toBeHidden();
  await expect(byId(page, 'leaf-palette-0')).toBeVisible();

  await style.selectOption('whimsical');
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('oak/whimsical');
  const whimsical = (await waitForEditor(page)).state.definition;
  expect(whimsical.materials).not.toHaveProperty('innerGlow');
  expect(whimsical.season.leafPalettes).not.toEqual(enchanted.season.leafPalettes);

  await style.selectOption('enchanted');
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('oak/enchanted');
  const again = await pinWind(page);
  expect(again.state.definition.materials.innerGlow).toEqual(DEFAULT_INNER_GLOW);
  expect(again.state.definition.season.leafPalettes).toEqual(enchanted.season.leafPalettes);
  await expect(page.getByLabel('Inner Glow', { exact: true })).toBeChecked();
  await expect(page.locator('#preview canvas')).toHaveScreenshot('oak-enchanted-after-switch.png');
});
