// The Species collection (`@casmo/tree.js/species`): runs over every Species in SPECIES_NAMES, so a new
// Species is covered by adding its JSON file (and regenerating the catalog), nothing here.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { hashTreeData, parseDefinition, type SpeciesDefinition, type TreeData } from '../../src/index';
import { generateTree } from '../../src/generator';
import { withoutTipBranches } from '../definitions';
import * as collection from '../../src/species';
import lowPoly from '../../src/styles/low-poly';
import stylized from '../../src/styles/stylized';
import realistic from '../../src/styles/realistic';
import painterly from '../../src/styles/painterly';
import whimsical from '../../src/styles/whimsical';
import enchanted from '../../src/styles/enchanted';

const { SPECIES_NAMES, loadSpecies } = collection;
const styles = { 'low-poly': lowPoly, stylized, realistic, painterly, whimsical, enchanted };
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

    it(`${id}: takes the default Tip Branches in every Style, setting none of its own (ADR 0021)`, () => {
      expect(json(id).branches.map((level) => level.tipBranches)).toEqual(json(id).branches.map(() => undefined));
      for (const style of Object.values(styles)) {
        expect(style.apply(json(id)).branches.map((level) => level.tipBranches), id).toEqual(json(id).branches.map(() => undefined));
      }
    });
  }

  // Root Flare tiers (spec #43): heavy-based trees flare strongly, fruit trees and most broadleaves
  // lightly, birch and the conifers minimally. Tuned within a tier by looking at renders.
  const FLARE_TIERS = {
    strong: { range: [0.6, 1], ids: ['oak', 'white-oak', 'red-oak', 'chestnut', 'mahogany', 'teak', 'redwood', 'sequoia'] },
    light: {
      range: [0.25, 0.55],
      ids: ['apple', 'pear', 'cherry', 'plum', 'peach', 'almond', 'olive', 'walnut', 'hickory', 'beech', 'elm', 'ash', 'maple'],
    },
    minimal: { range: [0.05, 0.25], ids: ['birch', 'cedar', 'douglas-fir', 'hemlock', 'juniper', 'pine', 'spruce'] },
  } as const;

  it('puts every Species in exactly one Root Flare tier', () => {
    const tiered = Object.values(FLARE_TIERS).flatMap((tier) => [...tier.ids]);
    expect(tiered.sort()).toEqual([...SPECIES_NAMES]);
  });

  for (const [tier, { range, ids }] of Object.entries(FLARE_TIERS)) {
    it(`${tier} tier: each Species has a Root Flare in ${range[0]}..${range[1]}, kept by every Style`, () => {
      for (const id of ids) {
        const flare = json(id).trunk.flare;
        expect(flare, id).toBeGreaterThanOrEqual(range[0]);
        expect(flare, id).toBeLessThanOrEqual(range[1]);
        for (const style of Object.values(styles)) expect(style.apply(json(id)).trunk.flare, id).toBe(flare);
      }
    });
  }

  // Roots tiers (spec #43), the same Species as the Root Flare tiers: a strong tier has more, thicker,
  // flatter and more gnarled Roots (at least 7, which the gallery tags as "Roots"); redwood and sequoia
  // keep theirs short because their Stems are very long.
  type Range = readonly [number, number];
  const ROOT_TIERS: Record<keyof typeof FLARE_TIERS, Record<'count' | 'length' | 'radius' | 'angle' | 'bend', Range>> = {
    strong: { count: [7, 8], length: [0.1, 0.35], radius: [0.35, 0.45], angle: [8, 12], bend: [0.3, 0.4] },
    light: { count: [4, 6], length: [0.15, 0.25], radius: [0.25, 0.35], angle: [12, 16], bend: [0.25, 0.35] },
    minimal: { count: [2, 4], length: [0.05, 0.15], radius: [0.18, 0.26], angle: [18, 24], bend: [0.2, 0.3] },
  };

  for (const [tier, ranges] of Object.entries(ROOT_TIERS)) {
    it(`${tier} tier: each Species has Roots in its tier, kept by every Style`, () => {
      for (const id of FLARE_TIERS[tier as keyof typeof FLARE_TIERS].ids) {
        const roots = json(id).roots;
        expect(roots, id).toBeDefined();
        for (const [field, [min, max]] of Object.entries(ranges)) {
          const value = roots![field as keyof typeof ranges];
          expect(value, `${id} roots.${field}`).toBeGreaterThanOrEqual(min);
          expect(value, `${id} roots.${field}`).toBeLessThanOrEqual(max);
        }
        expect(Number.isInteger(roots!.count), id).toBe(true);
        for (const style of Object.values(styles)) expect(style.apply(json(id)).roots, id).toMatchObject(roots!);
      }
    });
  }

  it('redwood and sequoia have the shortest strong-tier Roots (their Stems are very long)', () => {
    for (const id of ['redwood', 'sequoia']) expect(json(id).roots?.length, id).toBeLessThanOrEqual(0.15);
  });

  it('loadSpecies rejects an unknown id, listing the known ones', async () => {
    await expect(loadSpecies('baobab' as never)).rejects.toThrow(/Unknown tree\.js Species "baobab".*oak/);
    await expect(loadSpecies('Oak' as never)).rejects.toThrow(/Unknown/);
  });
});

