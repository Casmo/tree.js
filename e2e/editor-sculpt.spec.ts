import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createTree, hashTreeData, parseDefinition } from '../src/index';

/** Waits until the preview has drawn the latest change, then returns the editor's state. */
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
      paths: tree?.data.skeleton.branches.map((b) => b.path) ?? [],
      leaves: tree?.data.skeleton.leaves.length ?? 0,
    };
  });
}

/** Where a point of a branch (t = 0 base .. 1 tip, in the skeleton) is on screen. */
async function screenPoint(page: Page, path: string, t: number) {
  return page.evaluate(
    ({ path, t }) => {
      const { preview } = window.treeEditor;
      const branch = preview!.tree!.data.skeleton.branches.find((b) => b.path === path)!;
      const point = branch.points[Math.round(t * (branch.points.length - 1))]!.position;
      const v = preview!.camera.position.clone().set(...point).project(preview!.camera);
      const rect = preview!.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    { path, t },
  );
}

const start = '/editor/?start=low-poly/broadleaf&seed=1';

test('delete a branch by clicking it; undo and redo it', async ({ page }) => {
  await page.goto(start);
  const before = await waitForEditor(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const target = await screenPoint(page, '0.2', 0.5);
  await page.mouse.click(target.x, target.y);

  const after = await waitForEditor(page);
  expect(after.state.definition.sculpts).toHaveLength(1);
  const [sculpt] = after.state.definition.sculpts;
  expect(sculpt).toMatchObject({ seed: 1, action: 'delete' });
  expect(sculpt!.path).toMatch(/^0\./); // a branch (or a twig in front of it), not the trunk
  expect(after.status).toBe('rendered');
  expect(after.paths).toEqual(before.paths.filter((p) => p !== sculpt!.path && !p.startsWith(`${sculpt!.path}.`)));
  await expect(page.locator('#sculpt-list')).toContainText('1 Sculpt on Seed 1');

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).paths).toEqual(before.paths);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect((await waitForEditor(page)).paths).toEqual(after.paths);

  // Deleting the trunk leaves an empty tree.
  const trunk = await screenPoint(page, '0', 0.25);
  await page.mouse.click(trunk.x, trunk.y);
  expect(await waitForEditor(page)).toMatchObject({ status: 'rendered', paths: [] });
});

test('move a branch by dragging it: one undo step per drag; the camera stays put', async ({ page }) => {
  await page.goto(start);
  const before = await waitForEditor(page);
  const camera = () => page.evaluate(() => window.treeEditor.preview!.camera.position.toArray());
  const cameraBefore = await camera();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const from = await screenPoint(page, '0.1', 0.6);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x - i * 4, from.y - i * 5);
  // While dragging, the preview already shows the move, but the store (undo) does not have it yet.
  expect((await waitForEditor(page)).state.definition.sculpts).toEqual([]);
  await page.mouse.up();

  const after = await waitForEditor(page);
  const [sculpt] = after.state.definition.sculpts;
  expect(after.state.definition.sculpts).toHaveLength(1);
  expect(sculpt).toMatchObject({ seed: 1, action: 'move', scale: 1 });
  expect(sculpt!.path).toMatch(/^0\./);
  expect(Math.hypot(...(sculpt as { rotation: number[] }).rotation)).toBeGreaterThan(0.05);
  expect(await camera()).toEqual(cameraBefore);
  await expect(page.locator('#preview canvas')).toHaveScreenshot('sculpt-move.png');

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).state.definition).toEqual(before.state.definition);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('paint leaves away with the brush, export JSON and import it again', async ({ page }) => {
  await page.goto(start);
  const before = await waitForEditor(page);
  await page.getByRole('button', { name: 'Paint leaves' }).click();
  await page.getByLabel('Leaf coverage', { exact: true }).fill('0');
  await page.getByLabel('Brush size', { exact: true }).fill('1.5');
  const twigs = before.paths.filter((p) => p.split('.').length === before.state.definition.branches.length + 1);
  const a = await screenPoint(page, twigs[0]!, 1);
  const b = await screenPoint(page, twigs.at(-1)!, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();

  const painted = await waitForEditor(page);
  const sculpts = painted.state.definition.sculpts;
  expect(sculpts.length).toBeGreaterThan(0);
  expect(sculpts.every((s) => s.seed === 1 && s.action === 'leaves' && s.coverage === 0)).toBe(true);
  expect(painted.status).toBe('rendered');
  expect(painted.leaves).toBeLessThan(before.leaves);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).state.definition.sculpts).toEqual([]);
  await page.getByRole('button', { name: 'Redo' }).click();
  await waitForEditor(page);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const json = await readFile((await (await downloading).path())!, 'utf8');
  const exported = parseDefinition(json);
  expect(exported.sculpts).toEqual(sculpts);
  // The library grows the same sculpted tree from the exported JSON.
  expect(createTree(exported, { seed: 1 }).data.skeleton.leaves.length).toBe(painted.leaves);
  expect(hashTreeData(createTree(exported, { seed: 1 }).data)).not.toBe(hashTreeData(createTree(before.state.definition, { seed: 1 }).data));

  await page.goto(start);
  await waitForEditor(page);
  await page.locator('#import-json').setInputFiles({ name: 'painted.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect.poll(async () => (await waitForEditor(page)).state.source).toBe('painted.json');
  const imported = await waitForEditor(page);
  expect(imported.state.definition.sculpts).toEqual(sculpts);
  expect(imported.leaves).toBe(painted.leaves);
});

test('changing Seed with Sculpts warns first; the Sculpts come back on their Seed', async ({ page }) => {
  await page.goto(start);
  await waitForEditor(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const target = await screenPoint(page, '0', 0.25);
  await page.mouse.click(target.x, target.y);
  const sculpted = await waitForEditor(page);
  expect(sculpted.paths).toEqual([]);

  const seed = page.getByLabel('Seed', { exact: true });
  await seed.fill('2');
  const dialog = page.getByRole('dialog', { name: 'Change Seed?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 Sculpt made on Seed 1');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await waitForEditor(page)).state.seed).toBe(1);
  await expect(seed).toHaveValue('1');

  await seed.fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Change Seed' }).click();
  const other = await waitForEditor(page);
  expect(other.state.seed).toBe(2);
  expect(other.paths.length).toBeGreaterThan(0); // Seed 2 ignores the Sculpt...
  expect(other.state.definition.sculpts).toEqual(sculpted.state.definition.sculpts); // ...which is kept
  await expect(page.locator('#sculpt-list')).toContainText('Seed 1: 1 Sculpt');

  // Without Sculpts on Seed 2, going back needs no warning.
  await page.getByRole('button', { name: 'Go to Seed 1' }).click();
  const back = await waitForEditor(page);
  expect(back.state.seed).toBe(1);
  expect(back.paths).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
