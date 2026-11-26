import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createForest,
  createTree,
  evaluateSeason,
  extendDefinition,
  hashTreeData,
  loadStyle,
  parseDefinition,
  STYLE_NAMES,
  styleLabel,
  styleOfShading,
  type TreeDefinition,
} from '../../src/index';
import { generateTree } from '../../src/generator';
import { loadSpecies, oak, SPECIES_NAMES } from '../../src/species';
import stylized from '../../src/styles/stylized';
import whimsical from '../../src/styles/whimsical';

const enchanted = await import('../../src/styles/enchanted');

describe('enchanted Style: registration', () => {
  it('is a built-in Style labelled "Enchanted", drawn with the enchanted shading', async () => {
    expect(STYLE_NAMES).toContain('enchanted');
    expect(styleLabel('enchanted')).toBe('Enchanted');
    expect(styleOfShading('enchanted')).toBe('enchanted');
    expect(await loadStyle('enchanted')).toBe(enchanted.default);
    expect(enchanted.default).toMatchObject({ name: 'enchanted', broadleaf: enchanted.broadleaf, conifer: enchanted.conifer });
  });

  it('the enchanted shading round-trips through the schema', () => {
    const definition = parseDefinition({ schemaVersion: 3, materials: { shading: 'enchanted' } });
    expect(definition.materials.shading).toBe('enchanted');
  });

  it('apply(oak) gives a valid Definition that grows a tree with alpha-cut cards', () => {
    const definition = enchanted.default.apply(oak);
    expect(parseDefinition(definition)).toEqual(definition);
    expect(definition.materials.shading).toBe('enchanted');
    expect(definition.leaves.shape).toBe('card');
    expect(definition.materials.leaf.map).toMatch(/^enchanted\//);
    expect(definition.materials.bark.map).toMatch(/^enchanted\//);
    const tree = createTree(definition, { seed: 1 });
    expect(tree.data.skeleton.leaves.length).toBeGreaterThan(10);
    tree.dispose();
  });

  it('is published as its own subpath, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/enchanted']).toEqual({
      types: './dist/styles/enchanted/index.d.ts',
      import: './dist/styles/enchanted.js',
    });
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toMatch(/'styles\/enchanted': resolve\(.*src\/styles\/enchanted\/index\.ts'\)/);
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/enchanted/);
  });
});

describe('enchanted.apply: the Snake Twist recipe (ADR 0017)', () => {
  const snake = { twistStyle: 'snake', spin: 'random', twistCurve: 0 };

  it.each(SPECIES_NAMES)('%s: snakes on every level, milder on a conifer trunk', async (id) => {
    const species = await loadSpecies(id);
    const definition = enchanted.default.apply(species);
    const conifer = species.form === 'conifer';
    expect(definition.trunk).toMatchObject({ ...snake, twist: conifer ? 0.3 : 0.5, twists: 3 });
    definition.branches.forEach((level, i) => {
      expect(level, `level ${i + 1}`).toMatchObject({ ...snake, followTwist: false });
      expect(level).toMatchObject(i === 0 ? { twist: 0.8, twists: 4 } : { twist: 0.6, twists: 3 });
    });
  });

  it.each(SPECIES_NAMES)('%s: keeps its Crown Shape, branch counts, Fruit, Roots and Root Flare', async (id) => {
    const species = await loadSpecies(id);
    const definition = enchanted.default.apply(species);
    expect(definition.branches).toHaveLength(species.branches.length);
    species.branches.forEach((level, i) => {
      const { count, start, end, angle, length, lengthProfile, angleProfile } = level;
      expect(definition.branches[i]).toMatchObject({ count, start, end, angle, length, ...(lengthProfile && { lengthProfile }), ...(angleProfile && { angleProfile }) });
    });
    expect(definition.trunk).toMatchObject({ length: species.trunk.length, radius: species.trunk.radius, flare: species.trunk.flare });
    if (species.fruit) expect(definition.fruit).toMatchObject(species.fruit);
    if (species.roots) expect(definition.roots).toMatchObject(species.roots);
  });

  it('overwrites a source Twist (a Whimsical Corkscrew becomes the Snake recipe)', () => {
    expect(enchanted.default.apply(whimsical.apply(oak)).trunk).toMatchObject({ twist: 0.5, twists: 3, twistStyle: 'snake', spin: 'random', twistCurve: 0 });
  });

  it('the same Definition and Seed always grow the same tree; other Seeds snake differently', () => {
    const definition = enchanted.default.apply(oak);
    const hash = (seed: number) => hashTreeData(generateTree(parseDefinition(definition), seed));
    expect(hash(5)).toBe(hash(5));
    expect(new Set([1, 2, 3, 4].map(hash)).size).toBe(4);
  });
});

