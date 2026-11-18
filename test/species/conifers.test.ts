// The conifer Species (#37): what makes each of them that Species, checked through the Species subpath
// and the generated tree. The shared Species x Style harness (collection.test.ts) covers them as well.
import { describe, expect, it } from 'vitest';
import { parseDefinition, type SpeciesDefinition, type TreeData } from '../../src/index';
import { generateTree } from '../../src/generator';
import { SPECIES_NAMES, loadSpecies } from '../../src/species';
import { fruitTracks, hexToLinear, sampleTrack } from '../../src/season/profile';
import lowPoly from '../../src/styles/low-poly';

const CONIFERS = ['cedar', 'douglas-fir', 'hemlock', 'juniper', 'pine', 'redwood', 'sequoia', 'spruce'] as const;
const load = (id: (typeof CONIFERS)[number]) => loadSpecies(id as never) as Promise<SpeciesDefinition>;
const grow = async (id: (typeof CONIFERS)[number], seed = 1) => generateTree(parseDefinition(lowPoly.apply(await load(id))), seed);

/** Height of the tree and the widest horizontal reach of any branch point from the trunk axis. */
function extent(tree: TreeData) {
  const points = tree.skeleton.branches.flatMap((b) => b.points.map((p) => p.position));
  return {
    height: Math.max(...points.map((p) => p[1])),
    width: Math.max(...points.map((p) => Math.hypot(p[0], p[2]))),
  };
}

describe('the conifer Species', () => {
  it('are all in the collection, as conifers', async () => {
    for (const id of CONIFERS) {
      expect(SPECIES_NAMES).toContain(id);
      expect((await load(id)).form).toBe('conifer');
    }
  });

  it('bear cones (juniper: berries) that stay all year and turn from green to brown', async () => {
    for (const id of CONIFERS) {
      const species = await load(id);
      expect(species.fruit?.type, id).toBe(id === 'juniper' ? 'berry' : 'cone');
      const { fruit, fruitColor } = fruitTracks(species.season as never);
      for (let s = 0; s <= 1; s += 0.05) expect(sampleTrack(fruit, s), `${id} fruit at Season ${s}`).toBeGreaterThan(0.5);
      if (id === 'juniper') continue;
      const [r0, g0] = hexToLinear(fruitColor[0]!.value);
      const [r1, g1, b1] = hexToLinear(fruitColor[fruitColor.length - 1]!.value);
      expect(g0, `${id} young cone is green`).toBeGreaterThan(r0);
      expect(r1, `${id} ripe cone is brown`).toBeGreaterThan(g1);
      expect(g1).toBeGreaterThan(b1);
    }
  });

  it('cedar and juniper grow several Stems with scale leaves', async () => {
    for (const id of ['cedar', 'juniper'] as const) {
      const species = await load(id);
      expect(species.trunk.stems, id).toBeGreaterThan(1);
      expect(species.foliage.type).toBe('scale');
      expect((await grow(id)).skeleton.branches.filter((b) => b.level === 0)).toHaveLength(species.trunk.stems!);
    }
  });

  it('hemlock has a nodding leader, pine a bare lower trunk and plated bark, redwood fibrous bark', async () => {
    expect((await load('hemlock')).trunk.gravity).toBeLessThan(0);
    const pine = await load('pine');
    expect(pine.bark.type).toBe('plated');
    expect(pine.branches[0]!.start).toBeGreaterThanOrEqual(0.5);
    expect((await load('redwood')).bark.type).toBe('fibrous');
  });

  it('redwood is a very tall narrow column; sequoia a massive trunk under a broader crown', async () => {
    for (const seed of [1, 7, 42]) {
      const redwood = extent(await grow('redwood', seed));
      const sequoia = extent(await grow('sequoia', seed));
      expect(redwood.height).toBeGreaterThan(sequoia.height);
      expect(redwood.height / redwood.width).toBeGreaterThan(1.5 * (sequoia.height / sequoia.width));
    }
    expect((await load('sequoia')).trunk.radius).toBeGreaterThan(1.5 * (await load('redwood')).trunk.radius);
  });
});
