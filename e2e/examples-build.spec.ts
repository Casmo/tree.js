import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { requireBuild, serveStatic } from './static-site';

// The production build of the bundled examples (`npm run build:examples` -> examples/dist) runs as a
// static site: same page hooks as the dev-server specs, served without Vite.
const dist = resolve(import.meta.dirname, '../examples/dist');
const SITE = 'https://example.test/';

const pages = [
  { name: 'vanilla three.js', path: 'vanilla/', hook: 'treeExample' },
  { name: 'React Three Fiber', path: 'react/', hook: 'reactExample' },
  { name: 'Forest', path: 'forest/', hook: 'forestExample' },
  { name: 'Tree Effects', path: 'effects/?style=stylized&effects=style', hook: 'effectsExample' },
  { name: 'Species picker', path: 'species/?species=birch&style=realistic', hook: 'speciesExample' },
  { name: 'vanilla three.js with the realistic Style (textures)', path: 'vanilla/?style=realistic', hook: 'treeExample' },
];

for (const { name, path, hook } of pages) {
  test(`the built ${name} example runs`, async ({ page }) => {
    requireBuild(resolve(dist, 'vanilla/index.html'), 'npm run build:examples');
    const requested = await serveStatic(page, { [SITE]: dist });
    await page.goto(SITE + path);
    await page.waitForFunction((key) => (window as unknown as Record<string, { status?: string }>)[key]?.status !== 'loading', hook, {
      timeout: 30_000,
    });
    const result = await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], hook);
    expect(result).toMatchObject({ status: 'rendered' });
    expect(requested.filter((url) => !url.startsWith(SITE) && !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
  });
}
