import { expect, test, type Page } from '@playwright/test';

type ReactExample = { status: string; backend?: string; error?: string; setGrowth?: (g: number) => void };
const example = (page: Page) => page.evaluate(() => (window as unknown as { reactExample: ReactExample }).reactExample);

async function waitForExample(page: Page) {
  await page.waitForFunction(() => (window as unknown as { reactExample?: ReactExample }).reactExample?.status !== 'loading', null, {
    timeout: 30_000,
  });
  return example(page);
}

const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

for (const backend of backends) {
  test(`React Three Fiber: <Tree> with useTreeStyle renders on ${backend.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/examples/react/?season=0.37${backend.query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: backend.name });
    expect(errors).toEqual([]);
    await expect(page.locator('canvas')).toHaveScreenshot(`react-low-poly-${backend.name}.png`, { mask: [page.locator('#status')] });
  });
}

test('React Three Fiber: a growth prop grows young trees', async ({ page }) => {
  await page.goto('/examples/react/?growth=0.4');
  expect(await waitForExample(page)).toMatchObject({ status: 'rendered' });
  await expect(page.locator('canvas')).toHaveScreenshot('react-growth-0.4.png', { mask: [page.locator('#status')] });
});

test('React Three Fiber: <ScenePipeline style="stylized"> renders the stylized suggestion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/examples/react/?scene=pipeline&season=0.37');
  expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
  // The hook gave the built pipeline to a child: the stylized Scene Effects (no god rays for stylized).
  const { sceneEffects } = (await example(page)) as ReactExample & { sceneEffects?: string[] };
  expect([...(sceneEffects ?? [])].sort()).toEqual(['antialias', 'ao', 'bloom', 'fog', 'toneMapping']);
  expect(errors).toEqual([]);
  await expect(page.locator('canvas')).toHaveScreenshot('react-scene-pipeline-stylized-webgpu.png', {
    mask: [page.locator('#status')],
    // The pipeline (GTAO, bloom, SMAA) is slow on SwiftShader: give the frames time to settle.
    timeout: 20_000,
  });
});
