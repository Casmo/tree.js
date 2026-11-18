import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { requireBuild } from './static-site';

// The Species collection, `@casmo/tree.js/species`: from the built package (dist/, `npm run build`)
// as an app or a no-bundler page would use it, and rendered in the examples.
const root = resolve(import.meta.dirname, '..');
const ids = readdirSync(resolve(root, 'src/species/data')).map((f) => f.replace(/\.json$/, ''));

/** Runs an ES module snippet with Node from the package root, so `@casmo/tree.js/...` resolves through package.json exports. */
const runNode = (source: string) => execFileSync('node', ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8' });

test.describe('the built @casmo/tree.js/species package', () => {
  test.beforeAll(() => requireBuild(resolve(root, 'dist/species.js'), 'npm run build'));

  test("import { oak } from '@casmo/tree.js/species' grows with createTree(lowPoly.apply(oak), { seed: 42 })", () => {
    const out = runNode(`
      import { oak, SPECIES_NAMES, loadSpecies } from '@casmo/tree.js/species';
      import lowPoly from '@casmo/tree.js/styles/low-poly';
      import { createTree } from '@casmo/tree.js';
      const tree = createTree(lowPoly.apply(oak), { seed: 42 });
      const loaded = await Promise.all(SPECIES_NAMES.map((id) => loadSpecies(id)));
      console.log(JSON.stringify({
        species: tree.definition.species,
        branches: tree.data.skeleton.branches.length,
        names: SPECIES_NAMES,
        loaded: loaded.map((s) => s.id),
        unknown: await loadSpecies('baobab').then(() => 'resolved', (e) => e.message),
      }));
    `);
    const result = JSON.parse(out) as { species: string; branches: number; names: string[]; loaded: string[]; unknown: string };
    expect(result.species).toBe('oak');
    expect(result.branches).toBeGreaterThan(10);
    expect(result.names).toEqual(ids);
    expect(result.loaded).toEqual(ids);
    expect(result.unknown).toMatch(/Unknown tree\.js Species "baobab"/);
  });

  test('ships every Species as a plain JSON file, equal to its named export', () => {
    for (const id of ids) {
      const shipped = JSON.parse(readFileSync(resolve(root, `dist/species/${id}.json`), 'utf8'));
      expect(shipped).toEqual(JSON.parse(readFileSync(resolve(root, `src/species/data/${id}.json`), 'utf8')));
      const viaExport = runNode(`
        import data from '@casmo/tree.js/species/${id}.json' with { type: 'json' };
        import * as species from '@casmo/tree.js/species';
        const name = '${id}'.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        console.log(String(JSON.stringify(data) === JSON.stringify(species[name])));
      `);
      expect(viaExport.trim(), `${id}.json equals the named export`).toBe('true');
    }
  });

  test('an app importing one Species does not bundle the others', async () => {
    // A throwaway app with the package installed (symlinked), bundled by Vite like any app.
    const app = mkdtempSync(join(tmpdir(), 'tree-js-species-'));
    try {
      mkdirSync(join(app, 'node_modules/@casmo'), { recursive: true });
      symlinkSync(root, join(app, 'node_modules/@casmo/tree.js'), 'dir');
      for (const id of ids) {
        const name = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        writeFileSync(join(app, 'main.js'), `import { ${name} } from '@casmo/tree.js/species';\nconsole.log(${name});\n`);
        const output = await build({
          root: app,
          logLevel: 'silent',
          configFile: false,
          build: { write: false, minify: false, lib: { entry: join(app, 'main.js'), formats: ['es'], fileName: 'app' } },
        });
        const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => ('output' in o ? o.output : []));
        const code = chunks.map((c) => ('code' in c ? c.code : '')).join('\n');
        expect(chunks.filter((c) => c.type === 'chunk'), `${id}: one chunk, nothing lazily loaded`).toHaveLength(1);
        expect(code).toContain(`"${id}"`);
        for (const other of ids.filter((o) => o !== id)) expect(code, `${id} bundle includes ${other}`).not.toMatch(new RegExp(`id = "${other}"`));
        expect(code).not.toContain('loadSpecies');
      }
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

/** Waits for one of the examples' status hooks to leave 'loading'. */
async function rendered(page: Page, hook: string) {
  await page.waitForFunction((key) => (window as unknown as Record<string, { status?: string }>)[key]?.status !== 'loading', hook, {
    timeout: 30_000,
  });
  return page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], hook);
}

test('React Three Fiber: <Tree species={oak} style={lowPoly} seed={7} /> renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/examples/react/?scene=species');
  expect(await rendered(page, 'reactExample')).toMatchObject({ status: 'rendered' });
  expect(errors).toEqual([]);
  await expect(page.locator('canvas')).toHaveScreenshot('react-species-oak.png', { mask: [page.locator('#status')] });
});

for (const style of ['low-poly', 'stylized', 'realistic']) {
  test(`vanilla: the Oak Species in the ${style} Style (loadSpecies + style.apply)`, async ({ page }) => {
    await page.goto(`/examples/vanilla/?species=oak&style=${style}&seed=1`);
    expect(await rendered(page, 'treeExample')).toMatchObject({ status: 'rendered' });
    await expect(page.locator('#status')).toContainText('Oak');
    await expect(page.locator('canvas')).toHaveScreenshot(`species-oak-${style}.png`, { mask: [page.locator('#status')] });
  });
}
