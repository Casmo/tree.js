import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTree, extendDefinition, hashTreeData, parseDefinition, type TreeDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';

const lowPoly = await import('../../src/styles/low-poly');
const forms = { broadleaf: lowPoly.broadleaf, conifer: lowPoly.conifer };

/** Value of a keyframe track at Season s (step lookup is enough for "is it ever 0"). */
const coverageValues = (d: TreeDefinition) => d.season.leafCoverage.map((k) => k.value);

describe('low-poly Style (dynamic import of the /styles/low-poly subpath)', () => {
  it('exports a broadleaf and a conifer Definition, also as one Style object', () => {
    expect(lowPoly.broadleaf.name).toMatch(/broadleaf/);
    expect(lowPoly.conifer.name).toMatch(/conifer/);
    expect(lowPoly.default).toEqual({ name: 'low-poly', broadleaf: lowPoly.broadleaf, conifer: lowPoly.conifer });
  });

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition (parsing changes nothing)`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
    });

    it(`${form}: needs no textures and uses flat (faceted) shading`, () => {
      const { bark, leaf, shading } = definition.materials;
      expect([bark.map, bark.normalMap, leaf.map]).toEqual([null, null, null]);
      expect(shading).toBe('flat');
    });

    it(`${form}: grows a tree with branches and solid low-poly foliage`, () => {
      const tree = createTree(definition, { seed: 1 });
      expect(tree.data.skeleton.branches.length).toBeGreaterThan(5);
      expect(tree.data.skeleton.leaves.length).toBeGreaterThan(10);
      expect(definition.leaves.shape).not.toBe('card');
      expect((tree.wood.material as { flatShading?: boolean }).flatShading).toBe(true);
      tree.dispose();
    });

    it(`${form}: matches the golden geometry hash (determinism across releases)`, () => {
      expect(hashTreeData(generateTree(parseDefinition(definition), 42))).toMatchSnapshot();
    });
  }

  it('the broadleaf is deciduous: bare at some point in the Season', () => {
    expect(Math.min(...coverageValues(lowPoly.broadleaf))).toBe(0);
  });

  it('the conifer is evergreen: always fully covered, only darkening a little in winter', () => {
    expect(coverageValues(lowPoly.conifer).every((v) => v === 1)).toBe(true);
    expect(lowPoly.conifer.season.leafColor.length).toBeGreaterThan(1);
  });

  it('can be the starting point for a tweaked Definition in code', () => {
    const tweaked = extendDefinition(lowPoly.broadleaf, { leaves: { count: 5 } });
    expect(tweaked.leaves.count).toBe(5);
    expect(tweaked.leaves.shape).toBe(lowPoly.broadleaf.leaves.shape);
    expect(lowPoly.broadleaf.leaves.count).not.toBe(5);
  });

  it('is published as its own subpath, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/low-poly']).toEqual({
      types: './dist/styles/low-poly/index.d.ts',
      import: './dist/styles/low-poly.js',
    });
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/low-poly/);
  });
});
