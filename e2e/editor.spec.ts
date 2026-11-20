import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { validateBytes } from 'gltf-validator';
import type { Mesh } from 'three/webgpu';
import { bakeTree, createTree, CURRENT_SCHEMA_VERSION, parseDefinition } from '../src/index';
import { STYLE_NAMES } from '../src/index';

/** Waits until the preview has drawn the latest change, then returns the editor's state. */
async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, backend, error, store, preview } = window.treeEditor;
    return { status, backend, error, state: store?.state, treeId: preview?.tree?.id };
  });
}

test('smoke: load, edit a parameter, export JSON that the library loads', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  expect(await waitForEditor(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
  const { treeId } = await waitForEditor(page);

  await page.getByLabel('Trunk length').fill('4.2');
  await page.getByLabel('Trunk length').press('Enter');
  const edited = await waitForEditor(page);
  expect(edited.state?.definition.trunk.length).toBe(4.2);
  expect(edited.treeId).not.toBe(treeId); // regenerated

  await page.getByLabel('Name').fill('My oak');
  await page.getByLabel('Name').press('Enter');

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('my-oak.tree.json');
  const json = await readFile((await download.path())!, 'utf8');

  const exported = JSON.parse(json);
  expect(exported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  const definition = parseDefinition(json);
  expect(definition).toMatchObject({ name: 'My oak', trunk: { length: 4.2 } });
  const tree = createTree(definition, { seed: 1 });
  expect(tree.wood.geometry.getAttribute('position').count).toBeGreaterThan(0);
  expect(tree.leaves.geometry.getAttribute('position').count).toBeGreaterThan(0);
  tree.dispose();
});

// Old "<style>/<form>" links keep working: each Style's generic Definition per Form.
for (const style of STYLE_NAMES) {
  for (const form of ['broadleaf', 'conifer'] as const) {
    test(`starts from ${style}/${form}`, async ({ page }) => {
      await page.goto(`/editor/?start=${style}/${form}&seed=1`);
      const { status, state } = await waitForEditor(page);
      expect(status).toBe('rendered');
      expect(state?.source).toBe(`${form}/${style}`);
      expect(state?.definition.name.toLowerCase()).toContain(form);
      await expect(page.getByLabel('Species', { exact: true })).toHaveValue(form);
      await expect(page.getByLabel('Style', { exact: true })).toHaveValue(style);
      await expect(page.locator('#preview canvas')).toHaveScreenshot(`start-${style}-${form}.png`);
    });
  }
}

test('pick a Species and a Style, switch Style keeping shape edits, undo; reload keeps the Species and Style', async ({ page }) => {
  await page.goto('/editor/?seed=1');
  await waitForEditor(page);
  const species = page.getByLabel('Species', { exact: true });
  const style = page.getByLabel('Style', { exact: true });
  const groups = await species.locator('optgroup').evaluateAll((elements) => elements.map((element) => (element as HTMLOptGroupElement).label));
  expect(groups.slice(0, 2)).toEqual(['Generic', 'Broadleaf']);
  await expect(species.locator('optgroup[label="Generic"] option')).toHaveText(['Generic broadleaf', 'Generic conifer']);
  await expect(species.locator('optgroup[label="Broadleaf"] option[value="oak"]')).toHaveText('Oak');

  await style.selectOption('realistic');
  await species.selectOption('oak');
  await expect.poll(async () => (await waitForEditor(page)).state?.source).toBe('oak/realistic');
  const picked = await waitForEditor(page);
  expect(picked.status).toBe('rendered');
  expect(picked.state?.definition).toMatchObject({ name: 'Oak', species: 'oak', materials: { shading: 'standard' }, leaves: { shape: 'card' } });

  await page.getByLabel('Trunk length').fill('6.5');
  await page.getByLabel('Trunk length').press('Enter');
  await expect.poll(async () => (await waitForEditor(page)).state?.definition.trunk.length).toBe(6.5);
  const edited = (await waitForEditor(page)).state!;

  await style.selectOption('stylized');
  await expect.poll(async () => (await waitForEditor(page)).state?.source).toBe('oak/stylized');
  const switched = await waitForEditor(page);
  expect(switched.status).toBe('rendered');
  expect(switched.state?.definition).toMatchObject({ species: 'oak', trunk: { length: 6.5 }, materials: { shading: 'toon' }, leaves: { shape: 'puff' } });
  await expect(species).toHaveValue('oak');
  await expect(page.getByLabel('Trunk length')).toHaveValue('6.5');

  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await waitForEditor(page)).state).toEqual(edited);
  await expect(style).toHaveValue('realistic');
  await page.getByRole('button', { name: 'Redo' }).click();
  expect((await waitForEditor(page)).state?.source).toBe('oak/stylized');

  await page.reload();
  const reloaded = await waitForEditor(page);
  expect(reloaded.status).toBe('rendered');
  expect(reloaded.state).toEqual(switched.state);
  await expect(species).toHaveValue('oak');
  await expect(style).toHaveValue('stylized');
});

