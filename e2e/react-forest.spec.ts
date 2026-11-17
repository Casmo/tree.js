import { expect, test, type Page } from '@playwright/test';
import type { Forest } from '../src/index';

type ReactExample = {
  status: string;
  backend?: string;
  error?: string;
  forest?: Forest;
  cutTree?: (id: string) => void;
  plantTree?: (p: { id: string; position: [number, number, number]; scale?: number }) => void;
};
type W = { reactExample?: ReactExample };

async function waitForExample(page: Page) {
  await page.waitForFunction(() => (window as unknown as W).reactExample?.status !== 'loading', null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as W).reactExample?.forest !== undefined);
  return page.evaluate(() => {
    const { status, backend, error } = (window as unknown as W).reactExample!;
    return { status, backend, error };
  });
}

const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

for (const backend of backends) {
  test(`React Three Fiber: <Forest> renders on ${backend.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/examples/react/?scene=forest&season=0.37${backend.query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: backend.name });
    expect(await page.evaluate(() => (window as unknown as W).reactExample!.forest!.size)).toBe(49);
    expect(errors).toEqual([]);
    await expect(page.locator('canvas')).toHaveScreenshot(`react-forest-${backend.name}.png`, { mask: [page.locator('#status')] });
  });
}

test('React Three Fiber: changing <Forest> placements plants and cuts only those trees', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/examples/react/?scene=forest&season=0.37');
  expect(await waitForExample(page)).toMatchObject({ status: 'rendered' });

  const result = await page.evaluate(async () => {
    const example = (window as unknown as W).reactExample!;
    const forest = example.forest!;
    const keep = forest.get('0-0')!;
    const before = forest.instanceState(keep);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    example.cutTree!('3-3');
    example.cutTree!('6-6');
    example.plantTree!({ id: 'new', position: [0, 0, 6], scale: 0.2 });
    await frame();
    return {
      sameForest: example.forest === forest,
      size: forest.size,
      cut: [forest.get('3-3'), forest.get('6-6')].every((t) => t === undefined),
      planted: forest.get('new') !== undefined,
      keptSameTree: forest.get('0-0') === keep,
      keptState: JSON.stringify(forest.instanceState(keep)) === JSON.stringify(before),
    };
  });
  expect(result).toEqual({ sameForest: true, size: 48, cut: true, planted: true, keptSameTree: true, keptState: true });
  expect(errors).toEqual([]);
});
