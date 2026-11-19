import { expect, test, type Page } from '@playwright/test';

type RendererState = { toneMapping: number; outputColorSpace: string; shadowMap: { enabled: boolean; type: number } };
type SceneExample = {
  status: string;
  backend?: string;
  error?: string;
  renderer?: { before: RendererState; after: RendererState };
  picked?: { name: string | null; x: number; y: number };
  regions?: Record<'crown' | 'ground', Rect>;
  antialias?: string[];
  fog?: { during: boolean; after?: boolean };
};
type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Loads the Scene Pipeline example and returns its status and a screenshot of the canvas (status text hidden). */
async function load(page: Page, query: string): Promise<{ example: SceneExample; image: Buffer }> {
  await page.goto(`/examples/scene-pipeline/?${query}`);
  await page.waitForFunction(() => (window as unknown as { scenePipelineExample?: SceneExample }).scenePipelineExample?.status !== 'loading', null, {
    timeout: 60_000,
  });
  const example = await page.evaluate(() => (window as unknown as { scenePipelineExample: SceneExample }).scenePipelineExample);
  expect(example).toMatchObject({ status: 'rendered' });
  await page.addStyleTag({ content: '#status { display: none; }' });
  return { example, image: await page.locator('canvas').screenshot() };
}

/** How many pixels of two screenshots differ at all, and by how much at most (decoded in the page). */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<{ changed: number; maxDiff: number }> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      let changed = 0;
      let maxDiff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const diff = Math.max(Math.abs(da[i]! - db[i]!), Math.abs(da[i + 1]! - db[i + 1]!), Math.abs(da[i + 2]! - db[i + 2]!));
        if (diff > 0) changed++;
        maxDiff = Math.max(maxDiff, diff);
      }
      return { changed, maxDiff };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

for (const backend of backends) {
  test(`a Scene Pipeline without style or overrides renders exactly like renderer.render() (${backend.name})`, async ({ page }) => {
    const plain = await load(page, `style=realistic&scene=plain${backend.query}`);
    const none = await load(page, `style=realistic&scene=none${backend.query}`);
    expect(await difference(page, plain.image, none.image)).toEqual({ changed: 0, maxDiff: 0 });
  });
}

for (const style of ['low-poly', 'stylized', 'realistic']) {
  test(`the Scene Pipeline never changes the renderer's tone mapping, colour space or shadow map (${style})`, async ({ page }) => {
    const { example } = await load(page, `style=${style}&scene=style`);
    expect(example.renderer!.before.shadowMap.enabled, 'the app turned shadows on').toBe(true);
    expect(example.renderer!.after).toEqual(example.renderer!.before);
  });
}

test('tone mapping alone, through sceneToneMapping in a hand-made pipeline (realistic, WebGPU)', async ({ page }) => {
  const plain = await load(page, 'style=realistic&scene=plain');
  const toneMapped = await load(page, 'style=realistic&scene=tone-mapping');
  expect(toneMapped.example.renderer!.after).toEqual(toneMapped.example.renderer!.before);
  expect((await difference(page, plain.image, toneMapped.image)).changed, 'tone mapping changes the frame').toBeGreaterThan(10_000);
  await expect(page.locator('canvas')).toHaveScreenshot('realistic-tone-mapping-webgpu.png');
});

test('god rays alone, through sceneGodrays on the shadow-casting sun (realistic, WebGPU)', async ({ page }) => {
  const plain = await load(page, 'style=realistic&sun=back&scene=plain');
  const rays = await load(page, 'style=realistic&sun=back&scene=godrays');
  expect(rays.example.renderer!.after, 'shadows and lights are the app\'s').toEqual(rays.example.renderer!.before);
  expect((await difference(page, plain.image, rays.image)).changed, 'god rays change the frame').toBeGreaterThan(10_000);
  await expect(page.locator('canvas')).toHaveScreenshot('realistic-godrays-webgpu.png');
});

