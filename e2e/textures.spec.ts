import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function waitForExample(page: Page) {
  await page.waitForFunction(() => window.treeExample?.status !== 'loading', null, { timeout: 30_000 });
  return page.evaluate(() => window.treeExample);
}

const packageTexture = (name: string) => readFileSync(new URL(`../assets/textures/realistic/${name}`, import.meta.url));

test('the realistic Style loads its textures from an app-provided base path (own CDN)', async ({ page }) => {
  const cdn: string[] = [];
  const packageRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/textures/')) packageRequests.push(r.url());
  });
  await page.route('https://cdn.example.test/trees/**', (route) => {
    const url = route.request().url();
    cdn.push(url);
    return route.fulfill({ contentType: 'image/png', body: packageTexture(url.split('/').pop()!) });
  });

  await page.goto('/examples/vanilla/?style=realistic&form=broadleaf&seed=1&textureBase=https://cdn.example.test/trees/');
  expect(await waitForExample(page)).toMatchObject({ status: 'rendered' });
  expect(cdn.sort()).toEqual([
    'https://cdn.example.test/trees/realistic/bark-normal.png',
    'https://cdn.example.test/trees/realistic/bark.png',
    'https://cdn.example.test/trees/realistic/leaf.png',
  ]);
  expect(packageRequests).toEqual([]);
});

// 8x8 blue/yellow checkerboard PNG (2-pixel squares), so the custom bark is unmistakable in the screenshot.
const CHECKER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAI0lEQVR4nGP4dUnj1yUNjYBnGgHPkNkMOCUwhSBs3BJ0sAMAhq9qQYMfe0cAAAAASUVORK5CYII=',
  'base64',
);

test('a Definition with custom textures renders them', async ({ page }) => {
  await page.route('https://textures.example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: CHECKER }));
  await page.goto(
    '/examples/vanilla/?style=realistic&form=broadleaf&seed=1&season=0.3&barkMap=https://textures.example.test/checker.png',
  );
  expect(await waitForExample(page)).toMatchObject({ status: 'rendered' });
  await expect(page.locator('canvas')).toHaveScreenshot('custom-bark-texture.png', { mask: [page.locator('#status')] });
});
