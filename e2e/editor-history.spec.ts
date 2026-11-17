import { expect, test, type Page } from '@playwright/test';

/** Waits until the preview has drawn the latest change, then returns the editor's state. */
async function waitForEditor(page: Page) {
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => window.treeEditor?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => {
    const { status, error, store } = window.treeEditor;
    return { status, error, state: store?.state };
  });
}

const state = async (page: Page) => (await waitForEditor(page)).state!;

test('undo/redo every edit with the keyboard shortcuts and the buttons', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const initial = await state(page);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await page.getByLabel('Trunk length').fill('4.2');
  await page.getByLabel('Trunk length').press('Enter');
  await page.getByLabel('Growth').fill('0.4');
  await page.getByLabel('Style / Form').selectOption('low-poly/conifer');
  await expect.poll(async () => (await state(page)).source).toBe('low-poly/conifer');

  // Focus outside the fields, then use the shortcuts.
  await page.locator('#preview canvas').click();
  await page.keyboard.press('Control+z');
  expect(await state(page)).toMatchObject({ source: 'low-poly/broadleaf', growth: 0.4, definition: { trunk: { length: 4.2 } } });
  await expect(page.getByLabel('Style / Form')).toHaveValue('low-poly/broadleaf');
  await page.keyboard.press('Control+z');
  expect((await state(page)).growth).toBe(1);
  await expect(page.getByLabel('Growth')).toHaveValue('1');

  // Ctrl+Z inside a number field (after committing it) undoes the edit too, and the field follows.
  await page.getByLabel('Trunk length').focus();
  await page.keyboard.press('Control+z');
  expect(await state(page)).toEqual(initial);
  await expect(page.getByLabel('Trunk length')).toHaveValue(String(initial.definition.trunk.length));
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await page.keyboard.press('Control+Shift+z');
  expect((await state(page)).definition.trunk.length).toBe(4.2);
  await page.keyboard.press('Control+y');
  expect((await state(page)).growth).toBe(0.4);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect((await state(page)).source).toBe('low-poly/conifer');
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await state(page)).source).toBe('low-poly/broadleaf');
  expect((await waitForEditor(page)).status).toBe('rendered');
});

test('after a reload the last state is restored', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  await waitForEditor(page);
  await page.getByLabel('Trunk length').fill('4.2');
  await page.getByLabel('Trunk length').press('Enter');
  await page.getByLabel('Name').fill('My oak');
  await page.getByLabel('Name').press('Enter');
  await page.getByLabel('Seed').fill('7');
  await page.getByLabel('Season').fill('0.8');
  const before = await state(page);
  expect(before).toMatchObject({ seed: 7, season: 0.8, definition: { name: 'My oak', trunk: { length: 4.2 } } });

  await page.reload();
  const after = await waitForEditor(page);
  expect(after.status).toBe('rendered');
  expect(after.state).toEqual(before);
  await expect(page.getByLabel('Trunk length')).toHaveValue('4.2');
  await expect(page.getByLabel('Name')).toHaveValue('My oak');
  await expect(page.getByLabel('Seed')).toHaveValue('7');

  // An explicit starting point in the URL begins anew.
  await page.goto('/editor/?start=low-poly/conifer');
  expect((await state(page)).definition.name).not.toBe('My oak');
});
