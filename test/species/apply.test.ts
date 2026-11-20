import { describe, expect, it } from 'vitest';
import { BARK_TYPES, createTree, extendDefinition, hashTreeData, LEAF_TYPES, parseDefinition, SEASON_PROFILES, TreeDefinitionError, type SpeciesDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';
import lowPoly from '../../src/styles/low-poly';
import stylized from '../../src/styles/stylized';
import realistic from '../../src/styles/realistic';
import painterly from '../../src/styles/painterly';

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

  it('realistic: an alpha-cut card texture per Leaf Type and a colour + normal pair per Bark Type', () => {
    const leafMaps = {
      broad: 'realistic/leaf.png',
      lobed: 'realistic/leaf-lobed.png',
      palmate: 'realistic/leaf-palmate.png',
      compound: 'realistic/leaf-compound.png',
      needle: 'realistic/needles.png',
      scale: 'realistic/scale.png',
    };
    for (const type of LEAF_TYPES) {
      const d = realistic.apply(withLeaves(type));
      expect(d.leaves.shape).toBe('card');
      expect(d.materials.leaf.map, type).toBe(leafMaps[type]);
    }
    const barkMaps = {
      furrowed: ['realistic/bark.png', 'realistic/bark-normal.png'],
      smooth: ['realistic/bark-smooth.png', 'realistic/bark-smooth-normal.png'],
      papery: ['realistic/bark-papery.png', 'realistic/bark-papery-normal.png'],
      fibrous: ['realistic/bark-fibrous.png', 'realistic/bark-fibrous-normal.png'],
      plated: ['realistic/bark-plated.png', 'realistic/bark-plated-normal.png'],
    };
    for (const type of BARK_TYPES) {
      const bark = realistic.apply({ ...testOak, bark: { type, color: '#806040' } }).materials.bark;
      const [map, normalMap] = barkMaps[type];
      expect(bark).toMatchObject({ type, color: '#806040', map, normalMap });
    }
  });

  it('realistic: re-styling a Definition picks the texture for its (new) Leaf and Bark Type', () => {
    const oak = realistic.apply(testOak);
    const birch = realistic.apply(extendDefinition(oak, { leaves: { type: 'broad' }, materials: { bark: { type: 'papery' } } }));
    expect(birch.materials.leaf.map).toBe('realistic/leaf.png');
    expect(birch.materials.bark).toMatchObject({ map: 'realistic/bark-papery.png', normalMap: 'realistic/bark-papery-normal.png' });
  });

  it('painterly: Leaf Masses of a painted spray card per Leaf Type; conifer foliage in more, flatter, layered masses (ADR 0014)', () => {
    for (const type of LEAF_TYPES) {
      const d = painterly.apply(withLeaves(type));
      expect(d.leaves.shape, type).toBe('mass');
      expect(d.materials.leaf, type).toMatchObject({ map: `painterly/spray-${type}.png`, alphaTest: 0.5 });
      const needleLike = type === 'needle' || type === 'scale';
      // Broadleaf crowns: a few round masses; needle / scale crowns: 10-12 wide, flat masses in layers (#113).
      expect(d.leaves.masses ?? 8, type).toBe(needleLike ? 12 : 8);
      expect(d.leaves.massLayering ?? 1, type).toBe(needleLike ? 1.8 : 1);
    }
    expect(painterly.apply(testOak).materials.shading).toBe('painted');
  });

  it('painterly: smooth painted bark per Bark Type (a colour texture, no normal map), tinted by the Species colour', () => {
    for (const type of BARK_TYPES) {
      const bark = painterly.apply({ ...testOak, bark: { type, color: '#806040' } }).materials.bark;
      expect(bark).toMatchObject({ type, color: '#806040', map: `painterly/bark-${type}.png`, normalMap: null });
    }
  });

  it('painterly: re-styling a Definition from another Style picks the sprays and masses of its Leaf Type', () => {
    expect(painterly.apply(realistic.apply(testFir)).leaves).toEqual(painterly.apply(testFir).leaves);
    expect(painterly.apply(realistic.apply(testOak)).leaves).toEqual(painterly.apply(testOak).leaves);
    // And back: other Styles do not keep the Leaf Masses.
    expect(realistic.apply(painterly.apply(testFir)).leaves).not.toHaveProperty('masses');
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

describe('Style.apply draws Fruit the Style\'s way', () => {
  const withFruit = (type: 'round' | 'pear' | 'nut' | 'cone' | 'berry'): SpeciesDefinition => ({
    ...testOak,
    fruit: { type, count: 1, size: 0.2, sizeVariation: 0.1, hang: 0.8 },
  });
  const trianglesPerFruit = (definition: ReturnType<typeof parseDefinition>) => {
    const data = generateTree(definition, 1);
    return data.fruit.indices.length / 3 / data.skeleton.fruit.length;
  };

  it('low-poly: a few flat facets; stylized smoother; realistic smoothest', () => {
    for (const type of ['round', 'pear', 'nut', 'cone', 'berry'] as const) {
      const [low, toon, pbr] = [lowPoly, stylized, realistic].map((style) => trianglesPerFruit(style.apply(withFruit(type))));
      expect(low, type).toBeLessThanOrEqual(24);
      expect(low, type).toBeLessThan(toon!);
      expect(toon, type).toBeLessThanOrEqual(pbr!);
    }
  });

  it('keeps the Species\' Fruit (type, count, size, hang) and a fractional count', () => {
    const species = { ...withFruit('cone'), fruit: { type: 'cone' as const, count: 0.35, size: 0.2, sizeVariation: 0.1, hang: 0.8 } };
    for (const style of Object.values(styles)) expect(style.apply(species).fruit).toMatchObject(species.fruit);
  });

  it('re-styling a Definition with Fruit redraws its Fruit in the new Style', () => {
    const definition = lowPoly.apply(withFruit('round'));
    expect(realistic.apply(definition).fruit).toEqual(realistic.apply(withFruit('round')).fruit);
  });

  it('a Species without Fruit gets no Fruit block', () => {
    for (const style of Object.values(styles)) expect(style.apply(testOak)).not.toHaveProperty('fruit');
  });
});

describe('Style.apply draws the Root Flare the Style\'s way', () => {
  const flared = { ...testOak, trunk: { ...testOak.trunk, flare: 0.6 } };
  /** Rings of the trunk's sweep, Root Flare included (the trunk is the first part of the wood). */
  const trunkRings = (definition: ReturnType<typeof parseDefinition>) => {
    const { wood } = generateTree(definition, 1);
    let count = 0;
    while (wood.attributes.aLevel.array[count] === 0 && wood.attributes.aAlong.array[count]! < 1) count++;
    return count / (definition.trunk.sides + 1);
  };

  it('low-poly puts 2 extra rings in the flare, stylized and realistic 3', () => {
    expect(Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, style.apply(flared).trunk.flareSections]))).toEqual({
      'low-poly': 2,
      stylized: 3,
      realistic: 3,
    });
    for (const style of Object.values(styles)) {
      expect(trunkRings(style.apply(flared)) - trunkRings(style.apply(testOak))).toBe(style.apply(flared).trunk.flareSections);
    }
  });

  it('keeps the Species\' flare and re-styling a Definition redraws its flare in the new Style', () => {
    for (const style of Object.values(styles)) expect(style.apply(flared).trunk.flare).toBe(0.6);
    expect(realistic.apply(lowPoly.apply(flared)).trunk).toEqual(realistic.apply(flared).trunk);
  });
});

