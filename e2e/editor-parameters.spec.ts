import { expect, test, type Page } from '@playwright/test';
import { BRANCH_LEVEL_FIELDS, PARAMETER_GROUPS, type Field } from '../editor/src/panels/fields';

/** Waits until the preview has drawn the latest change, then returns the editor's state. */
async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store, preview } = window.treeEditor;
    return { status, error, definition: store!.state.definition, treeId: preview?.tree?.id };
  });
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);
const at = (definition: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], definition);

/** A valid value different from the current one. */
function newValue(field: Field, current: unknown): string {
  switch (field.kind) {
    case 'number': {
      const steps = Math.round((field.max - field.min) / field.step);
      const value = field.min + Math.round(steps * 0.25) * field.step;
      const rounded = Number(value.toFixed(6));
      return String(rounded === current ? rounded + field.step : rounded);
    }
    case 'choice':
      return field.options.find((option) => option !== current)!;
    case 'color':
      return current === '#336699' ? '#993366' : '#336699';
    case 'url':
      return 'realistic/bark.png';
    case 'text':
      return 'Edited tree';
    case 'toggle':
      return String(!(current ?? field.absent ?? false));
  }
}

async function setField(page: Page, field: Field, path: string, value: string): Promise<void> {
  const input = byId(page, path);
  if (field.kind === 'choice') await input.selectOption(value);
  else if (field.kind === 'toggle') await input.setChecked(value === 'true');
  else if (field.kind === 'color') await input.fill(value);
  else {
    await input.fill(value);
    await input.press('Enter');
  }
}

const expected = (field: Field, value: string): unknown => {
  if (field.kind === 'number') return Number(value);
  // A toggle switched back to what absent means removes the field.
  if (field.kind === 'toggle') return value === 'true' ? true : value === String(field.absent ?? false) ? undefined : false;
  return value;
};

test('every Definition field can be edited and the preview regenerates', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  let { definition, treeId } = await waitForEditor(page);
  const fields = [
    ...PARAMETER_GROUPS.flatMap((group) => group.fields.map((field) => [field, field.path] as const)),
    ...BRANCH_LEVEL_FIELDS.map((field) => [field, `branches.0.${field.path}`] as const),
    ...BRANCH_LEVEL_FIELDS.map((field) => [field, `branches.1.${field.path}`] as const),
    [{ kind: 'color', path: 'season.blossomColor', label: '' } as Field, 'season.blossomColor'] as const,
  ];
  for (const [field, path] of fields) {
    const value = newValue(field, at(definition, path));
    await setField(page, field, path, value);
    const edited = await waitForEditor(page);
    expect(edited.error, path).toBeUndefined();
    expect(at(edited.definition, path), path).toEqual(expected(field, value));
    expect(edited.treeId, `${path} regenerates the preview`).not.toBe(treeId);
    ({ definition, treeId } = edited);
    if (field.kind === 'url') {
      await byId(page, path).fill('');
      await byId(page, path).press('Enter');
      ({ definition, treeId } = await waitForEditor(page));
      expect(at(definition, path), `${path} cleared`).toBeNull();
    }
  }
  expect((await waitForEditor(page)).status).toBe('rendered');
});

test('sliders update the preview live while dragging', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const before = await waitForEditor(page);
  const slider = page.locator('#panel-trunk .control.slider input[type="range"]').first();
  await slider.fill('6');
  const after = await waitForEditor(page);
  expect(after.definition.trunk.length).toBe(6);
  expect(after.treeId).not.toBe(before.treeId);
  await expect(byId(page, 'trunk.length')).toHaveValue('6');
});

test('invalid input shows the validation error at the field', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const before = await waitForEditor(page);

  await byId(page, 'trunk.length').fill('-2');
  await byId(page, 'trunk.length').press('Enter');
  await expect(byId(page, 'trunk.length')).toHaveAttribute('aria-invalid', 'true');
  await expect(byId(page, 'trunk.length-error')).toHaveText('trunk.length must be a number > 0, got -2');
  await expect(page.locator('#status')).toContainText('trunk.length');
  expect((await waitForEditor(page)).definition.trunk).toEqual(before.definition.trunk);

  await byId(page, 'trunk.sides').fill('4.5');
  await byId(page, 'trunk.sides').press('Enter');
  await expect(byId(page, 'trunk.sides-error')).toContainText('trunk.sides must be an integer >= 3');

  // Cross-field rule: a level's start must not pass its end.
  await byId(page, 'branches.0.start').fill('0.99');
  await byId(page, 'branches.0.start').press('Enter');
  await expect(byId(page, 'branches.0.start-error')).toContainText('branches[0].end must be >= start (0.99)');

  // Fixing the value clears the error.
  await byId(page, 'trunk.length').fill('5');
  await byId(page, 'trunk.length').press('Enter');
  await expect(byId(page, 'trunk.length')).not.toHaveAttribute('aria-invalid');
  await expect(byId(page, 'trunk.length-error')).toBeHidden();
  expect((await waitForEditor(page)).definition.trunk.length).toBe(5);
});

