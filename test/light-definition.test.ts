import { describe, expect, it } from 'vitest';
import { parseDefinition, type SpeciesDefinition, type TreeDefinition } from '../src/index';
import { generateLightTree, generateTree, lightDefinition, type GeometryBuffers } from '../src/generator';
import * as collection from '../src/species';
import lowPoly from '../src/styles/low-poly';
import stylized from '../src/styles/stylized';
import realistic from '../src/styles/realistic';

const full = parseDefinition({ schemaVersion: 3 });

describe('lightDefinition', () => {
  it('halves the sides and sections of the trunk and every remaining branch level (at least 3 sides, 1 section)', () => {
    const light = lightDefinition(
      parseDefinition({
        schemaVersion: 3,
        trunk: { sides: 8, sections: 8 },
        branches: [{ sides: 6, sections: 5 }, { sides: 4, sections: 1 }, { sides: 3, sections: 3 }],
      }),
    );
    expect([light.trunk.sides, light.trunk.sections]).toEqual([4, 4]);
    expect(light.branches.map((b) => [b.sides, b.sections])).toEqual([
      [3, 3],
      [3, 1],
    ]);
  });

  it('drops the deepest branch level and enlarges the leaves by the square root of its count, up to 2.5 times', () => {
    const twigs = (count: number) =>
      lightDefinition(parseDefinition({ schemaVersion: 3, leaves: { count: 8, size: 0.2 }, branches: [{}, { count }] }));
    expect(twigs(4).branches).toHaveLength(1);
    expect(twigs(4).leaves.count).toBe(8);
    expect(twigs(4).leaves.size).toBeCloseTo(0.4, 10);
    expect(twigs(16).leaves.size).toBeCloseTo(0.5, 10);
  });

  it('keeps the only branch level (and a deepest level without branches), halving the leaves per branch and enlarging them to the same leaf area', () => {
    const one = lightDefinition(parseDefinition({ schemaVersion: 3, leaves: { count: 7, size: 0.3 }, branches: [{ count: 20 }] }));
    expect(one.branches).toHaveLength(1);
    expect(one.leaves.count).toBe(4);
    expect(one.leaves.size).toBeCloseTo(0.3 * Math.sqrt(7 / 4), 10);
    const empty = lightDefinition(parseDefinition({ schemaVersion: 3, leaves: { count: 1 }, branches: [{}, { count: 0 }] }));
    expect(empty.branches).toHaveLength(2);
    expect(empty.leaves).toMatchObject({ count: 1, size: 0.25 });
  });

  it('draws Fruit coarse (half the sides, at most 5, at least 3)', () => {
    const fruit = (sides?: number) => lightDefinition(parseDefinition({ schemaVersion: 3, fruit: sides === undefined ? {} : { sides } })).fruit!.sides;
    expect(fruit()).toBe(5);
    expect(fruit(12)).toBe(5);
    expect(fruit(4)).toBe(3);
    expect(fruit(3)).toBe(3);
    expect(lightDefinition(full).fruit).toBeUndefined();
  });

  it('halves the sides of Roots and the extra rings of the Root Flare', () => {
    const light = lightDefinition(parseDefinition({ schemaVersion: 3, trunk: { sides: 8, flare: 0.5, flareSections: 3 }, roots: { sides: 7 } }));
    expect(light.roots!.sides).toBe(4);
    expect(light.trunk.flareSections).toBe(2);
    expect(lightDefinition(parseDefinition({ schemaVersion: 3, trunk: { sides: 9 }, roots: {} })).roots!.sides).toBe(3);
  });

  it('merges the override on top of the reductions', () => {
    const light = lightDefinition(full, { trunk: { sides: 7 }, leaves: { size: 1 } });
    expect(light.trunk.sides).toBe(7);
    expect(light.trunk.sections).toBe(4);
    expect(light.leaves.size).toBe(1);
    expect(light.branches).toHaveLength(1);
  });

  it('rejects an invalid override like extendDefinition does', () => {
    expect(() => lightDefinition(full, { trunk: { sides: 2 } })).toThrow(/trunk.sides/);
  });

  it('never changes the Definition it derives from', () => {
    const copy = structuredClone(full);
    lightDefinition(full, { trunk: { sides: 7 } });
    expect(full).toEqual(copy);
  });
});

const triangles = (g: GeometryBuffers) => g.indices.length / 3;
const camelCase = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
/** Every bundled Species in every Style. */
const bundled: [string, TreeDefinition][] = collection.SPECIES_NAMES.flatMap((id) => {
  const species = (collection as unknown as Record<string, SpeciesDefinition>)[camelCase(id)]!;
  return [lowPoly, stylized, realistic].map((style) => [`${id} (${style.name})`, style.apply(species)] as [string, TreeDefinition]);
});

describe('generateLightTree', () => {
  it.each(bundled)('%s: Light wood, leaves and Fruit have fewer triangles than Full', (_, definition) => {
    const full = generateTree(definition, 7);
    const light = generateLightTree(definition, 7);
    expect(triangles(light.wood)).toBeLessThan(triangles(full.wood));
    expect(triangles(light.leaves)).toBeLessThan(triangles(full.leaves));
    if (triangles(full.fruit) > 0) expect(triangles(light.fruit)).toBeLessThan(triangles(full.fruit));
    else expect(triangles(light.fruit)).toBe(0);
  });
});
