import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

// Reference screenshots for every built-in Style x Form, on both backends of WebGPURenderer.
const styles = ['low-poly', 'stylized', 'realistic', 'whimsical', 'enchanted', 'stylized-painterly'];
// The Enchanted Inner Glow pulses with the Wind clock: pin it so its screenshots are the same every run.
const pinned = (style: string) => (style === 'enchanted' ? '&windTime=0' : '');
const forms = ['broadleaf', 'conifer'];
const backends = [
  { name: 'webgpu', query: '' },
  { name: 'webgl2', query: '&backend=webgl' },
];

// Painterly (#112, #113): broadleaf and conifer on both backends, plus tycoon (about 55°) and top-down
// views. Its Growth and Season looks (#116) are with the other Styles' below.
const painterlyShots = [
  ...forms.flatMap((form) =>
    backends.map((backend) => ({ name: `painterly ${form} renders on ${backend.name}`, form, file: `painterly-${form}-${backend.name}.png`, query: backend.query, backend: backend.name })),
  ),
  { name: 'painterly broadleaf from a tycoon camera (about 55°)', form: 'broadleaf', file: 'painterly-broadleaf-tycoon.png', query: '&view=tycoon', backend: 'webgpu' },
  { name: 'painterly conifer from a tycoon camera (about 55°)', form: 'conifer', file: 'painterly-conifer-tycoon.png', query: '&view=tycoon', backend: 'webgpu' },
  { name: 'painterly broadleaf from straight above', form: 'broadleaf', file: 'painterly-broadleaf-top.png', query: '&view=top', backend: 'webgpu' },
  { name: 'painterly conifer from straight above', form: 'conifer', file: 'painterly-conifer-top.png', query: '&view=top', backend: 'webgpu' },
];
for (const shot of painterlyShots) {
  test(shot.name, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=painterly&form=${shot.form}&seed=1${shot.query}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: shot.backend });
    await expect(page.locator('canvas')).toHaveScreenshot(shot.file, { mask: [page.locator('#status')] });
  });
}

// From above (tycoon and top-down cameras) a Painterly crown must read as painted Leaf Masses, not a flat
// green disc (#122): the crown's pixels span a wide range of values, with real shadow and light in it.
const crownViews = forms.flatMap((form) => ['tycoon', 'top'].map((view) => ({ form, view })));
for (const { form, view } of crownViews) {
  test(`painterly ${form} reads as Leaf Masses from a ${view} camera`, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=painterly&form=${form}&seed=1&view=${view}`);
    expect(await waitForExample(page)).toMatchObject({ status: 'rendered', backend: 'webgpu' });
    await page.addStyleTag({ content: '#status { display: none; }' });
    const png = (await page.locator('canvas').screenshot()).toString('base64');
    const crown = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      // The ground is one flat colour: the most common one. Everything clearly different is tree.
      const key = (i: number) => (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      const counts = new Map<number, number>();
      for (let i = 0; i < data.length; i += 4) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
      const ground = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      const [gr, gg, gb] = [(ground >> 16) & 255, (ground >> 8) & 255, ground & 255];
      const values: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (Math.max(Math.abs(r - gr), Math.abs(g - gg), Math.abs(b - gb)) < 12) continue;
        if (b > g) continue; // sky
        values.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
      }
      values.sort((a, b) => a - b);
      const at = (q: number) => values[Math.floor(q * (values.length - 1))]!;
      return { pixels: values.length / (bitmap.width * bitmap.height), p10: at(0.1), p90: at(0.9) };
    }, png);
    expect(crown.pixels).toBeGreaterThan(0.05); // the crown fills a good part of the view
    expect(crown.p90 - crown.p10).toBeGreaterThan(0.2); // dark inside the masses, light on their sunlit tops
  });
}

for (const style of styles) {
  for (const form of forms) {
    for (const backend of backends) {
      test(`${style} ${form} renders on ${backend.name}`, async ({ page }) => {
        await page.goto(`/examples/vanilla/?style=${style}&form=${form}&seed=1${backend.query}${pinned(style)}`);
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
// Painterly (#116): the same states (the painted gradient follows Season: warm autumn tips, Leaf Masses
// turning from the outside in), more Growth, and blossom and Fruit (its broadleaf has neither: Species that do).
const painterlyStates = [
  ...forms.flatMap((form) => [...states, { name: 'growth-0-85', query: '&growth=0.85' }].map((state) => ({ form, ...state }))),
  { form: 'broadleaf', name: 'spring', query: '&season=0.04' },
  { form: 'broadleaf', name: 'cherry-blossom', query: '&species=cherry&season=0.06' },
  { form: 'broadleaf', name: 'apple-fruit', query: '&species=apple&season=0.5' },
];
// Whimsical (#140): its pastel spring colours too.
const whimsicalStates = [{ form: 'broadleaf', name: 'spring', query: '&season=0.04' }];
// Enchanted (#141): at night with no light at all, only the Inner Glow shows (leaves strongest at the crown's
// thin edge, the bark veins), in summer teal and autumn magenta; and at the low point of its pulse.
const enchantedStates = [
  ...forms.map((form) => ({ form, name: 'night', query: '&night=1' })),
  { form: 'broadleaf', name: 'night-autumn', query: '&night=1&season=0.66' },
  { form: 'broadleaf', name: 'night-pulse-low', query: '&night=1&windTime=1.75' },
];
// Stylized Painterly: Enchanted's snaking shapes in Painterly's paint, from a tycoon camera too, and a
// Species (Species colours, Enchanted Twist recipe).
const stylizedPainterlyStates = [
  ...forms.map((form) => ({ form, name: 'tycoon', query: '&view=tycoon' })),
  { form: 'broadleaf', name: 'oak', query: '&species=oak' },
];
const shots = [
  ...styles.flatMap((style) => forms.flatMap((form) => states.map((state) => ({ style, form, ...state })))),
  ...stylizedStates.map((state) => ({ style: 'stylized', ...state })),
  ...painterlyStates.map((state) => ({ style: 'painterly', ...state })),
  ...whimsicalStates.map((state) => ({ style: 'whimsical', ...state })),
  ...enchantedStates.map((state) => ({ style: 'enchanted', ...state })),
  ...stylizedPainterlyStates.map((state) => ({ style: 'stylized-painterly', ...state })),
];
for (const { style, form, name, query } of shots) {
  test(`${style} ${form}: ${name}`, async ({ page }) => {
    await page.goto(`/examples/vanilla/?style=${style}&form=${form}&seed=1${query}${query.includes('windTime') ? '' : pinned(style)}`);
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