test('Season Profile keyframes can be added, moved and removed', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1&season=0.4');
  const { definition } = await waitForEditor(page);
  const coverage = definition.season.leafCoverage;
  const track = () => waitForEditor(page).then((s) => s.definition.season.leafCoverage);

  // Add: at the preview Season, holding the value in force there.
  await page.getByRole('button', { name: 'Add Leaf coverage keyframe' }).click();
  const before = coverage.filter((key) => key.t <= 0.4).at(-1)!;
  const added = await track();
  expect(added).toHaveLength(coverage.length + 1);
  const index = added.findIndex((key) => key.t === 0.4);
  expect(added[index]).toEqual({ t: 0.4, value: before.value });

  // Edit its value, then move it past its neighbours: the track stays sorted.
  await byId(page, `season.leafCoverage.${index}.value`).fill('0.25');
  await byId(page, `season.leafCoverage.${index}.value`).press('Enter');
  expect((await track())[index]).toEqual({ t: 0.4, value: 0.25 });
  await byId(page, `season.leafCoverage.${index}.t`).fill('0.99');
  await byId(page, `season.leafCoverage.${index}.t`).press('Enter');
  const moved = await track();
  expect(moved.map((key) => key.t)).toEqual([...moved.map((key) => key.t)].sort((a, b) => a - b));
  expect(moved.find((key) => key.value === 0.25)).toEqual({ t: 0.99, value: 0.25 });
  await expect(page.locator(`[id="season.leafCoverage.${moved.findIndex((key) => key.t === 0.99)}.t"]`)).toBeFocused();

  // Remove it again.
  const movedIndex = moved.findIndex((key) => key.t === 0.99);
  await page.getByRole('button', { name: `Remove Leaf coverage key ${movedIndex + 1}` }).click();
  expect(await track()).toEqual(coverage);

  // Leaf colour keys are colours; a track keeps at least one key.
  await byId(page, 'season.leafColor.0.value').fill('#ff0000');
  expect((await waitForEditor(page)).definition.season.leafColor[0]!.value).toBe('#ff0000');
  const blossom = (await waitForEditor(page)).definition.season.blossom;
  for (let i = blossom.length; i > 1; i--) await page.getByRole('button', { name: `Remove Blossom key ${i}` }).click();
  await expect(page.getByRole('button', { name: 'Remove Blossom key 1' })).toBeDisabled();

  // A key time outside 0..1 is rejected at the field.
  await byId(page, 'season.blossom.0.t').fill('1.5');
  await byId(page, 'season.blossom.0.t').press('Enter');
  await expect(byId(page, 'season.blossom.0.t-error')).toContainText('season.blossom[0].t must be a number from 0 to 1');
});

test('branching levels can be added and removed', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const { definition } = await waitForEditor(page);
  const levels = definition.branches.length;
  await page.getByRole('button', { name: 'Add level' }).click();
  const added = await waitForEditor(page);
  expect(added.definition.branches).toHaveLength(levels + 1);
  expect(added.definition.branches.at(-1)).toEqual(definition.branches.at(-1));
  await expect(byId(page, `branches.${levels}.count`)).toBeVisible();

  await page.getByRole('button', { name: 'Remove level 1' }).click();
  const removed = await waitForEditor(page);
  expect(removed.definition.branches).toEqual(added.definition.branches.slice(1));
  await expect(byId(page, `branches.${levels}.count`)).toHaveCount(0);
  await expect(byId(page, 'branches.0.count')).toHaveValue(String(removed.definition.branches[0]!.count));
});

test('the preview Wind sways the tree', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  await waitForEditor(page);
  await byId(page, 'wind-direction').fill('90');
  await byId(page, 'wind-direction').press('Enter');
  await byId(page, 'wind-strength').fill('1');
  await byId(page, 'wind-strength').press('Enter');
  const wind = () =>
    page.evaluate(() => {
      const { tree, renders } = window.treeEditor.preview!;
      return { strength: tree!.wind.strength, direction: tree!.wind.direction.toArray(), renders };
    });
  const blowing = await wind();
  expect(blowing.strength).toBe(1);
  expect(blowing.direction[2]).toBeCloseTo(1);
  // Rendering continuously while the wind blows.
  await expect.poll(async () => (await wind()).renders).toBeGreaterThan(blowing.renders + 3);

  await byId(page, 'wind-strength').fill('0');
  await byId(page, 'wind-strength').press('Enter');
  expect((await wind()).strength).toBe(0);
  expect((await waitForEditor(page)).status).toBe('rendered');
});