test('?start=<species>/<style> starts from a Species', async ({ page }) => {
  await page.goto('/editor/?start=oak/realistic&seed=1');
  const { status, state } = await waitForEditor(page);
  expect(status).toBe('rendered');
  expect(state?.definition).toMatchObject({ name: 'Oak', species: 'oak', materials: { shading: 'standard' } });
  await expect(page.getByLabel('Species', { exact: true })).toHaveValue('oak');
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('realistic');
});

test('?start=<species>/painterly: switch away and back keeps the Painterly size, and the export keeps it', async ({ page }) => {
  await page.goto('/editor/?start=oak/painterly&seed=1');
  const start = await waitForEditor(page);
  expect(start.status).toBe('rendered');
  expect(start.state?.definition).toMatchObject({ species: 'oak', materials: { shading: 'painted' }, leaves: { shape: 'mass' } });
  await expect(page.getByLabel('Species', { exact: true })).toHaveValue('oak');
  const style = page.getByLabel('Style', { exact: true });
  await expect(style).toHaveValue('painterly');
  const painterly = start.state!.definition;
  expect(painterly.trunk.length).toBeLessThan(2.5); // a ~14 m oak drawn about 3 m tall

  await style.selectOption('realistic');
  await expect.poll(async () => (await waitForEditor(page)).state?.source).toBe('oak/realistic');
  const realistic = await waitForEditor(page);
  expect(realistic.status).toBe('rendered');
  expect(realistic.state?.definition).toMatchObject({ materials: { shading: 'standard' }, trunk: { length: painterly.trunk.length } });
  await style.selectOption('painterly');
  await expect.poll(async () => (await waitForEditor(page)).state?.source).toBe('oak/painterly');
  expect((await waitForEditor(page)).state?.definition.trunk.length).toBe(painterly.trunk.length);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = parseDefinition(await readFile((await (await downloading).path())!, 'utf8'));
  expect(exported).toMatchObject({ species: 'oak', materials: { shading: 'painted' }, trunk: { length: painterly.trunk.length, radius: painterly.trunk.radius } });
});

test('imports a JSON Tree Definition (older schema versions migrate)', async ({ page }) => {
  await page.goto('/editor/?seed=1');
  await waitForEditor(page);
  const v1 = { schemaVersion: 1, trunk: { length: 3.5, radius: 0.3 }, bark: { color: '#664422' } };
  await page.locator('#import-json').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  await expect.poll(async () => (await waitForEditor(page)).state?.source).toBe('old.json');
  const { status, state } = await waitForEditor(page);
  expect(status).toBe('rendered');
  expect(state?.definition).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, trunk: { length: 3.5, radius: 0.3 } });
  await expect(page.getByLabel('Trunk length')).toHaveValue('3.5');
  await expect(page.getByLabel('Species', { exact: true })).toHaveValue('imported');

  await page.locator('#import-json').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion": 2, "trunk": {"length": -1}}') });
  await expect(page.locator('#status')).toContainText('trunk.length');
  expect((await waitForEditor(page)).state?.source).toBe('old.json');
});

test('Growth and Season sliders update the preview live; Seed regenerates', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const before = await waitForEditor(page);
  const readTree = () =>
    page.evaluate(() => {
      const tree = window.treeEditor.preview!.tree!;
      return { id: tree.id, growth: tree.growth, season: tree.season, seed: tree.seed };
    });

  const screenshotBefore = await page.locator('#preview canvas').screenshot();
  await page.getByLabel('Growth', { exact: true }).fill('0.4');
  await page.getByLabel('Season', { exact: true }).fill('0.7');
  await waitForEditor(page);
  expect(await readTree()).toMatchObject({ id: before.treeId, growth: 0.4, season: 0.7 }); // uniforms only
  expect(await page.locator('#preview canvas').screenshot()).not.toEqual(screenshotBefore);
  await expect(page.locator('#preview canvas')).toHaveScreenshot('growth-0.4-season-0.7.png');

  await page.getByLabel('Seed', { exact: true }).fill('7');
  await waitForEditor(page);
  const regenerated = await readTree();
  expect(regenerated).toMatchObject({ seed: 7, growth: 0.4, season: 0.7 });
  expect(regenerated.id).not.toBe(before.treeId);
});

