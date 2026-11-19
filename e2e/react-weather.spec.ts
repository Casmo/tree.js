import { expect, test, type Page } from '@playwright/test';

// #106: Tree Shader Hooks, Snow Cover, Wetness, Wind Bursts and custom Tree Effects through
// `@casmo/tree.js/react` (examples/react/?scene=weather): two low-poly trees, the left one in front and
// the right one behind, with the props and components toggled through React state. Each runs on WebGPU and
// on WebGPURenderer's WebGL2 fallback (ADR 0002).

test.describe.configure({ timeout: 180_000 });

type Weather = { snow?: number; wetness?: number; tint?: boolean; effect?: number };
type Example = {
  status: string;
  backend?: string;
  error?: string;
  setWeather: (weather: Weather) => void;
  setWindTime: (seconds: number) => void;
  burst: (options: { x: number; z: number; strength?: number; radius?: number }) => void;
  frames: (count: number) => Promise<void>;
};

async function load(page: Page, query: string): Promise<void> {
  await page.goto(`/examples/react/?scene=weather&windTime=10${query}`);
  await page.waitForFunction(() => (window as unknown as { reactExample?: Example }).reactExample?.status !== 'loading', null, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { reactExample: Example }).reactExample)).toMatchObject({ status: 'rendered' });
  await page.addStyleTag({ content: '#status { display: none; }' });
}

/**
 * Sets the React state and returns a screenshot of the canvas once it is drawn: two screenshots a few
 * frames apart are the same (a lazily loaded component, a new pipeline or a recompile can take frames).
 */
async function show(page: Page, change: (example: Example) => void | Promise<void>): Promise<Buffer> {
  await page.evaluate(`(${change.toString()})(window.reactExample)`);
  const shot = async () => {
    await page.evaluate(() => (window as unknown as { reactExample: Example }).reactExample.frames(4));
    return page.locator('canvas').screenshot();
  };
  let last = await shot();
  for (let i = 0; i < 20; i++) {
    const next = await shot();
    if (next.equals(last)) return next;
    last = next;
  }
  throw new Error('the picture did not settle');
}

type Diff = {
  /** Pixels that changed at all, in the left and the right half of the canvas. */
  left: number;
  right: number;
  /** How much lighter the changed pixels got, summed (r + g + b, 0..765 each). */
  lift: number;
  /** Changed pixels (by more than 8) that got whiter (lighter and less saturated), darker, or turned magenta. */
  whiter: number;
  darker: number;
  magenta: number;
  changed: number;
};

async function diff(page: Page, a: Buffer, b: Buffer): Promise<Diff> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      const r = { left: 0, right: 0, lift: 0, whiter: 0, darker: 0, magenta: 0, changed: 0 };
      for (let i = 0; i < da.data.length; i += 4) {
        const pa = [0, 1, 2].map((c) => da.data[i + c]!);
        const pb = [0, 1, 2].map((c) => db.data[i + c]!);
        const most = Math.max(...[0, 1, 2].map((c) => Math.abs(pa[c]! - pb[c]!)));
        if (most === 0) continue;
        if ((i / 4) % da.width < da.width / 2) r.left++;
        else r.right++;
        if (most <= 8) continue;
        r.changed++;
        const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
        const sum = (v: number[]) => v[0]! + v[1]! + v[2]!;
        if (Math.min(...pb) > Math.min(...pa) && spread(pb) <= spread(pa) + 4) r.whiter++;
        if (sum(pb) < sum(pa)) r.darker++;
        else r.lift += sum(pb) - sum(pa);
        if (pb[0]! > 200 && pb[1]! < 60 && pb[2]! > 200) r.magenta++;
      }
      return r;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

for (const backend of [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
]) {
  test(`React: <SnowCover>, <Wetness> and <Tree shaderHooks> set, change and remove the trees' look (${backend.name})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await load(page, backend.query);
    const plain = await show(page, () => {});

    const snowy = await diff(page, plain, await show(page, (x) => x.setWeather({ snow: 1 })));
    expect(snowy.whiter, 'Snow Cover whitens the trees').toBeGreaterThan(1000);
    expect(snowy.whiter).toBeGreaterThan(snowy.changed * 0.8);
    const lighter = await diff(page, plain, await show(page, (x) => x.setWeather({ snow: 0.3 })));
    expect(lighter.lift, 'a lower amount whitens less').toBeLessThan(snowy.lift * 0.6);

    const wet = await diff(page, plain, await show(page, (x) => x.setWeather({ wetness: 1 })));
    expect(wet.darker, 'Wetness darkens the trees').toBeGreaterThan(1000);
    expect(wet.darker).toBeGreaterThan(wet.changed * 0.8);

    const tint = await diff(page, plain, await show(page, (x) => x.setWeather({ tint: true })));
    expect(tint.right, 'the right tree takes its own hook').toBeGreaterThan(500);
    expect(tint.left, 'the left tree has none').toBe(0);

    // All removed: exactly the picture without any of it.
    expect(await diff(page, plain, await show(page, (x) => x.setWeather({})))).toMatchObject({ left: 0, right: 0 });
    expect(errors).toEqual([]);
  });

  test(`React: useWindBurst bends the trees near it, not those beyond its radius, and is over after its lifetime (${backend.name})`, async ({ page }) => {
    await load(page, backend.query);
    const before = await show(page, () => {});
    // Beside the left tree (at x -3, z 2); the right tree (at 3, -2) is 7 m beyond the 3.5 m radius.
    const during = await show(page, (x) => {
      x.burst({ x: -4.5, z: 3, strength: 1, radius: 3.5 });
      x.setWindTime(10.15);
    });
    const bent = await diff(page, before, during);
    expect(bent.left, 'the near tree bends').toBeGreaterThan(500);
    expect(bent.right, 'the far tree does not move').toBe(0);
    expect(await diff(page, before, await show(page, (x) => x.setWindTime(11.5)))).toMatchObject({ left: 0, right: 0 });
  });

  test(`React: a <TreeEffect> in <ScenePipeline> changes only foliage, live (${backend.name})`, async ({ page }) => {
    await load(page, backend.query);
    const off = await show(page, (x) => x.setWeather({ effect: 0 }));
    const on = await diff(page, off, await show(page, (x) => x.setWeather({ effect: 1 })));
    expect(on.magenta, 'leaf pixels turn magenta').toBeGreaterThan(1000);
    expect(on.magenta).toBeGreaterThan(on.changed * 0.9);
    expect(await diff(page, off, await show(page, (x) => x.setWeather({ effect: 0 })))).toMatchObject({ left: 0, right: 0 });
  });
}
