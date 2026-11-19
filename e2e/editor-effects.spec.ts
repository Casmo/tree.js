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

/** Pixels that differ between two screenshots inside `rect` (fractions of the canvas: x, y, width, height). */
async function changedIn(page: Page, a: Buffer, b: Buffer, rect: [number, number, number, number]): Promise<number> {
  return page.evaluate(
    async ([x, y, r]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [ia, ib] = await Promise.all([decode(x), decode(y)]);
      const [x0, y0, x1, y1] = [r[0] * ia.width, r[1] * ia.height, (r[0] + r[2]) * ia.width, (r[1] + r[3]) * ia.height].map(Math.round) as [number, number, number, number];
      let changed = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * ia.width + px) * 4;
          const [pa, pb] = [ia.data, ib.data];
          if (Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!)) > 2) changed++;
        }
      }
      return changed;
    },
    [a.toString('base64'), b.toString('base64'), rect] as const,
  );
}

/** Waits for `frames` more preview frames (also while the Wind keeps it drawing), then screenshots the canvas. */
async function shotAfter(page: Page, frames: number): Promise<Buffer> {
  const start = await page.evaluate(() => window.treeEditor.preview!.renders);
  await page.waitForFunction((n) => window.treeEditor.preview!.renders >= n, start + frames, { timeout: 60_000 });
  return page.locator('#preview canvas').screenshot();
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
  test('TRAA keeps drawing until it has settled, without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => void (message.type() === 'error' && errors.push(message.text())));
    await page.goto('/editor/?start=broadleaf/realistic&seed=1');
    const none = await shot(page);
    const before = await page.evaluate(() => window.treeEditor.preview!.renders);
    await page.getByLabel('Anti-aliasing').selectOption('TRAA');
    const settled = await shot(page);
    expect(await page.evaluate(() => window.treeEditor.effects!.sceneSettings)).toEqual({ antialias: 'traa' });
    // Several whole jitter cycles (32 frames each) after the change, not one on-demand frame.
    expect(await page.evaluate(() => window.treeEditor.preview!.renders)).toBeGreaterThanOrEqual(before + 64);
    expect(await changedPixels(page, none, settled), 'TRAA changes the preview').toBeGreaterThan(50);
    // Settled: another full run (a camera change draws as many frames) gives the same image.
    await page.evaluate(() => window.treeEditor.preview!.requestRender());
    expect(await changedPixels(page, settled, await shot(page)), 'TRAA settles to a stable image').toBeLessThan(50);
    await page.getByLabel('Anti-aliasing').selectOption('Off');
    expect(await changedPixels(page, none, await shot(page)), 'TRAA off again').toBe(0);
    expect(errors).toEqual([]);
  });

  test('motion blur shows the Wind sway on the leaves, not on the still ground', async ({ page }) => {
    await page.goto('/editor/?start=broadleaf/realistic&seed=1');
    await shot(page);
    await page.locator('[id="wind-strength"]').fill('1.5');
    await page.locator('[id="wind-strength"]').press('Enter');
    // The Wind blows (the preview draws continuously) at a pinned time: the same sway every frame,
    // still a Wind-aware velocity (one frame of sway), so the frames can be compared.
    await page.evaluate(() => void (window.treeEditor.wind!.time = 3));
    const sharp = await shotAfter(page, 3);
    const toggle = page.getByLabel('Motion blur', { exact: true });
    await toggle.check();
    const blurred = await shotAfter(page, 3);
    // Crown: the upper middle of the frame; ground: the bottom strip, away from the trunk.
    const leaves = await changedIn(page, sharp, blurred, [0.25, 0.1, 0.5, 0.4]);
    const ground = await changedIn(page, sharp, blurred, [0, 0.9, 0.3, 0.1]);
    expect(leaves, 'motion blur changes leaf pixels').toBeGreaterThan(300);
    expect(ground, 'and not the ground').toBe(0);
    await toggle.uncheck();
    expect(await changedPixels(page, sharp, await shotAfter(page, 3)), 'motion blur off again').toBe(0);
  });

  test('motion blur shows camera orbiting, and clears once the camera stops', async ({ page }) => {
    await page.goto('/editor/?start=broadleaf/realistic&seed=1');
    await shot(page);
    await page.getByLabel('Motion blur', { exact: true }).check();
    const still = await shot(page);
    /** Orbits the camera by `angle` radians around the target, as a drag of the OrbitControls does. */
    const orbit = (angle: number) =>
      page.evaluate((a) => {
        const { camera, controls } = window.treeEditor.preview!;
        camera.position.sub(controls.target).applyAxisAngle(camera.up, a).add(controls.target);
        controls.update();
      }, angle);
    // One orbit step drawn as a single frame (the preview's extra settle frame held back): blurred.
    await page.evaluate(() => void (window.treeEditor.preview!.settleFrames = 1));
    await orbit(0.08);
    const moving = await shot(page);
    // Without motion blur, the same camera.
    await page.getByLabel('Motion blur', { exact: true }).uncheck();
    const moved = await shot(page);
    expect(await changedPixels(page, still, moved), 'the camera moved').toBeGreaterThan(300);
    expect(await changedPixels(page, moved, moving), 'camera motion blurs the frame').toBeGreaterThan(300);
    // With the preview's own settle frames: the frame after the move has no motion, so it is sharp.
    await page.getByLabel('Motion blur', { exact: true }).check();
    await shot(page);
    await orbit(-0.08);
    expect(await changedPixels(page, still, await shot(page)), 'sharp again once the camera stops').toBe(0);
  });
});