/** Hue in degrees (0..360) of a linear RGB colour. */
function hue([r, g, b]: readonly number[]): number {
  const max = Math.max(r!, g!, b!);
  const d = max - Math.min(r!, g!, b!);
  if (d === 0) return 0;
  const h = max === r ? ((g! - b!) / d) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
  return (h * 60 + 360) % 360;
}
const isTeal = (c: readonly number[]) => hue(c) > 160 && hue(c) < 215;
const isMagentaOrViolet = (c: readonly number[]) => hue(c) > 265 && hue(c) < 335;

describe('enchanted.apply: colours from the Style, Season timing from the source', () => {
  const paletteAt = (definition: TreeDefinition, palette: number, season: number) =>
    evaluateSeason({ ...definition.season, leafColor: definition.season.leafPalettes![palette]!.leafColor }, season).leafColor;

  it.each(SPECIES_NAMES)("%s: keeps the Species' leaf coverage, blossom and Fruit timing", async (id) => {
    const species = await loadSpecies(id);
    const { season } = enchanted.default.apply(species);
    expect(season.leafCoverage).toEqual(species.season.leafCoverage);
    expect(season.blossom).toEqual(species.season.blossom);
    expect(season.blossomColor).toEqual(species.season.blossomColor);
    if (species.season.fruit) expect(season.fruit).toEqual(species.season.fruit);
  });

  it('writes 2-3 close Leaf Palettes; the first is also the Season leaf colour', () => {
    const { season } = enchanted.default.apply(oak);
    expect(season.leafPalettes!.length).toBeGreaterThanOrEqual(2);
    expect(season.leafPalettes!.length).toBeLessThanOrEqual(3);
    expect(season.leafColor).toEqual(season.leafPalettes![0]!.leafColor);
  });

  it('deciduous leaves are teal all summer and turn magenta / violet in autumn, timed to the Species', () => {
    // Oak: leaves fully out at Season 0.1, falling from 0.62, bare at 0.78.
    const definition = enchanted.default.apply(oak);
    definition.season.leafPalettes!.forEach((_, i) => {
      for (const t of [0.15, 0.4, 0.62]) expect(isTeal(paletteAt(definition, i, t)), `palette ${i} at ${t}`).toBe(true);
      expect(isMagentaOrViolet(paletteAt(definition, i, 0.75)), `palette ${i} in autumn`).toBe(true);
    });
  });

  it.each(['douglas-fir', 'pine', 'cedar'] as const)('%s (evergreen) stays teal all year', async (id) => {
    const definition = enchanted.default.apply(await loadSpecies(id));
    definition.season.leafPalettes!.forEach((_, i) => {
      for (let t = 0; t <= 1; t += 0.05) expect(isTeal(paletteAt(definition, i, t)), `palette ${i} at ${t}`).toBe(true);
    });
  });

  it("paints the bark deep indigo / violet, whatever the Species' bark colour", () => {
    const indigo = enchanted.default.apply(oak).materials.bark.color;
    expect(enchanted.default.apply({ ...oak, bark: { ...oak.bark, color: '#f0f0f0' } }).materials.bark.color).toBe(indigo);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(indigo.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!)).toBeLessThan(110); // deep
    expect(b!).toBeGreaterThan(r!); // blue-violet
    expect(b!).toBeGreaterThan(g!);
  });

  it('the same Seed always picks the same Leaf Palette, and a Forest of one Species shows several', () => {
    const definition = enchanted.default.apply(oak);
    expect(createTree(definition, { seed: 9 }).leafPalette).toEqual(createTree(definition, { seed: 9 }).leafPalette);
    const forest = createForest(definition, [{ position: [0, 0, 0] }], { variants: 8, seed: 1 });
    expect(new Set(forest.variants.map((v) => v.leafPalette!.accent)).size).toBeGreaterThanOrEqual(2);
    forest.dispose();
  });
});

