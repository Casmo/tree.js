import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('/react packaging', () => {
  it('is published as the @casmo/tree.js/react subpath', () => {
    expect(pkg.exports['./react']).toEqual({ types: './dist/react/index.d.ts', import: './dist/react.js' });
  });

  it('declares react and @react-three/fiber as optional peer dependencies', () => {
    for (const name of ['react', '@react-three/fiber']) {
      expect(pkg.peerDependencies[name]).toBeTruthy();
      expect(pkg.peerDependenciesMeta?.[name]).toEqual({ optional: true });
      expect(pkg.dependencies?.[name]).toBeUndefined();
    }
  });

  it('is not pulled in by the core entry, so vanilla users never load react', () => {
    expect(read('src/index.ts')).not.toMatch(/['"]\.\/react|from 'react'|@react-three/);
  });
});

describe('Style registry', () => {
  it('loads a built-in Style by name and rejects unknown names', async () => {
    const { loadStyle, STYLE_NAMES } = await import('../../src/index');
    expect(STYLE_NAMES).toContain('low-poly');
    expect((await loadStyle('low-poly')).name).toBe('low-poly');
    await expect(loadStyle('nope' as never)).rejects.toThrow(/Unknown tree\.js Style "nope"/);
  });

  it('knows every Style shipped as a /styles/<name> subpath', async () => {
    const { STYLE_NAMES } = await import('../../src/index');
    const subpaths = Object.keys(pkg.exports).filter((k) => k.startsWith('./styles/')).map((k) => k.slice('./styles/'.length));
    expect([...STYLE_NAMES].sort()).toEqual(subpaths.sort());
  });
});
