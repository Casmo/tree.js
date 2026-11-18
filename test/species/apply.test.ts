import { describe, expect, it } from 'vitest';
import { BARK_TYPES, createTree, extendDefinition, hashTreeData, LEAF_TYPES, parseDefinition, SEASON_PROFILES, TreeDefinitionError, type SpeciesDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';
import lowPoly from '../../src/styles/low-poly';
import stylized from '../../src/styles/stylized';
import realistic from '../../src/styles/realistic';

/** A small test Species: a short broadleaf with lobed leaves and plated bark. */
const testOak: SpeciesDefinition = {
  id: 'test-oak',
  name: 'Test oak',
  form: 'broadleaf',
  trunk: { length: 3.5, radius: 0.3, taper: 0.5, lengthVariation: 0.15, bend: 0.12 },
  branches: [
    { count: 6, start: 0.45, end: 0.92, angle: 55, angleVariation: 0.2, spiral: 137.5, length: 0.55, lengthVariation: 0.2, radius: 0.55, taper: 0.45, bend: 0.15, gravity: 0.05,
      lengthProfile: [{ t: 0.45, value: 0.8 }, { t: 0.7, value: 1 }, { t: 1, value: 0.6 }] },
    { count: 3, start: 0.3, end: 1, angle: 40, angleVariation: 0.25, spiral: 120, length: 0.5, lengthVariation: 0.25, radius: 0.6, taper: 0.45, bend: 0.12, gravity: 0.1 },
  ],
  foliage: { type: 'lobed', density: 0.5, size: 0.35, sizeVariation: 0.25, start: 0.4, angle: 35 },
  bark: { type: 'plated', color: '#6e5a48' },
  season: SEASON_PROFILES.deciduous,
  wind: { trunk: 0.15, branches: 0.4, leaves: 0.6, frequency: 1 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
};

/** A small needle-leaved test Species. */
const testFir: SpeciesDefinition = {
  id: 'test-fir',
  name: 'Test fir',
  form: 'conifer',
  trunk: { length: 6, radius: 0.22, taper: 0.1, lengthVariation: 0.12, bend: 0.03 },
  branches: [
    { count: 20, start: 0.15, end: 0.97, angle: 90, angleVariation: 0.1, spiral: 137.5, length: 0.4, lengthVariation: 0.15, radius: 0.35, taper: 0.3, bend: 0.05, gravity: -0.05,
      lengthProfile: [{ t: 0.15, value: 1 }, { t: 1, value: 0.1 }] },
  ],
  foliage: { type: 'needle', density: 0.5, size: 0.35, sizeVariation: 0.2, start: 0, angle: 35 },
  bark: { type: 'furrowed', color: '#5c4030' },
  season: SEASON_PROFILES.evergreen,
  wind: { trunk: 0.1, branches: 0.3, leaves: 0.3, frequency: 0.8 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
};

const styles = { 'low-poly': lowPoly, stylized, realistic };

describe('Leaf Types and Bark Types in the Tree Definition', () => {
  it('lists the six Leaf Types and five Bark Types', () => {
    expect(LEAF_TYPES).toEqual(['broad', 'lobed', 'palmate', 'compound', 'needle', 'scale']);
    expect(BARK_TYPES).toEqual(['furrowed', 'smooth', 'papery', 'fibrous', 'plated']);
  });

  it('keeps species, leaves.type and materials.bark.type, and leaves them absent when not given', () => {
    const d = parseDefinition({ schemaVersion: 3, species: 'oak', leaves: { type: 'lobed' }, materials: { bark: { type: 'plated' } } });
    expect(d.species).toBe('oak');
    expect(d.leaves.type).toBe('lobed');
    expect(d.materials.bark.type).toBe('plated');
    const plain = parseDefinition({ schemaVersion: 3 });
    expect('species' in plain || 'type' in plain.leaves || 'type' in plain.materials.bark).toBe(false);
  });

  it('rejects an unknown Leaf Type or Bark Type', () => {
    expect(() => parseDefinition({ schemaVersion: 3, leaves: { type: 'spiky' } })).toThrow(TreeDefinitionError);
    expect(() => parseDefinition({ schemaVersion: 3, materials: { bark: { type: 'glass' } } })).toThrow(/materials\.bark\.type/);
  });
});

describe('Style.apply: a Species becomes a complete Tree Definition', () => {
  for (const [name, style] of Object.entries(styles)) {
    for (const species of [testOak, testFir]) {
      it(`${name}.apply(${species.id}) parses unchanged and grows a tree with branches and leaves`, () => {
        const definition = style.apply(species);
        expect(parseDefinition(definition)).toEqual(definition);
        const tree = generateTree(parseDefinition(definition), 7);
        expect(tree.skeleton.branches.length).toBeGreaterThan(5);
        expect(tree.skeleton.leaves.length).toBeGreaterThan(10);
      });
    }
  }
});

const withLeaves = (type: SpeciesDefinition['foliage']['type']): SpeciesDefinition => ({ ...testOak, foliage: { ...testOak.foliage, type } });

describe('Style.apply: each Style draws the Leaf Type and Bark Type its own way', () => {
  it('low-poly: needle and scale become needles, the other Leaf Types clumps; flat shading, no textures', () => {
    for (const type of LEAF_TYPES) {
      expect(lowPoly.apply(withLeaves(type)).leaves.shape).toBe(type === 'needle' || type === 'scale' ? 'needle' : 'clump');
    }
    const { materials } = lowPoly.apply(testOak);
    expect(materials.shading).toBe('flat');
    expect([materials.bark.map, materials.bark.normalMap, materials.leaf.map]).toEqual([null, null, null]);
  });

  it('stylized: every Leaf Type is a puff, smaller and denser for needle / scale; toon shading', () => {
    const broad = stylized.apply(withLeaves('broad')).leaves;
    for (const type of LEAF_TYPES) expect(stylized.apply(withLeaves(type)).leaves.shape).toBe('puff');
    for (const type of ['needle', 'scale'] as const) {
      const fine = stylized.apply(withLeaves(type)).leaves;
      expect(fine.size).toBeLessThan(broad.size);
      expect(fine.count).toBeGreaterThan(broad.count);
    }
    expect(stylized.apply(testOak).materials.shading).toBe('toon');
  });

  it('realistic: textured cards (needles texture for needle / scale) and textured bark for every Bark Type', () => {
    expect(realistic.apply(withLeaves('lobed')).leaves.shape).toBe('card');
    expect(realistic.apply(withLeaves('lobed')).materials.leaf.map).toBe('realistic/leaf.png');
    expect(realistic.apply(withLeaves('scale')).materials.leaf.map).toBe('realistic/needles.png');
    for (const type of BARK_TYPES) {
      const bark = realistic.apply({ ...testOak, bark: { type, color: '#806040' } }).materials.bark;
      expect(bark).toMatchObject({ type, color: '#806040', map: 'realistic/bark.png', normalMap: 'realistic/bark-normal.png' });
    }
  });

  it('every Style uses the Species bark colour and more foliage for a denser Species', () => {
    for (const style of Object.values(styles)) {
      expect(style.apply(testOak).materials.bark.color).toBe('#6e5a48');
      const sparse = style.apply({ ...testOak, foliage: { ...testOak.foliage, density: 0.25 } }).leaves.count;
      const dense = style.apply({ ...testOak, foliage: { ...testOak.foliage, density: 1 } }).leaves.count;
      expect(dense).toBeGreaterThan(sparse);
    }
  });

  it('the Definition remembers its Species, Leaf Type and Bark Type, and keeps the shape as authored', () => {
    const d = realistic.apply(testOak);
    expect(d.species).toBe('test-oak');
    expect(d.name).toBe('Test oak');
    expect(d.leaves.type).toBe('lobed');
    expect(d.materials.bark.type).toBe('plated');
    expect(d.trunk).toMatchObject(testOak.trunk);
    expect(d.branches[0]).toMatchObject(testOak.branches[0]!);
    expect(d.season).toEqual(testOak.season);
    expect(d.wind).toEqual(testOak.wind);
  });

  it('the remembered labels never change geometry by themselves', () => {
    const d = lowPoly.apply(testOak);
    const unlabelled = structuredClone(d);
    delete unlabelled.species;
    delete unlabelled.leaves.type;
    delete unlabelled.materials.bark.type;
    expect(hashTreeData(generateTree(parseDefinition(unlabelled), 3))).toBe(hashTreeData(generateTree(d, 3)));
  });
});

describe('Style.apply on a Tree Definition re-applies only the look', () => {
  const shapeOf = (d: ReturnType<typeof parseDefinition>) => ({
    trunk: { ...d.trunk, sides: 0, sections: 0 },
    branches: d.branches.map((b) => ({ ...b, sides: 0, sections: 0 })),
    season: d.season,
    wind: d.wind,
    variation: d.variation,
    sculpts: d.sculpts,
    species: d.species,
    name: d.name,
  });

  it('keeps shape fields (trunk, branches, Crown Shape, Season, Sculpts) and replaces the look', () => {
    const edited = extendDefinition(lowPoly.apply(testOak), {
      trunk: { length: 5.5 },
      season: { blossom: [{ t: 0, value: 0.5 }] },
    });
    const withSculpt = { ...edited, sculpts: [{ action: 'delete' as const, seed: 7, path: '0.1' }] };
    for (const style of Object.values(styles)) {
      const restyled = style.apply(withSculpt);
      expect(shapeOf(restyled)).toEqual(shapeOf(withSculpt));
      expect(restyled.branches[0]!.lengthProfile).toEqual(testOak.branches[0]!.lengthProfile);
      // The look is exactly what the Style gives the Species.
      const fresh = style.apply(testOak);
      expect(restyled.materials).toEqual(fresh.materials);
      expect(restyled.leaves).toEqual(fresh.leaves);
      expect(restyled.trunk.sides).toBe(fresh.trunk.sides);
      expect(restyled.branches.map((b) => b.sections)).toEqual(fresh.branches.map((b) => b.sections));
    }
  });

  it('switching Style there and back gives the same Definition', () => {
    for (const style of [stylized, realistic]) {
      expect(lowPoly.apply(style.apply(lowPoly.apply(testFir)))).toEqual(lowPoly.apply(testFir));
    }
  });

  it('re-styles a generic Style Definition without a Leaf Type, keeping needles for a conifer', () => {
    const fromLowPoly = realistic.apply(lowPoly.conifer);
    expect(fromLowPoly.leaves.type).toBe('needle');
    expect(fromLowPoly.materials.leaf.map).toBe('realistic/needles.png');
    expect(fromLowPoly.trunk.length).toBe(lowPoly.conifer.trunk.length);
    expect(stylized.apply(realistic.broadleaf).leaves.type).toBe('broad');
  });

  it('does not mutate its input', () => {
    const before = structuredClone(lowPoly.broadleaf);
    realistic.apply(lowPoly.broadleaf, { trunk: { length: 9 } });
    realistic.apply(testOak);
    expect(lowPoly.broadleaf).toEqual(before);
  });
});

describe('Style.apply overrides', () => {
  it('merge on top like extendDefinition', () => {
    const d = lowPoly.apply(testOak, { trunk: { length: 8 }, leaves: { angle: 60 } });
    expect(d.trunk.length).toBe(8);
    expect(d.trunk.radius).toBe(testOak.trunk.radius);
    expect(d.leaves.angle).toBe(60);
    expect(d.leaves.shape).toBe('clump');
    expect(d).toEqual(extendDefinition(lowPoly.apply(testOak), { trunk: { length: 8 }, leaves: { angle: 60 } }));
  });

  it('are validated like any Definition', () => {
    expect(() => lowPoly.apply(testOak, { trunk: { length: -1 } })).toThrow(/trunk\.length/);
  });
});

describe('createTree(style.apply(species), { seed })', () => {
  it('grows a deterministic tree in every Style', () => {
    for (const style of Object.values(styles)) {
      const a = createTree(style.apply(testOak), { seed: 42 });
      const b = createTree(style.apply(testOak), { seed: 42 });
      expect(hashTreeData(a.data)).toBe(hashTreeData(b.data));
      expect(a.data.skeleton.leaves.length).toBeGreaterThan(10);
      a.dispose();
      b.dispose();
    }
  });
});