test('ambient occlusion alone, through sceneAO in a hand-made pipeline (realistic, WebGPU)', async ({ page }) => {
  const plain = await load(page, 'style=realistic&scene=plain');
  const occluded = await load(page, 'style=realistic&scene=gtao');
  expect(occluded.example.renderer!.after).toEqual(occluded.example.renderer!.before);
  expect((await difference(page, plain.image, occluded.image)).changed, 'AO darkens the frame').toBeGreaterThan(5_000);
  await expect(page.locator('canvas')).toHaveScreenshot('realistic-gtao-webgpu.png');
});

for (const mode of ['smaa', 'fxaa']) {
  test(`${mode.toUpperCase()} alone, through sceneAntialias in a hand-made pipeline (realistic, WebGPU)`, async ({ page }) => {
    const plain = await load(page, 'style=realistic&scene=plain');
    const antialiased = await load(page, `style=realistic&scene=${mode}`);
    const { changed, maxDiff } = await difference(page, plain.image, antialiased.image);
    // Only edges change, and not the whole frame (the colours stay the renderer's own).
    expect(changed, `${mode} smooths edges`).toBeGreaterThan(500);
    expect(changed, `${mode} leaves flat areas alone`).toBeLessThan(640 * 480 * 0.5);
    expect(maxDiff).toBeGreaterThan(20);
    await expect(page.locator('canvas')).toHaveScreenshot(`realistic-${mode}-webgpu.png`);
  });
}

test('switching anti-aliasing between SMAA and FXAA at runtime with set()', async ({ page }) => {
  const smaa = await load(page, 'style=realistic&scene=style');
  const switched = await load(page, 'style=realistic&scene=style&antialias=fxaa,smaa');
  expect(switched.example.antialias).toEqual(['fxaa', 'smaa']);
  expect(await difference(page, smaa.image, switched.image)).toEqual({ changed: 0, maxDiff: 0 });
  const fxaa = await load(page, 'style=realistic&scene=style&antialias=smaa,fxaa');
  expect((await difference(page, smaa.image, fxaa.image)).changed, 'FXAA differs from SMAA').toBeGreaterThan(200);
});

test('bloom alone, through sceneBloom in a hand-made pipeline (realistic, WebGPU)', async ({ page }) => {
  const plain = await load(page, 'style=realistic&scene=plain');
  const bloomed = await load(page, 'style=realistic&scene=bloom');
  expect(bloomed.example.renderer!.after).toEqual(bloomed.example.renderer!.before);
  expect((await difference(page, plain.image, bloomed.image)).changed, 'bloom changes the frame').toBeGreaterThan(10_000);
  await expect(page.locator('canvas')).toHaveScreenshot('realistic-bloom-webgpu.png');
});

test('fog alone, through sceneFog as the app\'s scene.fogNode (realistic, WebGPU)', async ({ page }) => {
  const plain = await load(page, 'style=realistic&scene=plain');
  const fogged = await load(page, 'style=realistic&scene=fog');
  expect((await difference(page, plain.image, fogged.image)).changed, 'fog changes the frame').toBeGreaterThan(10_000);
  await expect(page.locator('canvas')).toHaveScreenshot('realistic-fog-webgpu.png');
});

for (const appFog of [false, true]) {
  test(`after dispose(), scene.fogNode is the app's value again (${appFog ? 'its own fog node' : 'no fog node'})`, async ({ page }) => {
    const { example } = await load(page, `style=realistic&scene=style&dispose=1${appFog ? '&appFog=1' : ''}`);
    expect(example.fog).toEqual({ during: false, after: true });
  });
}

