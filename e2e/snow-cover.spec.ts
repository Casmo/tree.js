import { expect, test, type Page } from '@playwright/test';
import type { SnowExampleOptions } from '../examples/snow';

// Snow Cover (#100, ADR 0012): the ready-made Tree Shader Hook from `@casmo/tree.js/weather` whitens the
// pixels of surfaces that face up and leaves undersides bare, on a near Tree (examples/vanilla) and on far
// Impostors (examples/forest with `lod=40,60`), on WebGPU and WebGPURenderer's WebGL2 fallback (ADR 0002;
// there the forest draws every tree in full). Which pixels face up or down is read from a test hook that
// paints them by the same world normal (examples/snow.ts). With the amount at 0, a part's strength at 0 or
// the hook removed, the picture is today's.

test.describe.configure({ timeout: 180_000 });

type Shots = { plain: Buffer; facing: Buffer; snow: Buffer };
type Region = { up: number; down: number; upChanged: number; downChanged: number; whiter: number };

/**
 * Per region (rows from `from` to `to`, 0..1 from the top): how many pixels face up (magenta in `facing`)
 * and down (cyan, inside a patch), how many of those changed from `plain` to `snow` (any channel by more than 8), and how
 * many of the changed up pixels got lighter and less saturated (whiter).
 */
async function regions(page: Page, shots: Shots, bands: [number, number][]): Promise<Region[]> {
  return page.evaluate(
    async ([plain, facing, snow, bands]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return { data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
      };
      const [p, f, s] = await Promise.all([decode(plain), decode(facing), decode(snow)]);
      const isUp = (j: number) => f.data[j * 4]! > f.data[j * 4 + 1]! + 60 && f.data[j * 4 + 2]! > f.data[j * 4 + 1]! + 60;
      const isDown = (j: number) => f.data[j * 4 + 1]! > f.data[j * 4]! + 60 && f.data[j * 4 + 2]! > f.data[j * 4]! + 60;
      return bands.map(([from, to]) => {
        const r: Region = { up: 0, down: 0, upChanged: 0, downChanged: 0, whiter: 0 };
        for (let i = 0; i < p.data.length / 4; i++) {
          const row = Math.floor(i / p.width) / p.height;
          if (row < from || row >= to) continue;
          // Down: only inside a patch (the 4 neighbours face down too), as an edge blends with the snow next to it.
          const up = isUp(i);
          const down = !up && [0, 1, -1, p.width, -p.width].every((d) => isDown(i + d));
          if (!up && !down) continue;
          const changed = [0, 1, 2].some((c) => Math.abs(p.data[i * 4 + c]! - s.data[i * 4 + c]!) > 8);
          if (up) {
            r.up++;
            if (changed) {
              r.upChanged++;
              const px = [0, 1, 2].map((c) => p.data[i * 4 + c]!);
              const sx = [0, 1, 2].map((c) => s.data[i * 4 + c]!);
              const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
              if (Math.min(...sx) > Math.min(...px) && spread(sx) <= spread(px) + 4) r.whiter++;
            }
          } else {
            r.down++;
            if (changed) r.downChanged++;
          }
        }
        return r;
      });
    },
    [shots.plain.toString('base64'), shots.facing.toString('base64'), shots.snow.toString('base64'), bands] as const,
  );
}

/** How many pixels differ (any channel by more than 8). */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([pa, pb]) => {
      const decode = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db] = await Promise.all([decode(pa), decode(pb)]);
      let n = 0;
      for (let i = 0; i < da.length / 4; i++) if ([0, 1, 2].some((c) => Math.abs(da[i * 4 + c]! - db[i * 4 + c]!) > 8)) n++;
      return n;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

type Example = 'treeExample' | 'forestExample';

async function open(page: Page, url: string, key: Example, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction((k) => (window as unknown as Record<string, { status?: string }>)[k]?.status !== 'loading', key, { timeout: 90_000 });
  await page.addStyleTag({ content: '#status { display: none; }' });
}

async function snowShot(page: Page, key: Example, options: SnowExampleOptions): Promise<Buffer> {
  await page.evaluate(([k, o]) => window[k].setSnow!(o), [key, options] as const);
  await page.waitForFunction((k) => (window as unknown as Record<string, { status?: string }>)[k]?.status !== 'loading', key);
  return page.locator('canvas').screenshot();
}

/** Snow lands on most of what faces up, whitening it, and on almost none of what faces down. */
function expectSnowOnTop(region: Region, least: { up: number; down: number }) {
  expect(region.up).toBeGreaterThan(least.up);
  expect(region.down).toBeGreaterThan(least.down);
  expect(region.upChanged).toBeGreaterThan(region.up * 0.6);
  expect(region.whiter).toBeGreaterThan(region.upChanged * 0.8);
  expect(region.downChanged).toBeLessThan(region.down * 0.05);
}