describe('Inner Glow in a Definition', () => {
  it('Enchanted writes it; it can be tuned and validates', () => {
    const definition = enchanted.default.apply(oak);
    expect(definition.materials.innerGlow).toEqual({ leaf: 1, veins: 1 });
    expect(enchanted.default.apply(oak, { materials: { innerGlow: { leaf: 2.5 } } }).materials.innerGlow).toEqual({ leaf: 2.5, veins: 1 });
    expect(parseDefinition({ schemaVersion: 3, materials: { innerGlow: { veins: 0.2 } } }).materials.innerGlow).toEqual({ leaf: 1, veins: 0.2 });
    expect(() => parseDefinition({ schemaVersion: 3, materials: { innerGlow: { leaf: -1 } } })).toThrow();
  });

  it('a Definition without it has none', () => {
    expect(parseDefinition({ schemaVersion: 3 }).materials.innerGlow).toBeUndefined();
    expect(stylized.apply(oak).materials.innerGlow).toBeUndefined();
  });
});

describe('re-styling an Enchanted Definition (ADR 0017)', () => {
  const twistOf = (d: TreeDefinition) => ({
    trunk: [d.trunk.twist, d.trunk.twists, d.trunk.twistStyle, d.trunk.spin, d.trunk.twistCurve],
    branches: d.branches.map((b) => [b.twist, b.twists, b.twistStyle, b.spin, b.twistCurve, b.followTwist]),
  });
  const fantasyOf = (d: TreeDefinition) => ({ twist: twistOf(d), season: d.season, bark: d.materials.bark.color, innerGlow: d.materials.innerGlow });
  // A leaf count round-trips through a Style with few leaves per density (puffs) only up to rounding.
  const roughly = (d: TreeDefinition) => ({ ...d, leaves: { ...d.leaves, count: Math.round(d.leaves.count / 4) } });

  it.each(['low-poly', 'stylized', 'realistic', 'painterly'] as const)(
    'to %s keeps its Twist, Leaf Palettes, Season leaf colours, bark colour and Inner Glow',
    async (name) => {
      const drawn = enchanted.default.apply(oak, { materials: { innerGlow: { leaf: 1.7, veins: 0.4 } } });
      const restyled = (await loadStyle(name)).apply(drawn);
      expect(restyled.materials.shading).not.toBe('enchanted');
      expect(fantasyOf(restyled)).toEqual(fantasyOf(drawn));
    },
  );

  it('back to Enchanted gives the Enchanted tree again (it recognises the enchanted shading)', async () => {
    const drawn = enchanted.default.apply(oak);
    for (const name of ['realistic'] as const) {
      expect(enchanted.default.apply((await loadStyle(name)).apply(drawn))).toEqual(drawn);
    }
    expect(roughly(enchanted.default.apply(stylized.apply(drawn)))).toEqual(roughly(drawn));
    expect(enchanted.default.apply(drawn)).toEqual(drawn);
    // Its cards map back to the Species' foliage.
    expect(stylized.apply(drawn).leaves.size).toBeCloseTo(stylized.apply(oak).leaves.size, 9);
  });

  it('switching to Whimsical replaces its Twist, palettes and glow (Whimsical has no Inner Glow)', () => {
    const drawn = extendDefinition(enchanted.default.apply(oak), { trunk: { twist: 0.9 } });
    expect(roughly(whimsical.apply(drawn))).toEqual(roughly(whimsical.apply(oak)));
    expect(whimsical.apply(drawn).materials.innerGlow).toBeUndefined();
  });

  it('switching from Whimsical to Enchanted replaces them with the Enchanted ones', () => {
    expect(roughly(enchanted.default.apply(whimsical.apply(oak)))).toEqual(roughly(enchanted.default.apply(oak)));
  });

  it('a conifer Definition gets the milder conifer recipe (recognised by its Leaf Type)', async () => {
    const fir = await loadSpecies('douglas-fir');
    const realistic = await loadStyle('realistic');
    expect(enchanted.default.apply(realistic.apply(fir))).toEqual(enchanted.default.apply(fir));
    expect(enchanted.default.apply(enchanted.default.conifer).trunk.twist).toBe(0.3);
  });
});