test.describe('the Scene Pipeline behaves as TreeEffects for its Tree Effects part', () => {
  const cases = [
    { name: 'suggested Tree Effects', query: 'style=low-poly&scene=none&treeEffects=style' },
    { name: 'selection', query: 'style=stylized&scene=none&treeEffects=style&selection=tree' },
    { name: 'pick() and treeId', query: 'style=realistic&scene=none&treeEffects=style&pick=f2' },
    { name: 'highlighted', query: 'style=stylized&scene=none&treeEffects=style&pick=tree&highlight=1' },
  ];
  for (const { name, query } of cases) {
    test(name, async ({ page }) => {
      const effects = await load(page, `${query}&via=tree-effects`);
      const pipeline = await load(page, query);
      expect(pipeline.example.picked).toEqual(effects.example.picked);
      expect(await difference(page, effects.image, pipeline.image)).toEqual({ changed: 0, maxDiff: 0 });
    });
  }

  test('pick() finds the front tree and Forest trees', async ({ page }) => {
    for (const name of ['tree', 'f0', 'f2', 'f3']) {
      const { example } = await load(page, `style=realistic&scene=style&pick=${name}`);
      expect(example.picked?.name).toBe(name);
    }
  });

  test('the Highlight marks the picked tree', async ({ page }) => {
    const plain = await load(page, 'style=stylized&scene=style&pick=tree');
    const marked = await load(page, 'style=stylized&scene=style&pick=tree&highlight=1');
    expect(marked.example.picked?.name).toBe('tree');
    expect((await difference(page, plain.image, marked.image)).changed).toBeGreaterThan(300);
  });
});

/** Per region (CSS pixels): the share of pixels with any red or green (a velocity view's |x|, |y|), and the largest value. */
async function moving(page: Page, image: Buffer, regions: Record<string, Rect>): Promise<Record<string, { share: number; max: number }>> {
  return page.evaluate(
    async ([png, rects]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const out: Record<string, { share: number; max: number }> = {};
      for (const [name, r] of Object.entries(rects)) {
        let count = 0;
        let hits = 0;
        let max = 0;
        for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(bitmap.height, Math.ceil(r.y1)); y++) {
          for (let x = Math.max(0, Math.floor(r.x0)); x < Math.min(width, Math.ceil(r.x1)); x++) {
            const i = (y * width + x) * 4;
            const v = Math.max(data[i]!, data[i + 1]!);
            count++;
            if (v > 0) hits++;
            max = Math.max(max, v);
          }
        }
        out[name] = { share: hits / Math.max(1, count), max };
      }
      return out;
    },
    [image.toString('base64'), regions] as const,
  );
}

test.describe('Wind-aware velocity (ADR 0011)', () => {
  const views = [
    { name: 'windVelocityMRT in a hand-made pipeline', query: 'scene=velocity' },
    { name: "the Scene Pipeline's velocity channel", query: 'scene=velocity&via=scene-pipeline' },
    { name: 'windVelocityMRT on WebGL2', query: 'scene=velocity&backend=webgl' },
  ];
  for (const { name, query } of views) {
    test(`with Wind pinned at a fixed strength, velocity is non-zero on leaves and zero on the ground (${name})`, async ({ page }) => {
      const windy = await load(page, `style=realistic&${query}&wind=1.5&windTime=3`);
      const regions = windy.example.regions!;
      const blowing = await moving(page, windy.image, regions);
      expect(blowing.crown!.share, 'leaves move').toBeGreaterThan(0.05);
      expect(blowing.crown!.max).toBeGreaterThan(20);
      expect(blowing.ground, 'the ground stands still').toEqual({ share: 0, max: 0 });

      const calm = await load(page, `style=realistic&${query}&wind=0&windTime=3`);
      expect(await moving(page, calm.image, regions), 'no Wind, no motion').toEqual({ crown: { share: 0, max: 0 }, ground: { share: 0, max: 0 } });
    });
  }

  test('the velocity channel does not change the rendered frame', async ({ page }) => {
    const without = await load(page, 'style=realistic&scene=style&wind=1.5&windTime=3');
    const withVelocity = await load(page, 'style=realistic&scene=style&wind=1.5&windTime=3&velocity=1');
    expect(await difference(page, without.image, withVelocity.image)).toEqual({ changed: 0, maxDiff: 0 });
  });
});

