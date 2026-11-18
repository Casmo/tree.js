// The fruit-tree Species (#36) go through the full yearly cycle: blossom in spring, Fruit sets after the
// blossom, ripens green -> its colour over summer/autumn and drops before winter. Checked on generated
// trees through the CPU twins of the Season shaders (leafSeason / fruitSeason on the aSeason attributes).
import { describe, expect, it } from 'vitest';
import { fruitSeason, leafSeason, parseDefinition, partSeasonAt, type FruitType, type RGB, type TreeData } from '../../src/index';
import { generateTree } from '../../src/generator';
import { loadSpecies, type SpeciesName } from '../../src/species';
import lowPoly from '../../src/styles/low-poly';

const FRUIT_TREES: Record<string, { fruit: FruitType; evergreen?: boolean; stems?: boolean }> = {
  cherry: { fruit: 'round' },
  apple: { fruit: 'round' },
  plum: { fruit: 'round' },
  peach: { fruit: 'round' },
  pear: { fruit: 'pear' },
  olive: { fruit: 'round', evergreen: true, stems: true },
  almond: { fruit: 'nut' },
};

/** Seasons from `from` to `to` (exclusive) in steps of 0.01. */
const seasons = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 100) }, (_, i) => from + i / 100);
const SPRING = seasons(0, 0.25);
const SUMMER_AUTUMN = seasons(0.25, 0.75);
const WINTER = seasons(0.8, 0.95);

/** Green: the green channel clearly leads. */
const isGreen = ([r, g, b]: RGB) => g > r * 1.15 && g > b;

function seasonOf(tree: TreeData, profile: Parameters<typeof leafSeason>[0]) {
  const leaves = tree.leaves.attributes.aSeason.array;
  const fruit = tree.fruit.attributes.aSeason.array;
  const leafStates = (s: number) => Array.from({ length: leaves.length / 3 }, (_, v) => leafSeason(profile, s, partSeasonAt(leaves, v)));
  const fruitStates = (s: number) => Array.from({ length: fruit.length / 3 }, (_, v) => fruitSeason(profile, s, partSeasonAt(fruit, v)));
  const share = <T>(states: T[], test: (state: T) => boolean) => states.filter(test).length / states.length;
  return {
    /** Share of leaf vertices showing as blossom. */
    blossom: (s: number) => share(leafStates(s), (l) => l.blossom),
    /** Share of leaf vertices showing (as leaf or blossom). */
    leaves: (s: number) => share(leafStates(s), (l) => l.visible),
    /** Share of Fruit vertices showing. */
    fruit: (s: number) => share(fruitStates(s), (f) => f.visible),
    fruitColor: (s: number) => fruitStates(s)[0]!.color,
  };
}

describe.each(Object.entries(FRUIT_TREES))('the %s Species through the year', (id, expected) => {
  it('is in the collection with its Fruit Type', async () => {
    const species = await loadSpecies(id as SpeciesName);
    expect(species.fruit?.type).toBe(expected.fruit);
    expect((species.trunk.stems ?? 1) > 1).toBe(expected.stems ?? false);
  });

  describe('on a generated tree', async () => {
    const definition = parseDefinition(lowPoly.apply(await loadSpecies(id as SpeciesName)));
    const year = seasonOf(generateTree(definition, 1), definition.season);

    it('blossoms in spring, and only in spring', () => {
      const peak = Math.max(...SPRING.map(year.blossom));
      expect(peak).toBeGreaterThan(expected.evergreen ? 0.1 : 0.3);
      for (const s of SUMMER_AUTUMN) expect(year.blossom(s)).toBe(0);
    });

    it('sets Fruit after the blossom', () => {
      const peak = SPRING.reduce((best, s) => (year.blossom(s) > year.blossom(best) ? s : best));
      expect(year.fruit(peak)).toBe(0);
      const firstFruit = seasons(0, 1).find((s) => year.fruit(s) > 0)!;
      expect(firstFruit).toBeGreaterThan(peak);
    });

    it('bears Fruit in summer/autumn that ripens from green to its colour', () => {
      const bearing = SUMMER_AUTUMN.filter((s) => year.fruit(s) > 0.6);
      expect(bearing.length).toBeGreaterThan(5);
      const fruiting = seasons(0, 0.75).filter((s) => year.fruit(s) > 0);
      expect(isGreen(year.fruitColor(fruiting[0]!))).toBe(true);
      expect(bearing.some((s) => !isGreen(year.fruitColor(s)))).toBe(true);
    });

    it('has dropped all its Fruit by winter', () => {
      for (const s of WINTER) expect(year.fruit(s)).toBe(0);
    });

    it(expected.evergreen ? 'keeps its leaves all year' : 'is bare in winter', () => {
      for (const s of WINTER) expect(year.leaves(s)).toBe(expected.evergreen ? 1 : 0);
    });
  });
});
