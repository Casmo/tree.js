import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

// Reference screenshots for every built-in Style x Form, on both backends of WebGPURenderer.
const styles = ['low-poly', 'stylized', 'realistic'];
const forms = ['broadleaf', 'conifer'];
const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

// Painterly (#112, #113): broadleaf and conifer on both backends, plus tycoon (about 55°) and top-down
// views; its Growth and Season looks are their own tickets.
const painterlyShots = [
  ...forms.flatMap((form) =>
    backends.map((backend) => ({ name: `painterly ${form} renders on ${backend.name}`, form, file: `painterly-${form}-${backend.name}.png`, query: backend.query, backend: backend.name })),
  ),
  { name: 'painterly broadleaf from a tycoon camera (about 55°)', form: 'broadleaf', file: 'painterly-broadleaf-tycoon.png', query: '&view=tycoon', backend: 'webgpu' },
  { name: 'painterly conifer from a tycoon camera (about 55°)', form: 'conifer', file: 'painterly-conifer-tycoon.png', query: '&view=tycoon', backend: 'webgpu' },
  { name: 'painterly conifer from straight above', form: 'conifer', file: 'painterly-conifer-top.png', query: '&view=top', backend: 'webgpu' },
];
for (const shot of painterlyShots) {
  test(shot.name, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=painterly&form=${shot.form}&seed=1${shot.query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: shot.backend });
    await expect(page.locator('canvas')).toHaveScreenshot(shot.file, { mask: [page.locator('#status')] });
  });
}

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

// Every Style x Form through the year (autumn colours; bare broadleaf / evergreen conifer in winter)
// and while growing (Growth and Season are uniforms; the geometry is the same). WebGPU backend.
const states = [
  { name: 'growth-0-7', query: '&growth=0.7' },
  { name: 'autumn', query: '&season=0.62' },
  { name: 'winter', query: '&season=0.85' },
];
// Plus the stylized broadleaf's pink blossom in early spring, also while still growing.
const stylizedStates = [
  { form: 'broadleaf', name: 'blossom', query: '&season=0.04' },
  { form: 'broadleaf', name: 'growth-0-85-blossom', query: '&growth=0.85&season=0.04' },
];
const shots = [
  ...styles.flatMap((style) => forms.flatMap((form) => states.map((state) => ({ style, form, ...state })))),
  ...stylizedStates.map((state) => ({ style: 'stylized', ...state })),
];
for (const { style, form, name, query } of shots) {
  test(`${style} ${form}: ${name}`, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=${style}&form=${form}&seed=1${query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    await expect(page.locator('canvas')).toHaveScreenshot(`${style}-${form}-${name}.png`, {
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