describe('the enchanted shading and its Inner Glow', () => {
  const fruit = { type: 'round' as const, count: 2, size: 0.15, sizeVariation: 0.1, hang: 0.7 };

  it.each(['broadleaf', 'conifer'] as const)('the %s showpiece: bark, leaves and Fruit are enchanted materials, in a Tree and a Forest', (form) => {
    const definition = { ...enchanted[form], fruit };
    const tree = createTree(definition, { seed: 1 });
    const forest = createForest(definition, [{ position: [0, 0, 0] }], { variants: 1, seed: 1 });
    const variant = forest.variants[0]!;
    for (const material of [tree.wood.material, tree.leaves.material, tree.fruit.material, variant.barkMaterial, variant.leafMaterial, variant.fruitMaterial]) {
      expect(material).toMatchObject({ isEnchantedMaterial: true, flatShading: false });
    }
    tree.dispose();
    forest.dispose();
  });

  it('glows with no light: the leaves and bark veins shine by themselves (emissive), the Fruit does not', () => {
    const tree = createTree(enchanted.broadleaf, { seed: 1 });
    expect(tree.innerGlow).toEqual({ leaf: 1, veins: 1 });
    expect(tree.leaves.material.emissiveNode).not.toBeNull();
    expect((tree.wood.material as unknown as { emissiveNode: unknown }).emissiveNode).not.toBeNull();
    expect(tree.fruit.material.emissiveNode).toBeNull();
    tree.dispose();
    const forest = createForest(enchanted.broadleaf, [{ position: [0, 0, 0] }], { variants: 1, seed: 1 });
    expect(forest.variants[0]!.innerGlow).toEqual({ leaf: 1, veins: 1 });
    expect(forest.variants[0]!.leafMaterial.emissiveNode).not.toBeNull();
    expect(forest.variants[0]!.barkMaterial.emissiveNode).not.toBeNull();
    forest.dispose();
  });

  it('can be tuned live on a Tree', () => {
    const tree = createTree(enchanted.broadleaf, { seed: 1 });
    tree.innerGlow = { veins: 0.3 };
    expect(tree.innerGlow).toEqual({ leaf: 1, veins: 0.3 });
    tree.dispose();
  });

  it('only the enchanted shading draws it: other shadings ignore it, and without it nothing glows', () => {
    const glowing = stylized.apply(enchanted.broadleaf);
    expect(glowing.materials.innerGlow).toBeDefined();
    const restyled = createTree(glowing, { seed: 1 });
    expect(restyled.innerGlow).toBeNull();
    expect(restyled.leaves.material.emissiveNode).toBeNull();
    restyled.dispose();
    const materials = { ...enchanted.broadleaf.materials };
    delete materials.innerGlow;
    const plain = createTree({ ...enchanted.broadleaf, materials }, { seed: 1 });
    expect(plain.innerGlow).toBeNull();
    expect(plain.leaves.material.emissiveNode).toBeNull();
    expect(plain.wood.material).toMatchObject({ isEnchantedMaterial: true, emissiveNode: null });
    plain.dispose();
  });
});

