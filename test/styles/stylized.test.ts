import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createTree,
  evaluateSeason,
  extendDefinition,
  hashTreeData,
  leafSeason,
  partSeasonAt,
  parseDefinition,
  type TreeDefinition,
} from '../../src/index';
import { generateTree } from '../../src/generator';

const stylized = await import('../../src/styles/stylized');
const forms = { broadleaf: stylized.broadleaf, conifer: stylized.conifer };

/** Share of a tree's leaves (Seed 42) shown as blossom at Season s, via the CPU twin of the leaf shader. */
function blossomShare(definition: TreeDefinition, season: number): number {
  const { attributes } = generateTree(parseDefinition(definition), 42).leaves;
  const aSeason = attributes.aSeason!.array;
  const vertices = aSeason.length / 3;
  let blossoms = 0;
  for (let v = 0; v < vertices; v++) {
    if (leafSeason(definition.season, season, partSeasonAt(aSeason, v)).blossom) blossoms++;
  }
  return blossoms / vertices;
}

describe('stylized Style (dynamic import of the /styles/stylized subpath)', () => {
  it('exports a broadleaf and a conifer Definition, also as one Style object', () => {
    expect(stylized.broadleaf.name).toMatch(/broadleaf/);
    expect(stylized.conifer.name).toMatch(/conifer/);
    expect(stylized.default).toMatchObject({ name: 'stylized', broadleaf: stylized.broadleaf, conifer: stylized.conifer });
    expect(stylized.default.apply).toBeTypeOf('function');
  });

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition (parsing changes nothing)`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
    });

    it(`${form}: needs no image files and uses toon shading`, () => {
      const { bark, leaf, shading } = definition.materials;
      expect([bark.map, bark.normalMap, leaf.map]).toEqual([null, null, null]);
      expect(shading).toBe('toon');
    });

    it(`${form}: grows a tree with branches and rounded leaf clumps (puffs), lit by the soft toon model`, () => {
      const tree = createTree(definition, { seed: 1 });
      expect(tree.data.skeleton.branches.length).toBeGreaterThan(5);
      expect(tree.data.skeleton.leaves.length).toBeGreaterThan(10);
      expect(definition.leaves.shape).toBe('puff');
      for (const material of [tree.wood.material, tree.leaves.material]) {
        expect(material).toMatchObject({ isSoftToonMaterial: true, flatShading: false });
      }
      tree.dispose();
    });

    it(`${form}: matches the golden geometry hash (determinism across releases)`, () => {
      expect(hashTreeData(generateTree(parseDefinition(definition), 42))).toMatchSnapshot();
    });
  }

  it('the broadleaf blossoms in early spring and not in summer, autumn or winter', () => {
    expect(blossomShare(stylized.broadleaf, 0.03)).toBeGreaterThan(0.4);
    for (const season of [0.3, 0.55, 0.85]) expect(blossomShare(stylized.broadleaf, season)).toBe(0);
  });

  it('the broadleaf is deciduous: bare in winter, full in summer', () => {
    expect(evaluateSeason(stylized.broadleaf.season, 0.85).leafCoverage).toBe(0);
    expect(evaluateSeason(stylized.broadleaf.season, 0.3).leafCoverage).toBe(1);
  });

  it('the conifer is evergreen: always fully covered, only darkening a little in winter', () => {
    expect(stylized.conifer.season.leafCoverage.every((k) => k.value === 1)).toBe(true);
    expect(stylized.conifer.season.leafColor.length).toBeGreaterThan(1);
  });

  it('blossom is an option: a tweaked broadleaf without it never flowers', () => {
    const plain = extendDefinition(stylized.broadleaf, { season: { blossom: [{ t: 0, value: 0 }] } });
    expect(blossomShare(plain, 0.03)).toBe(0);
  });

  it('is published as its own subpath, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/stylized']).toEqual({
      types: './dist/styles/stylized/index.d.ts',
      import: './dist/styles/stylized.js',
    });
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toMatch(/'styles\/stylized': resolve\(.*src\/styles\/stylized\/index\.ts'\)/);
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/stylized/);
  });
});
