import { expect, test, type Page } from '@playwright/test';

type RendererState = { toneMapping: number; outputColorSpace: string; shadowMap: { enabled: boolean; type: number } };
type SceneExample = {
  status: string;
  backend?: string;
  error?: string;
  renderer?: { before: RendererState; after: RendererState };
  picked?: { name: string | null; x: number; y: number };
  regions?: Record<'crown' | 'ground', Rect>;
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