test.describe('TRAA (temporal anti-aliasing with Wind-aware velocity)', () => {
  // A pinned Wind: leaves report a constant non-zero velocity (ADR 0011) while the image is still.
  const wind = 'wind=1.5&windTime=3';
  const cases = [
    { name: 'sceneAntialias(color, "traa", input) in a hand-made pipeline', query: `style=realistic&scene=traa&${wind}` },
    { name: 'the Scene Pipeline with antialias: "traa"', query: `style=realistic&scene=style&antialias=traa&${wind}` },
  ];
  for (const { name, query } of cases) {
    test(`renders without errors and settles to a stable image (${name})`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      page.on('pageerror', (error) => errors.push(error.message));
      const plain = await load(page, `style=realistic&scene=plain&${wind}`);
      // TRAA jitters the camera through a cycle of 32 offsets: compare the same offset a cycle apart.
      const settled = await load(page, `${query}&frames=64`);
      const later = await load(page, `${query}&frames=96`);
      expect(errors).toEqual([]);
      expect((await difference(page, plain.image, settled.image)).changed, 'TRAA changes the frame').toBeGreaterThan(500);
      const { changed, maxDiff } = await difference(page, settled.image, later.image);
      expect(maxDiff, 'no ghosting or drift once settled').toBeLessThanOrEqual(16);
      expect(changed).toBeLessThan(640 * 480 * 0.1);
    });
  }
});

test.describe('motion blur along the Wind-aware velocity', () => {
  const wind = 'wind=3&windTime=3';

  test('motion blur alone, through sceneMotionBlur (realistic, WebGPU, strong pinned Wind, one camera step)', async ({ page }) => {
    const plain = await load(page, `style=realistic&scene=plain&${wind}&cameraStep=0.5`);
    const blurred = await load(page, `style=realistic&scene=motion-blur&${wind}&cameraStep=0.5`);
    expect(blurred.example.renderer!.after).toEqual(blurred.example.renderer!.before);
    expect((await difference(page, plain.image, blurred.image)).changed, 'motion blur changes the frame').toBeGreaterThan(10_000);
    await expect(page.locator('canvas')).toHaveScreenshot('realistic-motion-blur-webgpu.png');
  });

  const views = [
    { name: 'sceneMotionBlur in a hand-made pipeline', query: 'scene=motion-blur' },
    { name: 'the Scene Pipeline, which requests the velocity channel itself', query: 'scene=motion-blur&via=scene-pipeline' },
  ];
  for (const { name, query } of views) {
    test(`with a still camera, Wind sway blurs the leaves and not the ground (${name})`, async ({ page }) => {
      const plain = await load(page, `style=realistic&scene=plain&${wind}`);
      const blurred = await load(page, `style=realistic&${query}&${wind}`);
      const changed = await changedIn(page, plain.image, blurred.image, blurred.example.regions!);
      expect(changed.crown, 'swaying leaves blur').toBeGreaterThan(0.05);
      expect(changed.ground, 'the ground stands still').toBe(0);
    });
  }

  test('a camera step blurs the frame further (the same view, with one step of camera motion)', async ({ page }) => {
    const still = await load(page, `style=realistic&scene=motion-blur&${wind}`);
    const stepped = await load(page, `style=realistic&scene=motion-blur&${wind}&cameraStep=0.5`);
    expect((await difference(page, still.image, stepped.image)).changed).toBeGreaterThan(10_000);
  });
});

/** Per region (CSS pixels): the share of pixels that differ clearly (by more than 2 of 255) between two screenshots. */
async function changedIn(page: Page, a: Buffer, b: Buffer, regions: Record<string, Rect>): Promise<Record<string, number>> {
  return page.evaluate(
    async ([pa, pb, rects]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      const out: Record<string, number> = {};
      for (const [name, r] of Object.entries(rects)) {
        let count = 0;
        let changed = 0;
        for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(da.height, Math.ceil(r.y1)); y++) {
          for (let x = Math.max(0, Math.floor(r.x0)); x < Math.min(da.width, Math.ceil(r.x1)); x++) {
            const i = (y * da.width + x) * 4;
            const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(da.data[i + c]! - db.data[i + c]!)));
            count++;
            if (diff > 2) changed++;
          }
        }
        out[name] = changed / Math.max(1, count);
      }
      return out;
    },
    [a.toString('base64'), b.toString('base64'), regions] as const,
  );
}
