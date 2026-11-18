// Tree Editor controls for the Species parameters (#39): Stems, Leaf/Bark Type, Crown Shape curves
// with one-click shapes, and Fruit with its Season tracks. Every edit regenerates the preview and is undoable.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { validateBytes } from 'gltf-validator';
import { DEFAULT_FRUIT, parseDefinition } from '../src/index';

async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store, preview } = window.treeEditor;
    return {
      status,
      error,
      definition: store!.state.definition,
      treeId: preview?.tree?.id,
      fruitVertices: preview?.tree?.fruit.geometry.getAttribute('position')?.count ?? 0,
    };
  });
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

/** Undoes every step (quick edits of the same parameter merge into one). */
async function undoAll(page: Page): Promise<void> {
  const undo = page.getByRole('button', { name: 'Undo' });
  while (await undo.isEnabled()) await undo.click();
}

async function fill(page: Page, id: string, value: string): Promise<void> {
  await byId(page, id).fill(value);
  await byId(page, id).press('Enter');
}

test('Stems, Stem spread, trunk gravity, Leaf Type and Bark Type edit the Definition and undo', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const initial = await waitForEditor(page);
  expect(initial.definition.trunk).not.toHaveProperty('stems');
  // Absent optional fields show what they mean.
  await expect(byId(page, 'trunk.stems')).toHaveValue('1');
  await expect(byId(page, 'trunk.spread')).toHaveValue('0');
  await expect(byId(page, 'leaves.type')).toHaveValue('');

  await fill(page, 'trunk.stems', '3');
  await fill(page, 'trunk.spread', '25');
  await fill(page, 'trunk.gravity', '-0.4');
  await byId(page, 'leaves.type').selectOption('lobed');
  await byId(page, 'materials.bark.type').selectOption('papery');
  const edited = await waitForEditor(page);
  expect(edited.error).toBeUndefined();
  expect(edited.definition.trunk).toMatchObject({ stems: 3, spread: 25, gravity: -0.4 });
  expect(edited.definition.leaves.type).toBe('lobed');
  expect(edited.definition.materials.bark.type).toBe('papery');
  expect(edited.treeId).not.toBe(initial.treeId);

  // "not set" removes an optional choice again.
  await byId(page, 'leaves.type').selectOption('');
  expect((await waitForEditor(page)).definition.leaves).not.toHaveProperty('type');

  await undoAll(page);
  expect((await waitForEditor(page)).definition).toEqual(initial.definition);
  await expect(byId(page, 'trunk.stems')).toHaveValue('1');
  await expect(byId(page, 'materials.bark.type')).toHaveValue('');
});

test('one-click Crown Shapes write curves the editor shows and lets you fine-tune', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const initial = await waitForEditor(page);
  expect(initial.definition.branches[0]).not.toHaveProperty('lengthProfile');
  await expect(page.getByRole('button', { name: 'Flat Length curve, level 1' })).toBeDisabled();

  await page.getByRole('button', { name: 'Vase crown, level 1' }).click();
  const vase = await waitForEditor(page);
  const curves = vase.definition.branches[0]!;
  expect(curves.lengthProfile!.length).toBeGreaterThan(1);
  expect(curves.angleProfile!.length).toBeGreaterThan(1);
  expect(vase.treeId).not.toBe(initial.treeId);
  // The curve editors show the keys.
  await expect(byId(page, 'branches.0.lengthProfile.0.t')).toHaveValue(String(curves.lengthProfile![0]!.t));
  await expect(byId(page, 'branches.0.angleProfile.1.value')).toHaveValue(String(curves.angleProfile![1]!.value));

  // Fine-tune: change a value, add a keyframe, remove it.
  await fill(page, 'branches.0.lengthProfile.1.value', '1.4');
  expect((await waitForEditor(page)).definition.branches[0]!.lengthProfile![1]!.value).toBe(1.4);
  await page.getByRole('button', { name: 'Add Length curve, level 1 keyframe' }).click();
  const added = (await waitForEditor(page)).definition.branches[0]!.lengthProfile!;
  expect(added).toHaveLength(curves.lengthProfile!.length + 1);
  await page.getByRole('button', { name: `Remove Length curve, level 1 key ${added.length}` }).click();
  expect((await waitForEditor(page)).definition.branches[0]!.lengthProfile).toHaveLength(curves.lengthProfile!.length);

  // A shape replaces both curves (the cone has flat angles); Flat removes a curve.
  await page.getByRole('button', { name: 'Cone crown, level 1' }).click();
  const cone = (await waitForEditor(page)).definition.branches[0]!;
  expect(cone).not.toHaveProperty('angleProfile');
  await expect(byId(page, 'branches.0.angleProfile.0.value')).toHaveValue('1');
  await page.getByRole('button', { name: 'Flat Length curve, level 1' }).click();
  expect((await waitForEditor(page)).definition.branches[0]).not.toHaveProperty('lengthProfile');

  // Editing an absent (flat) curve writes it.
  await fill(page, 'branches.1.angleProfile.0.value', '0.5');
  expect((await waitForEditor(page)).definition.branches[1]!.angleProfile).toEqual([{ t: 0, value: 0.5 }]);

  // Undo all the way back.
  await undoAll(page);
  expect((await waitForEditor(page)).definition).toEqual(initial.definition);
});