/**
 * Per Style: triangles of its own generic broadleaf / conifer (the larger), at the test Seeds, given a
 * Root Flare and Roots like every Species has (the generic trees have neither; the flare's extra trunk rings
 * and the Roots are not crown detail). The Roots are a light-tier Species' (apple's), in the Style's own detail.
 *
 * Tip Branches (ADR 0019, ADR 0021) are counted in two steps. Measured as shipped on both sides before ADR 0021,
 * 68 of the 168 Species / Style pairs were over +50% (olive in stylized 2.41×, almond 2.19×, oak 2.14×): a
 * default Tip Branch adds one branch per parent on every branch level, which is ×(count + 1) / count per level,
 * so it costs a Species with few branches per level (olive ×2.68) far more than a Style's many-branched generic
 * trees. Species are not re-tuned for that (spec #147, spec #161), so the +50% holds for what the Species author
 * sets, the trees with Tip Branches off on both sides (at most 1.48× now); and the shipped tree may add at most
 * TIP_BRANCH_COST to it. Every Species takes the default (checked above), so a Species can't buy Tip Branches past it.
 */
const withFlareAndRoots = <T extends { trunk: object }>(d: T, style: (typeof styles)[keyof typeof styles]): T => ({
  ...d,
  trunk: { ...d.trunk, flare: 0.4 },
  roots: style.apply(json('apple')).roots,
});
/**
 * Painterly's own generic trees are small (3-3.5 m, few boughs) while its Species keep their full branching,
 * so Painterly is held to the stylized budget instead: Painterly is meant to cost about what stylized costs.
 */
const BUDGET_OF: Partial<Record<string, keyof typeof styles>> = { painterly: 'stylized' };
const ownTriangles = Object.fromEntries(
  Object.entries(styles).map(([name, style]) => [
    name,
    Math.max(
      ...[style.broadleaf, style.conifer].flatMap((d) =>
        SEEDS.map((seed) => triangles(generateTree(parseDefinition(withoutTipBranches(withFlareAndRoots(d, style))), seed))),
      ),
    ),
  ]),
);
/** How much the default Tip Branches may add to a Species' tree (measured: at most ×2.68, olive in painterly). */
const TIP_BRANCH_COST = 3;
const styleTriangles = Object.fromEntries(Object.keys(styles).map((name) => [name, ownTriangles[BUDGET_OF[name] ?? name]!]));

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

      it(`stays within the triangle budget (at most +50% of the ${BUDGET_OF[name] ?? name} Style's own trees, then at most ×${TIP_BRANCH_COST} for its Tip Branches)`, () => {
        for (const seed of SEEDS) {
          const stumps = triangles(generateTree(parseDefinition(withoutTipBranches(definition)), seed));
          expect(stumps).toBeLessThanOrEqual(styleTriangles[name]! * 1.5);
          expect(triangles(generateTree(parseDefinition(definition), seed))).toBeLessThanOrEqual(stumps * TIP_BRANCH_COST);
        }
      });

      if (name === 'painterly') {
        it('costs about what the Species costs in stylized (at most +30%; less over the whole catalogue, below)', () => {
          const toon = stylized.apply(definition);
          for (const seed of SEEDS) {
            expect(triangles(generateTree(parseDefinition(definition), seed))).toBeLessThanOrEqual(triangles(generateTree(parseDefinition(toon), seed)) * 1.3);
          }
        });
      }

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

describe('Painterly over the whole catalogue', () => {
  it('costs no more triangles than stylized for all Species together (Seed 1)', async () => {
    let [painted, toon] = [0, 0];
    for (const id of SPECIES_NAMES) {
      const species = await loadSpecies(id);
      painted += triangles(generateTree(painterly.apply(species), 1));
      toon += triangles(generateTree(stylized.apply(species), 1));
    }
    expect(painted).toBeLessThanOrEqual(toon);
  });
});