describe('Style.apply draws Roots the Style\'s way', () => {
  const rooted = { ...testOak, roots: { count: 4, length: 0.2, lengthVariation: 0.2, radius: 0.3, angle: 15, bend: 0.25 } };

  it('realistic gives Roots 8 sides and 6 sections, stylized 6 and 4, low-poly 3 and 2', () => {
    const detail = (style: (typeof styles)[keyof typeof styles]) => {
      const { sides, sections } = style.apply(rooted).roots!;
      return [sides, sections];
    };
    expect(Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, detail(style)]))).toEqual({
      'low-poly': [3, 2],
      stylized: [6, 4],
      realistic: [8, 6],
    });
    for (const style of Object.values(styles)) {
      const { skeleton } = generateTree(style.apply(rooted), 1);
      expect(skeleton.roots.map((root) => root.points.length - 1)).toEqual([...Array(4)].map(() => style.apply(rooted).roots!.sections));
    }
  });

  it('keeps the Species\' Roots; re-styling a Definition redraws its Roots in the new Style; no Roots, no block', () => {
    for (const style of Object.values(styles)) expect(style.apply(rooted).roots).toMatchObject(rooted.roots);
    expect(realistic.apply(lowPoly.apply(rooted)).roots).toEqual(realistic.apply(rooted).roots);
    for (const style of Object.values(styles)) expect(style.apply(testOak)).not.toHaveProperty('roots');
  });
});

describe('Style.apply on a Tree Definition re-applies only the look', () => {
  const shapeOf = (d: ReturnType<typeof parseDefinition>) => ({
    trunk: { ...d.trunk, sides: 0, sections: 0, flareSections: 0 },
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
