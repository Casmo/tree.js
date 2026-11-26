import { describe, expect, it } from 'vitest';
import { Mesh, type BufferGeometry } from 'three/webgpu';
import {
  bakeTree,
  createForest,
  createTree,
  hexToLinear,
  parseDefinition,
  TreeDefinitionError,
  type LeafPalette,
  type Tree,
  type TreeDefinitionInput,
} from '../src/index';

// A small tree keeps generation fast; leaves green in spring, brown in autumn.
const base: TreeDefinitionInput = {
  schemaVersion: 2,
  branches: [{ count: 3 }],
  leaves: { count: 3 },
  variation: { color: 0, growth: 0, season: 0 },
  season: {
    leafColor: [
      { t: 0, value: '#00ff00' },
      { t: 0.6, value: '#884400' },
    ],
    leafCoverage: [
      { t: 0, value: 1 },
      { t: 0.7, value: 1 },
      { t: 0.8, value: 0 },
    ],
    blossom: [{ t: 0, value: 0 }],
    blossomColor: '#ffffff',
  },
};

const PALETTES: LeafPalette[] = [
  { leafColor: [{ t: 0, value: '#ff0000' }, { t: 0.6, value: '#880000' }], accent: '#ffffff' },
  { leafColor: [{ t: 0, value: '#0000ff' }, { t: 0.6, value: '#000088' }], accent: '#ffff00' },
  { leafColor: [{ t: 0, value: '#ffff00' }, { t: 0.6, value: '#888800' }], accent: '#00ffff' },
];

const withPalettes: TreeDefinitionInput = { ...base, season: { ...base.season, leafPalettes: PALETTES } };

/** The baked leaves' vertex colours (linear), one `r,g,b` string per vertex, rounded. */
function bakedLeafColors(tree: Tree, season: number): string[] {
  const group = bakeTree(tree, { season });
  const leaves = group.getObjectByName('leaves');
  if (!(leaves instanceof Mesh)) return [];
  const color = (leaves.geometry as BufferGeometry).getAttribute('color');
  const out: string[] = [];
  for (let v = 0; v < color.count; v++) out.push([color.getX(v), color.getY(v), color.getZ(v)].map((c) => c.toFixed(4)).join(','));
  return out;
}

function linear(hex: string): string {
  return hexToLinear(hex).map((c) => c.toFixed(4)).join(',');
}

describe('Leaf Palettes in the Definition', () => {
  it('accepts an optional list of Leaf Palettes in the Season Profile', () => {
    const definition = parseDefinition(withPalettes);
    expect(definition.season.leafPalettes).toEqual(PALETTES);
  });

  it('stays absent when not given', () => {
    expect('leafPalettes' in parseDefinition(base).season).toBe(false);
  });

  it('rejects a Leaf Palette without an accent or with unsorted keyframes', () => {
    const noAccent = { ...base, season: { ...base.season, leafPalettes: [{ leafColor: [{ t: 0, value: '#ff0000' }] }] } };
    expect(() => parseDefinition(noAccent as TreeDefinitionInput)).toThrow(TreeDefinitionError);
    const unsorted = {
      ...base,
      season: { ...base.season, leafPalettes: [{ leafColor: [{ t: 0.5, value: '#ff0000' }, { t: 0.1, value: '#00ff00' }], accent: '#ffffff' }] },
    };
    expect(() => parseDefinition(unsorted as TreeDefinitionInput)).toThrow(/season\.leafPalettes\[0\]\.leafColor\[1\]\.t/);
    expect(() => parseDefinition({ ...base, season: { ...base.season, leafPalettes: [] } })).toThrow(TreeDefinitionError);
  });
});

describe('createTree with Leaf Palettes', () => {
  it('picks one palette per Seed, the same one every time', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = createTree(withPalettes, { seed });
      const b = createTree(withPalettes, { seed });
      expect(a.leafPalette).not.toBeNull();
      expect(PALETTES).toContainEqual(a.leafPalette);
      expect(b.leafPalette).toEqual(a.leafPalette);
    }
  });

  it('has no Leaf Palette without the field', () => {
    expect(createTree(base, { seed: 1 }).leafPalette).toBeNull();
  });

  it('draws the picked palette through the Season, with the Season timing unchanged', () => {
    for (const seed of [1, 2, 3]) {
      const plain = createTree(base, { seed });
      const tree = createTree(withPalettes, { seed });
      const palette = tree.leafPalette!;
      // Spring: the palette's first key; autumn: its second; winter: bare, as without palettes.
      for (const [season, key] of [
        [0, 0],
        [0.65, 1],
      ] as const) {
        const colors = bakedLeafColors(tree, season);
        expect(colors.length).toBe(bakedLeafColors(plain, season).length);
        expect(colors.length).toBeGreaterThan(0);
        expect(new Set(colors)).toEqual(new Set([linear(palette.leafColor[key]!.value)]));
      }
      expect(bakedLeafColors(tree, 0.9)).toEqual([]);
      expect(bakedLeafColors(plain, 0.9)).toEqual([]);
      // The leaf material's colour (what exporters see) is the palette's too.
      expect(`#${tree.leaves.material.color.getHexString()}`).toBe(palette.leafColor[0]!.value);
    }
  });

  it('gives different trees different palettes', () => {
    const picked = new Set<string>();
    for (let seed = 0; seed < 30; seed++) picked.add(createTree(withPalettes, { seed }).leafPalette!.accent);
    expect(picked.size).toBe(PALETTES.length);
  });

  it('keeps the geometry of a Definition without palettes', () => {
    const plain = createTree(base, { seed: 7 });
    const tree = createTree(withPalettes, { seed: 7 });
    expect(tree.data.leaves.positions).toEqual(plain.data.leaves.positions);
    expect(tree.data.leaves.colors).toEqual(plain.data.leaves.colors);
    expect(tree.data.wood.positions).toEqual(plain.data.wood.positions);
  });
});

describe('a Forest with Leaf Palettes', () => {
  it('shows several leaf colours from one Definition', () => {
    const placements = Array.from({ length: 24 }, (_, i) => ({ position: [i * 3, 0, 0] as [number, number, number] }));
    const forest = createForest(withPalettes, placements, { variants: 8, seed: 3 });
    const colors = new Set(forest.variants.map((v) => `#${v.leafMaterial.color.getHexString()}`));
    expect(colors.size).toBeGreaterThan(1);
    for (const variant of forest.variants) {
      // A Variant is one Seed's tree: it picks the palette that Seed picks in createTree.
      expect(variant.leafPalette).toEqual(createTree(withPalettes, { seed: variant.seed }).leafPalette);
      expect(`#${variant.leafMaterial.color.getHexString()}`).toBe(variant.leafPalette!.leafColor[0]!.value);
    }
    forest.dispose();
  });

  it('has no palettes without the field', () => {
    const forest = createForest(base, [{ position: [0, 0, 0] }], { variants: 2 });
    expect(forest.variants.map((v) => v.leafPalette)).toEqual([null, null]);
    expect(forest.variants.every((v) => `#${v.leafMaterial.color.getHexString()}` === '#00ff00')).toBe(true);
    forest.dispose();
  });
});