test('Fruit can be added, tuned with its Season tracks, removed, and exports', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1&season=0.7');
  const initial = await waitForEditor(page);
  expect(initial.fruitVertices).toBe(0);
  await expect(byId(page, 'track-fruit')).toBeHidden();

  await page.getByRole('button', { name: 'Add Fruit', exact: true }).click();
  const added = await waitForEditor(page);
  expect(added.definition.fruit).toEqual(DEFAULT_FRUIT);
  expect(added.fruitVertices).toBeGreaterThan(0);
  await expect(byId(page, 'track-fruit')).toBeVisible();
  // Absent Season tracks show their defaults.
  await expect(byId(page, 'season.fruitColor.0.value')).toHaveValue('#b8322a');

  await byId(page, 'fruit.type').selectOption('pear');
  await fill(page, 'fruit.count', '4');
  await fill(page, 'fruit.size', '0.2');
  await fill(page, 'fruit.sizeVariation', '0.1');
  await fill(page, 'fruit.hang', '0.9');
  const tuned = await waitForEditor(page);
  expect(tuned.definition.fruit).toEqual({ type: 'pear', count: 4, size: 0.2, sizeVariation: 0.1, hang: 0.9 });
  expect(tuned.treeId).not.toBe(added.treeId);

  // Fruit amount and colour tracks: the first edit writes the track.
  await byId(page, 'season.fruitColor.0.value').fill('#ddaa22');
  await page.getByRole('button', { name: 'Add Fruit amount keyframe' }).click();
  await fill(page, 'season.fruit.0.value', '0');
  const seasoned = await waitForEditor(page);
  expect(seasoned.definition.season.fruitColor).toEqual([{ t: 0, value: '#ddaa22' }]);
  expect(seasoned.definition.season.fruit).toEqual([{ t: 0, value: 0 }, { t: 0.7, value: 1 }]);

  // Export JSON keeps it all.
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = parseDefinition(await readFile((await (await jsonDownload).path())!, 'utf8'));
  expect(exported.fruit).toEqual(tuned.definition.fruit);
  expect(exported.season.fruit).toEqual(seasoned.definition.season.fruit);

  // Export glTF still makes a valid Baked Tree.
  const glbDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export glTF' }).click();
  const glb = await readFile((await (await glbDownload).path())!);
  const report = await validateBytes(new Uint8Array(glb));
  expect(report.issues.numErrors, JSON.stringify(report.issues.messages.slice(0, 5))).toBe(0);

  await page.getByRole('button', { name: 'Remove Fruit', exact: true }).click();
  const removed = await waitForEditor(page);
  expect(removed.definition).not.toHaveProperty('fruit');
  expect(removed.fruitVertices).toBe(0);
  await expect(byId(page, 'track-fruit')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add Fruit', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).definition.fruit).toEqual(tuned.definition.fruit);
  await expect(byId(page, 'fruit.type')).toHaveValue('pear');
});