for (const backend of ['webgpu', 'webgl'] as const) {
  const webgl = backend === 'webgl' ? '&backend=webgl' : '';

  for (const style of ['low-poly', 'stylized', 'realistic', 'painterly', 'whimsical', 'enchanted', 'stylized-painterly'] as const) {
    test(`Snow Cover whitens what faces up on a near ${style} Tree, not the undersides (${backend})`, async ({ page }) => {
      const errors: string[] = [];
      // Enchanted: the Inner Glow pulses with the Wind clock, pinned so the shots compare.
      const pinned = style === 'enchanted' ? '&windTime=0' : '';
      await open(page, `/examples/vanilla/?style=${style}&seed=1${pinned}${webgl}`, 'treeExample', errors);
      expect(await page.evaluate(() => window.treeExample)).toMatchObject({ status: 'rendered', backend: backend === 'webgl' ? 'webgl2' : 'webgpu' });
      const plain = await page.locator('canvas').screenshot();

      // Set, but no snow yet: today's picture.
      expect(await changedPixels(page, plain, await snowShot(page, 'treeExample', { hook: 'snow', amount: 0 }))).toBe(0);
      const snow = await snowShot(page, 'treeExample', { amount: 1 });
      const facing = await snowShot(page, 'treeExample', { hook: 'facing' });
      const [tree] = await regions(page, { plain, facing, snow }, [[0, 1]]);
      expectSnowOnTop(tree!, { up: 300, down: 100 });

      // Settings are live: no snow taken by any part is today's picture again.
      await snowShot(page, 'treeExample', { hook: 'snow' });
      const none = { bark: 0, leaves: 0, fruit: 0 };
      expect(await changedPixels(page, plain, await snowShot(page, 'treeExample', { settings: { strength: none } }))).toBe(0);
      const steep = await snowShot(page, 'treeExample', { settings: { strength: { bark: 1, leaves: 1, fruit: 1 }, slope: 85 } });
      expect(await changedPixels(page, snow, steep)).toBeGreaterThan(200); // steeper surfaces hold snow too
      await snowShot(page, 'treeExample', { settings: { slope: 60 } });
      expect(await changedPixels(page, plain, await snowShot(page, 'treeExample', { hook: 'none' }))).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test(`Snow Cover lies on bare winter branches (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    await open(page, `/examples/vanilla/?style=stylized&seed=1&season=0.85${webgl}`, 'treeExample', errors);
    const plain = await page.locator('canvas').screenshot();
    const snow = await snowShot(page, 'treeExample', { hook: 'snow', amount: 1 });
    const facing = await snowShot(page, 'treeExample', { hook: 'facing' });
    const [branches] = await regions(page, { plain, facing, snow }, [[0, 1]]);
    expectSnowOnTop(branches!, { up: 100, down: 20 });
    expect(errors).toEqual([]);
  });

  test(`Snow Cover whitens what faces up on near trees and far ${backend === 'webgpu' ? 'Impostors' : 'trees'}, not the undersides (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    await open(page, `/examples/forest/?trees=400&lod=40,60${webgl}`, 'forestExample', errors);
    const result = await page.evaluate(() => window.forestExample);
    expect(result).toMatchObject({ status: 'rendered', backend: backend === 'webgl' ? 'webgl2' : 'webgpu' });
    if (backend === 'webgpu') expect(result.levels!.impostor).toBeGreaterThan(50);
    const plain = await page.locator('canvas').screenshot();

    expect(await changedPixels(page, plain, await snowShot(page, 'forestExample', { hook: 'snow', amount: 0 }))).toBe(0);
    const snow = await snowShot(page, 'forestExample', { amount: 1 });
    const facing = await snowShot(page, 'forestExample', { hook: 'facing' });
    // The top rows are the far trees (Impostors on WebGPU), the bottom rows the near ones.
    const [far, near] = await regions(page, { plain, facing, snow }, [[0, 0.42], [0.65, 1]]);
    expectSnowOnTop(far!, { up: 300, down: 10 }); // seen from above: few undersides far off
    expectSnowOnTop(near!, { up: 300, down: 50 });
    expect(await changedPixels(page, plain, await snowShot(page, 'forestExample', { hook: 'none' }))).toBe(0);
    expect(errors).toEqual([]);
  });
}

// The Fantasy Styles' own snow (#142): sugar frosting on Whimsical (a crisp cap running down in drips, with
// sparkles), faintly glowing frost on Enchanted (pale rime; frosted leaves glow faintly, also at night).
// Enchanted shots pin the Wind clock (`windTime=0`): the Inner Glow pulses with it.
const fantasy = [
  ['whimsical', 'broadleaf', ''],
  ['whimsical', 'conifer', ''],
  ['enchanted', 'broadleaf', '&windTime=0'],
  ['enchanted', 'conifer', '&windTime=0'],
  ['enchanted', 'broadleaf', '&windTime=0&night=1'],
] as const;
for (const [style, form, extra] of fantasy) {
  const night = extra.includes('night') ? '-night' : '';
  test(`Snow Cover on a ${style} ${form}${night ? ' at night' : ''} (screenshot)`, async ({ page }) => {
    const errors: string[] = [];
    await open(page, `/examples/vanilla/?style=${style}&form=${form}&seed=1&snow=1${extra}`, 'treeExample', errors);
    await expect(page.locator('canvas')).toHaveScreenshot(`snow-cover-${style}-${form}${night}.png`);
    expect(errors).toEqual([]);
  });
}