describe('the Enchanted suggestions', () => {
  it('Tree Effects: no outline, a teal Leaf Glow and a cool blue-violet grade', async () => {
    const { SUGGESTED_TREE_EFFECTS } = await import('../../src/effects');
    const { outline, glow, grade } = SUGGESTED_TREE_EFFECTS.enchanted;
    expect(outline).toBeUndefined();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(glow!.color).slice(i, i + 2), 16));
    expect(isTeal([r!, g!, b!])).toBe(true);
    const tint = [1, 3, 5].map((i) => parseInt(String(grade!.tint).slice(i, i + 2), 16));
    expect(tint[2]!).toBeGreaterThan(tint[1]!); // cool
    expect(tint[2]!).toBeGreaterThan(tint[0]! - 1); // blue-violet
  });

  it('Scene Effects: a strong, low-threshold bloom and a violet ground mist', async () => {
    const { SUGGESTED_SCENE_EFFECTS } = await import('../../src/scene');
    const { bloom, fog } = SUGGESTED_SCENE_EFFECTS.enchanted;
    for (const style of ['stylized', 'realistic', 'whimsical'] as const) {
      expect(bloom!.strength!).toBeGreaterThan(SUGGESTED_SCENE_EFFECTS[style].bloom!.strength! * 3);
      expect(bloom!.threshold!).toBeLessThan(SUGGESTED_SCENE_EFFECTS[style].bloom!.threshold!);
    }
    expect(fog!.mist).toBeTruthy();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(fog!.color).slice(i, i + 2), 16));
    expect(isMagentaOrViolet([r!, g!, b!])).toBe(true);
  });

  it('Material Features: Leaf Translucency on', async () => {
    const { SUGGESTED_MATERIAL_FEATURES } = await import('../../src/index');
    expect(SUGGESTED_MATERIAL_FEATURES.enchanted.translucency).toBeDefined();
  });
});

describe('the Enchanted showpieces', () => {
  const forms = { broadleaf: enchanted.broadleaf, conifer: enchanted.conifer };

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition at real size, in the Style's colours, shading and Inner Glow`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
      expect(definition.styleScale).toBeUndefined();
      expect(definition.trunk.length).toBeGreaterThan(4);
      expect(definition.materials.shading).toBe('enchanted');
      expect(definition.materials.innerGlow).toBeDefined();
      expect(definition.season.leafPalettes!.length).toBeGreaterThanOrEqual(2);
      expect(definition.leaves.shape).toBe('card');
    });

    it(`${form}: snakes on every level`, () => {
      expect(definition.trunk.twistStyle).toBe('snake');
      for (const level of definition.branches) expect(level).toMatchObject({ twistStyle: 'snake', followTwist: false });
    });

    it(`${form}: matches the golden geometry hash (determinism across releases)`, () => {
      expect(hashTreeData(generateTree(parseDefinition(definition), 42))).toMatchSnapshot();
    });
  }

  it('the broadleaf is ancient and wide: several snaking Stems on Roots, long low boughs', () => {
    const { trunk, branches, roots } = enchanted.broadleaf;
    expect(trunk.stems!).toBeGreaterThanOrEqual(2);
    expect(roots!.count).toBeGreaterThanOrEqual(4);
    expect(branches[0]!.start).toBeLessThanOrEqual(0.35);
    expect(branches[0]!.length).toBeGreaterThanOrEqual(0.7);
  });

  it('the conifer is a slim spire with drooping branches', () => {
    const { trunk, branches } = enchanted.conifer;
    expect(trunk.length / trunk.radius).toBeGreaterThan(30);
    expect(branches[0]!.angle).toBeGreaterThan(90);
    expect(branches[0]!.gravity).toBeGreaterThan(0.2);
  });
});
