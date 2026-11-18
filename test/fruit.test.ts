import { describe, expect, it } from 'vitest';
import { Mesh } from 'three/webgpu';
import {
  createTree,
  evaluateSeason,
  fruitSeason,
  parseDefinition,
  partSeasonAt,
  TreeDefinitionError,
  type SeasonProfileDefinition,
  type TreeDefinitionInput,
} from '../src/index';
import { generateTree } from '../src/generator';

const fruitTree: TreeDefinitionInput = {
  schemaVersion: 3,
  branches: [{ count: 5 }, { count: 3, start: 0.2 }],
  fruit: { type: 'round', count: 2, size: 0.12, hang: 0.7 },
};

/** Fruit appears in late spring, swells over summer, is picked/dropped in autumn; green -> red. */
const orchard: SeasonProfileDefinition = {
  leafColor: [{ t: 0, value: '#00ff00' }],
  leafCoverage: [{ t: 0, value: 1 }],
  blossom: [{ t: 0, value: 0 }],
  blossomColor: '#ffffff',
  fruit: [
    { t: 0.2, value: 0 },
    { t: 0.4, value: 1 },
    { t: 0.6, value: 1 },
    { t: 0.7, value: 0 },
  ],
  fruitColor: [
    { t: 0.3, value: '#00ff00' },
    { t: 0.6, value: '#ff0000' },
  ],
};

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof TreeDefinitionError) return e.field;
    throw e;
  }
  return undefined;
}

describe('the fruit block of a Tree Definition', () => {
  it('is absent unless given: Definitions without Fruit are unchanged', () => {
    const parsed = parseDefinition({ schemaVersion: 3 });
    expect('fruit' in parsed).toBe(false);
    expect('fruit' in parsed.season).toBe(false);
    expect('fruitColor' in parsed.season).toBe(false);
  });

  it('takes a fractional count (a chance per twig) and optional sides (Fruit detail, set by the Style)', () => {
    expect(parseDefinition({ schemaVersion: 3, fruit: { count: 0.35 } }).fruit?.count).toBe(0.35);
    expect(parseDefinition({ schemaVersion: 3, fruit: { sides: 5 } }).fruit?.sides).toBe(5);
  });

  it('fills the missing fields of a given block from the defaults', () => {
    expect(parseDefinition({ schemaVersion: 3, fruit: { type: 'cone' } }).fruit).toEqual({
      type: 'cone',
      count: 2,
      size: 0.12,
      sizeVariation: 0.2,
      hang: 0.7,
    });
  });

  it.each([
    ['fruit type', { fruit: { type: 'banana' } }, 'fruit.type'],
    ['fruit count', { fruit: { count: -0.5 } }, 'fruit.count'],
    ['fruit sides', { fruit: { sides: 2 } }, 'fruit.sides'],
    ['fruit size', { fruit: { size: 0 } }, 'fruit.size'],
    ['fruit hang', { fruit: { hang: 2 } }, 'fruit.hang'],
    ['unknown fruit field', { fruit: { colour: '#ff0000' } }, 'fruit.colour'],
  ])('rejects a bad %s', (_name, input, field) => {
    expect(fieldOf(() => parseDefinition({ schemaVersion: 3, ...input }))).toBe(field);
  });
});

describe('the Season check of the Fruit tracks', () => {
  it.each([
    ['empty fruit track', { fruit: [] }, 'season.fruit'],
    ['fruit amount out of range', { fruit: [{ t: 0, value: 1.5 }] }, 'season.fruit[0].value'],
    ['unsorted fruit keyframes', { fruit: [{ t: 0.5, value: 1 }, { t: 0.2, value: 0 }] }, 'season.fruit[1].t'],
    ['fruit colour', { fruitColor: [{ t: 0, value: 'red' }] }, 'season.fruitColor[0].value'],
    ['fruit colour keyframe t', { fruitColor: [{ t: 2, value: '#ff0000' }] }, 'season.fruitColor[0].t'],
  ])('rejects a %s', (_name, season, field) => {
    expect(fieldOf(() => parseDefinition({ schemaVersion: 3, season }))).toBe(field);
  });

  it('accepts valid Fruit tracks', () => {
    const { season } = parseDefinition({ schemaVersion: 3, season: orchard });
    expect(season.fruit).toEqual(orchard.fruit);
    expect(season.fruitColor).toEqual(orchard.fruitColor);
  });
});