/** The JSON chunk of a .glb. */
function glbJson(glb: Buffer) {
  const length = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + length).toString('utf8'));
}

async function exportGltf(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export glTF' }).click();
  const download = await downloading;
  const glb = await readFile((await download.path())!);
  const report = await validateBytes(new Uint8Array(glb));
  expect(report.issues.numErrors, JSON.stringify(report.issues.messages.slice(0, 5))).toBe(0);
  return { name: download.suggestedFilename(), glb, json: glbJson(glb) };
}

test('exports a Baked Tree glTF of the current Seed, Growth and Season', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=3&growth=0.9&season=0.62');
  const { state } = await waitForEditor(page);
  expect(state).toMatchObject({ seed: 3, growth: 0.9, season: 0.62 });

  const { name, json } = await exportGltf(page);
  expect(name).toBe(`${state!.definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.glb`);
  expect(json.animations ?? []).toEqual([]);
  expect(json.materials.every((m: { pbrMetallicRoughness?: object }) => m.pbrMetallicRoughness)).toBe(true);

  // Same Baked Tree as the library makes in Node from the same Definition, Seed, Growth and Season.
  const baked = bakeTree(createTree(state!.definition, { seed: 3 }), { growth: 0.9, season: 0.62 });
  const counts = Object.fromEntries(
    json.nodes
      .filter((n: { mesh?: number }) => n.mesh !== undefined)
      .map((n: { name: string; mesh: number }) => [n.name, json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION].count]),
  );
  expect(Object.keys(counts)).toEqual(['wood', 'leaves']);
  expect(counts).toEqual(
    Object.fromEntries(baked.children.map((m) => [m.name, (m as Mesh).geometry.getAttribute('position').count])),
  );
});

test('exports a textured (realistic) Baked Tree with its images embedded', async ({ page }) => {
  await page.goto('/editor/?start=realistic/broadleaf&seed=1&season=0.3');
  expect(await waitForEditor(page)).toMatchObject({ status: 'rendered' });
  const { json } = await exportGltf(page);
  expect(json.images.length).toBeGreaterThanOrEqual(2);
  const bark = json.materials.find((m: { name: string }) => m.name === 'bark');
  expect(bark.normalTexture).toBeDefined();
  expect(bark.pbrMetallicRoughness.baseColorTexture).toBeDefined();
});

test('Copy code: read-only preview that follows edits, three.js and React tabs, copied to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/editor/?start=low-poly/broadleaf&seed=3&growth=0.9&season=0.62');
  await waitForEditor(page);
  const preview = page.getByLabel('Code preview');
  await expect(preview).not.toBeEditable();
  await expect(preview).toHaveValue(/createTree\(definition, \{ seed: 3, growth: 0\.9, season: 0\.62 \}\)/);

  await page.getByLabel('Trunk length').fill('4.2');
  await page.getByLabel('Trunk length').press('Enter');
  await page.getByLabel('Seed', { exact: true }).fill('8');
  await waitForEditor(page);
  await expect(preview).toHaveValue(/length: 4\.2,/);
  await expect(preview).toHaveValue(/seed: 8,/);

  await page.getByRole('tab', { name: 'React' }).click();
  await expect(page.getByRole('tab', { name: 'React' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview).toHaveValue(/<Tree definition=\{definition\} seed=\{8\} growth=\{0\.9\} season=\{0\.62\} \/>/);

  await page.getByRole('button', { name: 'Copy code' }).click();
  await expect(page.locator('#status')).toContainText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await preview.inputValue());
  expect(copied).toContain("import { Tree } from '@casmo/tree.js/react';");
  const literal = /const definition = ([\s\S]*?) satisfies TreeDefinitionInput;/.exec(copied)![1]!;
  const { state } = await waitForEditor(page);
  expect(parseDefinition(new Function(`return (${literal});`)())).toEqual(state!.definition);
});

test('the editor also runs on the WebGL2 fallback', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/conifer&seed=1&backend=webgl');
  expect(await waitForEditor(page)).toMatchObject({ status: 'rendered', backend: 'webgl2' });
});
