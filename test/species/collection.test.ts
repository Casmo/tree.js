// The Species collection (`@casmo/tree.js/species`): runs over every Species in SPECIES_NAMES, so a new
// Species is covered by adding its JSON file (and regenerating the catalog), nothing here.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { hashTreeData, parseDefinition, type SpeciesDefinition, type TreeData } from '../../src/index';
import { generateTree } from '../../src/generator';
import * as collection from '../../src/species';
import lowPoly from '../../src/styles/low-poly';
import stylized from '../../src/styles/stylized';
import realistic from '../../src/styles/realistic';

const { SPECIES_NAMES, loadSpecies } = collection;
const styles = { 'low-poly': lowPoly, stylized, realistic };
const camelCase = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const dataDir = new URL('../../src/species/data/', import.meta.url);
const json = (id: string) => JSON.parse(readFileSync(new URL(`${id}.json`, dataDir), 'utf8')) as SpeciesDefinition;
const triangles = (tree: TreeData) => (tree.wood.indices.length + tree.leaves.indices.length + tree.fruit.indices.length) / 3;
const SEEDS = [1, 7, 42];

describe('the Species collection', () => {
  it('lists Oak, with kebab-case ids in alphabetical order', () => {
    expect(SPECIES_NAMES).toContain('oak');
    for (const id of SPECIES_NAMES) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect([...SPECIES_NAMES]).toEqual([...SPECIES_NAMES].sort());
  });

  it('has exactly one Species per JSON file in src/species/data (generated catalog up to date)', () => {
    const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    expect([...SPECIES_NAMES]).toEqual(files.sort());
    expect(() => execFileSync('node', ['scripts/generate-species.mjs', '--check'], { cwd: new URL('../..', import.meta.url), stdio: 'pipe' })).not.toThrow();
  });

  for (const id of SPECIES_NAMES) {
    it(`${id}: is the camelCase named export, equal to its JSON file`, () => {
      const species = (collection as unknown as Record<string, SpeciesDefinition>)[camelCase(id)];
      expect(species?.id).toBe(id);
      expect(json(id)).toEqual(species);
    });

    it(`${id}: loadSpecies('${id}') resolves to the named export`, async () => {
      expect(await loadSpecies(id)).toEqual(json(id));
    });
  }

  it('loadSpecies rejects an unknown id, listing the known ones', async () => {
    await expect(loadSpecies('baobab' as never)).rejects.toThrow(/Unknown tree\.js Species "baobab".*oak/);
    await expect(loadSpecies('Oak' as never)).rejects.toThrow(/Unknown/);
  });
});

/** Per Style: triangles of its own generic broadleaf / conifer (the larger), at the test Seeds. */
const styleTriangles = Object.fromEntries(
  Object.entries(styles).map(([name, style]) => [
    name,
    Math.max(...[style.broadleaf, style.conifer].flatMap((d) => SEEDS.map((seed) => triangles(generateTree(parseDefinition(d), seed))))),
  ]),
);

describe.each(SPECIES_NAMES)('Species %s in every Style', (id) => {
  for (const [name, style] of Object.entries(styles)) {
    describe(name, async () => {
      const definition = style.apply(await loadSpecies(id));

      it('is a complete, valid Tree Definition that remembers its Species', () => {
        expect(parseDefinition(definition)).toEqual(definition);
        expect(definition.species).toBe(id);
      });

      it('generates deterministically (geometry hash snapshot)', async () => {
        const hashes = SEEDS.map((seed) => hashTreeData(generateTree(parseDefinition(definition), seed)));
        expect(SEEDS.map((seed) => hashTreeData(generateTree(parseDefinition(definition), seed)))).toEqual(hashes);
        // One snapshot file per Species, so Species authored in parallel never touch the same file.
        await expect(JSON.stringify({ seeds: SEEDS, hashes }, null, 2) + '\n').toMatchFileSnapshot(`./__snapshots__/${id}.${name}.json`);
      });

      it(`stays within the triangle budget (at most +50% of the ${name} Style's own trees)`, () => {
        for (const seed of SEEDS) {
          expect(triangles(generateTree(parseDefinition(definition), seed))).toBeLessThanOrEqual(styleTriangles[name]! * 1.5);
        }
      });

      it('gives different but recognisable trees for different Seeds', () => {
        const trees = SEEDS.map((seed) => generateTree(parseDefinition(definition), seed));
        expect(new Set(trees.map(hashTreeData)).size).toBe(SEEDS.length);
        // Same Species: every Seed keeps the trunk structure and the overall size within the variation ranges.
        const heights = trees.map((t) => Math.max(...t.skeleton.branches.flatMap((b) => b.points.map((p) => p.position[1]))));
        const leaves = trees.map((t) => t.skeleton.leaves.length);
        expect(Math.max(...heights) / Math.min(...heights)).toBeLessThan(1.6);
        expect(Math.max(...leaves) / Math.min(...leaves)).toBeLessThan(1.6);
      });
    });
  }
});