describe('fruitSeason (CPU twin of the Fruit shader)', () => {
  const part = (rank: number, shift = 0) => ({ shift, coverageRank: rank, blossomRank: 0 });

  it('has no Fruit before it sets and after it drops', () => {
    expect(fruitSeason(orchard, 0.1, part(0)).visible).toBe(false);
    expect(fruitSeason(orchard, 0.1, part(0)).scale).toBe(0);
    expect(fruitSeason(orchard, 0.8, part(0)).visible).toBe(false);
  });

  it('shows a Fruit while the amount is above its rank, and swells with the amount', () => {
    // amount 0.5 at 0.3
    expect(fruitSeason(orchard, 0.3, part(0.4))).toMatchObject({ visible: true });
    expect(fruitSeason(orchard, 0.3, part(0.4)).scale).toBeCloseTo(0.5, 6);
    expect(fruitSeason(orchard, 0.3, part(0.6))).toMatchObject({ visible: false, scale: 0 });
    expect(fruitSeason(orchard, 0.5, part(0.99)).scale).toBe(1);
  });

  it('ripens: the Fruit colour follows its keyframes (linear RGB)', () => {
    expect(fruitSeason(orchard, 0.3, part(0)).color).toEqual([0, 1, 0]);
    expect(fruitSeason(orchard, 0.6, part(0)).color).toEqual([1, 0, 0]);
    const halfway = fruitSeason(orchard, 0.45, part(0)).color;
    expect(halfway[0]).toBeCloseTo(0.5, 5);
    expect(halfway[1]).toBeCloseTo(0.5, 5);
  });

  it('applies the Fruit timing shift', () => {
    expect(fruitSeason(orchard, 0.1, part(0, 0.3)).scale).toBe(1); // amount at 0.4
  });

  it('without Fruit tracks, every Fruit is full size and red all year', () => {
    const { season } = parseDefinition({ schemaVersion: 3 });
    for (const s of [0, 0.3, 0.8]) {
      const state = fruitSeason(season, s, part(0.99));
      expect(state.scale).toBe(1);
      expect(state.color[0]).toBeGreaterThan(state.color[1] * 5);
    }
  });

  it('is part of the Season Profile state', () => {
    const state = evaluateSeason(orchard, 0.3);
    expect(state.fruit).toBeCloseTo(0.5, 6);
    expect(state.fruitColor).toEqual([0, 1, 0]);
  });

  it('over a tree: Fruit sets, swells, ripens and drops across the Season', () => {
    const data = generateTree(parseDefinition({ ...fruitTree, season: orchard, variation: { season: 0 } }), 7);
    const { aSeason } = data.fruit.attributes;
    const states = (s: number) =>
      Array.from({ length: aSeason.array.length / 3 }, (_, v) => fruitSeason(orchard, s, partSeasonAt(aSeason.array, v)));
    const shown = (s: number) => states(s).filter((f) => f.visible).length / states(s).length;
    const meanScale = (s: number) => states(s).reduce((sum, f) => sum + f.scale, 0) / states(s).length;
    expect(shown(0.1)).toBe(0);
    expect(shown(0.3)).toBeGreaterThan(0.2);
    expect(shown(0.3)).toBeLessThan(0.8);
    expect(shown(0.5)).toBe(1);
    expect(meanScale(0.25)).toBeLessThan(meanScale(0.3));
    expect(meanScale(0.3)).toBeLessThan(meanScale(0.5));
    expect(shown(0.8)).toBe(0);
    expect(states(0.35)[0]!.color[1]).toBeGreaterThan(states(0.55)[0]!.color[1]);
  });
});

describe('Tree.fruit', () => {
  it('is a third mesh next to wood and leaves, empty without Fruit', () => {
    const tree = createTree({ schemaVersion: 3 }, { seed: 1 });
    expect(tree.fruit).toBeInstanceOf(Mesh);
    expect(tree.fruit.name).toBe('fruit');
    expect(tree.children).toContain(tree.fruit);
    expect(tree.fruit.geometry.getAttribute('position').count).toBe(0);
  });

  it('holds the Fruit geometry, drawn by the Definition\'s shading, untextured, Season-driven', () => {
    for (const shading of ['flat', 'toon', 'standard'] as const) {
      const tree = createTree({ ...fruitTree, materials: { shading } }, { seed: 1 });
      expect(tree.fruit.geometry.getAttribute('position').count).toBe(tree.data.fruit.positions.length / 3);
      expect(tree.fruit.geometry.getAttribute('position').count).toBeGreaterThan(0);
      const material = tree.fruit.material;
      expect(material.userData.treePart).toBe('fruit');
      expect(material.map).toBeNull();
      expect(material.flatShading).toBe(shading === 'flat');
      expect(material.colorNode).not.toBeNull();
      expect(material.positionNode).not.toBeNull();
    }
  });

  it('changes over Season by a uniform only (shared with the leaves)', () => {
    const tree = createTree(fruitTree, { seed: 1 });
    const { geometry, material } = tree.fruit;
    const { version } = material;
    tree.season = 0.6;
    expect(tree.fruit.geometry).toBe(geometry);
    expect(tree.fruit.material).toBe(material);
    expect(material.version).toBe(version);
  });
});
