import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

// Reference screenshots for every built-in Style x Form, on both backends of WebGPURenderer.
const styles = ['low-poly', 'stylized'];
const forms = ['broadleaf', 'conifer'];
const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

for (const style of styles) {
  for (const form of forms) {
    for (const backend of backends) {
      test(`${style} ${form} renders on ${backend.name}`, async ({ page }) => {
        await page.goto(`/examples/vanilla/?style=${style}&form=${form}&seed=1${backend.query}`);
        expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: backend.name });
        await expect(page.locator('canvas')).toHaveScreenshot(`${style}-${form}-${backend.name}.png`, {
          mask: [page.locator('#status')],
        });
      });
    }
  }
}

// The stylized Style through the year: pink blossom in early spring, summer, autumn colours, bare
// broadleaf / evergreen conifer in winter (Season is a uniform; the geometry is the same).
const stylizedSeasons = [
  { form: 'broadleaf', name: 'blossom', season: 0.04 },
  { form: 'broadleaf', name: 'autumn', season: 0.62 },
  { form: 'broadleaf', name: 'winter', season: 0.85 },
  { form: 'conifer', name: 'winter', season: 0.85 },
];
for (const { form, name, season } of stylizedSeasons) {
  test(`stylized ${form} in ${name} (Season ${season})`, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=stylized&form=${form}&seed=1&season=${season}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    await expect(page.locator('canvas')).toHaveScreenshot(`stylized-${form}-${name}.png`, {
      mask: [page.locator('#status')],
    });
  });
}

test('a Style is fetched only when the app imports it', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/examples/vanilla/?seed=1');
  expect((await waitForExample(page)).status).toBe('rendered');
  expect(requested.some((url) => url.includes('/styles/low-poly'))).toBe(false);

  await page.goto('/examples/vanilla/?style=low-poly&form=conifer&seed=1');
  expect((await waitForExample(page)).status).toBe('rendered');
  expect(requested.some((url) => url.includes('/styles/low-poly'))).toBe(true);
});
