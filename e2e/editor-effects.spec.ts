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

const SCENE_LABELS = ['Tone mapping', 'Ambient occlusion', 'Bloom', 'Fog', 'God rays'];

/** Switches the Scene group off (Tree Effects only, as before the Scene group). */
async function sceneOff(page: Page): Promise<void> {
  for (const label of SCENE_LABELS) await page.getByLabel(label, { exact: true }).uncheck();
  await page.getByLabel('Anti-aliasing').selectOption('Off');
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

test('Inner Lines can be toggled in the preview, with the Style\'s ink settings', async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  const none = await shot(page);
  const toggle = page.getByLabel('Inner lines', { exact: true });
  await toggle.check();
  const on = await shot(page);
  expect(await changedPixels(page, none, on), 'Inner lines change the preview').toBeGreaterThan(300);
  expect(await page.evaluate(() => window.treeEditor.effects?.settings)).toEqual({
    innerLines: { color: '#18230f', thickness: 1, strength: 0.8 },
  });
  await toggle.uncheck();
  expect(await changedPixels(page, none, await shot(page)), 'Inner lines off again').toBe(0);
  expect(await page.evaluate(() => window.treeEditor.effects?.settings)).toBeNull();
  // Highlight is not part of the Editor.
  await expect(page.locator('#effect-highlight')).toHaveCount(0);
});

test("applies the current Style's suggested combination with one action", async ({ page }) => {
  await page.goto('/editor/?start=low-poly/broadleaf&seed=1');
  await shot(page);
  await expect(page.getByLabel('Effects Style')).toHaveValue('low-poly');
  await page.getByRole('button', { name: 'Apply low-poly suggestion' }).click();
  await shot(page);
  await expect(page.getByLabel('Colour grade', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Leaf glow', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Inner lines', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Outline', { exact: true })).toBeChecked();
  // The suggestion includes the Scene Effects (see the Scene tests); here the Tree Effects alone.
  await sceneOff(page);
  await shot(page);
  await expect(page.locator('#preview canvas')).toHaveScreenshot('low-poly-suggested.png');

  // A new Style brings its settings; its suggestion is one click away.
  await page.getByLabel('Species', { exact: true }).selectOption('conifer');
  await page.getByLabel('Style', { exact: true }).selectOption('stylized');
  await expect(page.getByLabel('Effects Style')).toHaveValue('stylized');
  await page.getByLabel('Species', { exact: true }).selectOption('broadleaf');
  await expect.poll(() => page.evaluate(() => window.treeEditor.store?.state.source)).toBe('broadleaf/stylized');
  await expect(page.getByLabel('Effects Style')).toHaveValue('stylized');
  await page.getByRole('button', { name: 'Apply stylized suggestion' }).click();
  await expect(page.getByLabel('Leaf glow', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Inner lines', { exact: true })).toBeChecked();
  await sceneOff(page);
  await shot(page);
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

test.describe('Scene group', () => {
  for (const [style, species] of [['low-poly', 'conifer'], ['stylized', 'broadleaf'], ['realistic', 'broadleaf']] as const) {
    test(`applies the ${style} suggestion of both groups (full suggestion screenshot)`, async ({ page }) => {
      await page.goto(`/editor/?start=${species}/${style}&seed=1`);
      const none = await shot(page);
      await page.getByRole('button', { name: `Apply ${style} suggestion` }).click();
      const suggested = await shot(page);
      expect(await changedPixels(page, none, suggested)).toBeGreaterThan(300);
      await expect(page.getByLabel('Tone mapping', { exact: true })).toBeChecked();
      await expect(page.getByLabel('Fog', { exact: true })).toBeChecked();
      await expect(page.getByLabel('God rays', { exact: true })).toBeChecked({ checked: style === 'realistic' });
      await expect(page.getByLabel('Anti-aliasing')).toHaveValue('smaa');
      // God rays make the preview sun cast shadows.
      expect(await page.evaluate(() => window.treeEditor.preview!.sun.castShadow)).toBe(style === 'realistic');
      await expect(page.locator('#preview canvas')).toHaveScreenshot(`${style}-scene-suggested.png`);
    });
  }

  test('each Scene Effect and the AA choice can be toggled, and leave nothing behind', async ({ page }) => {
    await page.goto('/editor/?start=broadleaf/realistic&seed=1');
    const none = await shot(page);
    const definition = await page.evaluate(() => JSON.stringify(window.treeEditor.store!.state.definition));
    for (const label of SCENE_LABELS) {
      const toggle = page.getByLabel(label, { exact: true });
      await toggle.check();
      expect(await changedPixels(page, none, await shot(page)), `${label} changes the preview`).toBeGreaterThan(300);
      await toggle.uncheck();
      expect(await changedPixels(page, none, await shot(page)), `${label} off again`).toBe(0);
    }
    for (const mode of ['SMAA', 'FXAA']) {
      await page.getByLabel('Anti-aliasing').selectOption(mode);
      expect(await changedPixels(page, none, await shot(page)), `${mode} changes the preview`).toBeGreaterThan(50);
    }
    await page.getByLabel('Anti-aliasing').selectOption('Off');
    expect(await changedPixels(page, none, await shot(page)), 'AA off again').toBe(0);
    const after = await page.evaluate(() => ({
      definition: JSON.stringify(window.treeEditor.store!.state.definition),
      canUndo: window.treeEditor.history!.canUndo,
      fogNode: window.treeEditor.preview!.scene.fogNode ?? null,
      castShadow: window.treeEditor.preview!.sun.castShadow,
      shadowMap: window.treeEditor.preview!.renderer.shadowMap.enabled,
      sceneSettings: window.treeEditor.effects!.sceneSettings,
    }));
    // Preview-only: the Definition and history are untouched; fog and the sun's shadows are given back.
    expect(after).toEqual({ definition, canUndo: false, fogNode: null, castShadow: false, shadowMap: false, sceneSettings: null });
  });
});
