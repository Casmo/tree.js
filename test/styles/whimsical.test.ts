import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createForest,
  createTree,
  extendDefinition,
  evaluateSeason,
  hashTreeData,
  loadStyle,
  parseDefinition,
  STYLE_NAMES,
  styleLabel,
  styleOfShading,
  SUGGESTED_MATERIAL_FEATURES,
  type TreeDefinition,
} from '../../src/index';
import { SUGGESTED_TREE_EFFECTS } from '../../src/effects';
import { SUGGESTED_SCENE_EFFECTS } from '../../src/scene';
import { generateTree } from '../../src/generator';
import { coneCurve } from '../../src/definition/crown-shape';
import { loadSpecies, oak, SPECIES_NAMES } from '../../src/species';
import stylized from '../../src/styles/stylized';

const whimsical = await import('../../src/styles/whimsical');

describe('whimsical Style: registration', () => {
  it('is a built-in Style labelled "Whimsical", drawn with the whimsical shading', async () => {
    expect(STYLE_NAMES).toContain('whimsical');
    expect(styleLabel('whimsical')).toBe('Whimsical');
    expect(styleOfShading('whimsical')).toBe('whimsical');
    expect(await loadStyle('whimsical')).toBe(whimsical.default);
    expect(whimsical.default).toMatchObject({ name: 'whimsical', broadleaf: whimsical.broadleaf, conifer: whimsical.conifer });
  });

  it('the whimsical shading round-trips through the schema', () => {
    const definition = parseDefinition({ schemaVersion: 3, materials: { shading: 'whimsical' } });
    expect(definition.materials.shading).toBe('whimsical');
  });

  it('apply(oak) gives a valid Definition that grows a tree with puffs', () => {
    const definition = whimsical.default.apply(oak);
    expect(parseDefinition(definition)).toEqual(definition);
    expect(definition.materials.shading).toBe('whimsical');
    expect(definition.leaves.shape).toBe('puff');
    const tree = createTree(definition, { seed: 1 });
    expect(tree.data.skeleton.leaves.length).toBeGreaterThan(10);
    tree.dispose();
  });

  it('is published as its own subpath, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/whimsical']).toEqual({
      types: './dist/styles/whimsical/index.d.ts',
      import: './dist/styles/whimsical.js',
    });
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toMatch(/'styles\/whimsical': resolve\(.*src\/styles\/whimsical\/index\.ts'\)/);
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/whimsical/);
  });
});

describe('whimsical.apply: the Corkscrew Twist recipe (ADR 0017)', () => {
  const corkscrew = { twistStyle: 'corkscrew', spin: 'random' };

  it.each(SPECIES_NAMES)('%s: corkscrews on every level with Follow Twist, milder for a conifer', async (id) => {
    const species = await loadSpecies(id);
    const definition = whimsical.default.apply(species);
    const conifer = species.form === 'conifer';
    expect(definition.trunk).toMatchObject({ ...corkscrew, twist: conifer ? 0.25 : 0.45, twists: 2 });
    expect(definition.trunk.twistCurve).toBe(conifer ? 0.1 : 0.35);
    definition.branches.forEach((level, i) => {
      expect(level, `level ${i + 1}`).toMatchObject({ ...corkscrew, followTwist: true });
      if (i === 0) expect(level).toMatchObject({ twist: 0.6, twists: 2, twistCurve: conifer ? 0.2 : 0.5 });
      else expect(level).toMatchObject({ twist: 0.5, twists: 1 });
    });
  });

  it.each(SPECIES_NAMES)('%s: keeps its Crown Shape, branch counts, Fruit, Roots and Root Flare', async (id) => {
    const species = await loadSpecies(id);
    const definition = whimsical.default.apply(species);
    expect(definition.branches).toHaveLength(species.branches.length);
    species.branches.forEach((level, i) => {
      const { count, start, end, angle, length, lengthProfile, angleProfile } = level;
      expect(definition.branches[i]).toMatchObject({ count, start, end, angle, length, ...(lengthProfile && { lengthProfile }), ...(angleProfile && { angleProfile }) });
    });
    expect(definition.trunk).toMatchObject({ length: species.trunk.length, radius: species.trunk.radius, flare: species.trunk.flare });
    if (species.fruit) expect(definition.fruit).toMatchObject(species.fruit);
    if (species.roots) expect(definition.roots).toMatchObject(species.roots);
  });

  it('overwrites a source Twist (a Snake Definition becomes the Corkscrew recipe)', () => {
    const snaking = stylized.apply(oak, { trunk: { twist: 1, twists: 5, twistStyle: 'snake', spin: 'clockwise', twistCurve: 0.9 } });
    expect(whimsical.default.apply(snaking).trunk).toMatchObject({ twist: 0.45, twists: 2, twistStyle: 'corkscrew', spin: 'random', twistCurve: 0.35 });
  });

  it('the same Definition and Seed always grow the same tree; other Seeds swirl differently', () => {
    const definition = whimsical.default.apply(oak);
    const hash = (seed: number) => hashTreeData(generateTree(parseDefinition(definition), seed));
    expect(hash(5)).toBe(hash(5));
    expect(new Set([1, 2, 3, 4].map(hash)).size).toBe(4);
  });
});

describe('whimsical.apply: colours from the Style, Season timing from the source', () => {
  /** Saturation (0..1) and warmth (red minus blue) of a linear RGB colour. */
  const saturation = ([r, g, b]: readonly number[]) => (Math.max(r!, g!, b!) - Math.min(r!, g!, b!)) / Math.max(r!, g!, b!, 1e-6);
  const warmth = ([r, , b]: readonly number[]) => r! - b!;
  const paletteAt = (definition: TreeDefinition, palette: number, season: number) =>
    evaluateSeason({ ...definition.season, leafColor: definition.season.leafPalettes![palette]!.leafColor }, season).leafColor;

  it.each(SPECIES_NAMES)('%s: keeps the Species\' leaf coverage, blossom and Fruit timing', async (id) => {
    const species = await loadSpecies(id);
    const { season } = whimsical.default.apply(species);
    expect(season.leafCoverage).toEqual(species.season.leafCoverage);
    expect(season.blossom).toEqual(species.season.blossom);
    expect(season.blossomColor).toEqual(species.season.blossomColor);
    if (species.season.fruit) expect(season.fruit).toEqual(species.season.fruit);
  });

  it('writes five candy Leaf Palettes, each with an accent; the first is also the Season leaf colour', () => {
    const { season } = whimsical.default.apply(oak);
    expect(season.leafPalettes).toHaveLength(5);
    expect(season.leafColor).toEqual(season.leafPalettes![0]!.leafColor);
    expect(new Set(season.leafPalettes!.map((p) => p.accent)).size).toBe(5);
  });

  it('every palette goes pastel in spring, saturated in summer and warmer in autumn, timed to the Species', () => {
    // Oak: leaves fully out at Season 0.1, falling from 0.62, bare at 0.78.
    const definition = whimsical.default.apply(oak);
    for (let i = 0; i < 5; i++) {
      const [spring, summer, autumn] = [0, 0.3, 0.7].map((t) => paletteAt(definition, i, t));
      expect(saturation(summer!), `palette ${i}`).toBeGreaterThan(saturation(spring!) + 0.2);
      expect(warmth(autumn!), `palette ${i}`).toBeGreaterThan(warmth(summer!));
      // Summer colours all the while the Species is in full leaf.
      for (const t of [0.15, 0.6, 0.62]) paletteAt(definition, i, t).forEach((c, k) => expect(c).toBeCloseTo(summer![k]!, 9));
    }
    // A Species that leafs out later is still pastel when the Oak is already in summer colours.
    const late = whimsical.default.apply({ ...oak, season: { ...oak.season, leafCoverage: [{ t: 0, value: 0 }, { t: 0.2, value: 1 }, { t: 0.6, value: 1 }, { t: 0.75, value: 0 }] } });
    expect(saturation(paletteAt(late, 0, 0.1))).toBeLessThan(saturation(paletteAt(definition, 0, 0.1)));
  });

  it('gives an evergreen candy colours all year', async () => {
    const { season } = whimsical.default.apply(await loadSpecies('douglas-fir'));
    expect(season.leafCoverage.every((k) => k.value === 1)).toBe(true);
    expect(season.leafPalettes).toHaveLength(5);
  });

  it('paints the bark pale cream, whatever the Species\' bark colour', () => {
    const cream = whimsical.default.apply(oak).materials.bark.color;
    expect(whimsical.default.apply({ ...oak, bark: { ...oak.bark, color: '#202020' } }).materials.bark.color).toBe(cream);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cream.slice(i, i + 2), 16));
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(190); // pale
    expect(r!).toBeGreaterThan(b!); // warm
  });

  it('the same Seed always picks the same Leaf Palette, and a Forest of one Species shows several', () => {
    const definition = whimsical.default.apply(oak);
    expect(createTree(definition, { seed: 9 }).leafPalette).toEqual(createTree(definition, { seed: 9 }).leafPalette);
    const forest = createForest(definition, [{ position: [0, 0, 0] }], { variants: 8, seed: 1 });
    expect(new Set(forest.variants.map((v) => v.leafPalette!.accent)).size).toBeGreaterThanOrEqual(3);
    forest.dispose();
  });
});

describe('re-styling a Whimsical Definition (ADR 0017)', () => {
  const twistOf = (d: TreeDefinition) => ({
    trunk: [d.trunk.twist, d.trunk.twists, d.trunk.twistStyle, d.trunk.spin, d.trunk.twistCurve],
    branches: d.branches.map((b) => [b.twist, b.twists, b.twistStyle, b.spin, b.twistCurve, b.followTwist]),
  });
  const fantasyOf = (d: TreeDefinition) => ({ twist: twistOf(d), season: d.season, bark: d.materials.bark.color });

  it.each(['low-poly', 'stylized', 'realistic', 'painterly'] as const)(
    'to %s keeps its Twist, Leaf Palettes, Season leaf colours and bark colour',
    async (name) => {
      const drawn = whimsical.default.apply(oak);
      const restyled = (await loadStyle(name)).apply(drawn);
      expect(restyled.materials.shading).not.toBe('whimsical');
      expect(fantasyOf(restyled)).toEqual(fantasyOf(drawn));
    },
  );

  it('keeps hand edits to them too', () => {
    const edited = extendDefinition(whimsical.default.apply(oak), { trunk: { twist: 0.9 }, materials: { bark: { color: '#123456' } } });
    const restyled = stylized.apply(edited);
    expect(restyled.trunk.twist).toBe(0.9);
    expect(restyled.materials.bark.color).toBe('#123456');
  });

  it('back to Whimsical gives the Whimsical tree again (it recognises the whimsical shading)', async () => {
    const drawn = whimsical.default.apply(oak);
    for (const name of ['stylized', 'realistic'] as const) {
      expect(whimsical.default.apply((await loadStyle(name)).apply(drawn))).toEqual(drawn);
    }
    expect(whimsical.default.apply(drawn)).toEqual(drawn);
    // Its puffs map back to the Species' foliage: re-styled in Stylized, the leaves are the Species' own.
    expect(stylized.apply(drawn).leaves.size).toBeCloseTo(stylized.apply(oak).leaves.size, 9);
  });

  it('a conifer Definition gets the milder conifer recipe (recognised by its Leaf Type)', async () => {
    const fir = await loadSpecies('douglas-fir');
    expect(whimsical.default.apply(stylized.apply(fir))).toEqual(whimsical.default.apply(fir));
    expect(whimsical.default.apply(whimsical.default.conifer).trunk.twist).toBe(0.25);
  });
});

describe('the whimsical shading', () => {
  it.each(['broadleaf', 'conifer'] as const)('the %s showpiece: bark, leaves and Fruit are whimsical materials, smooth, in a Tree and a Forest', (form) => {
    const definition = { ...whimsical[form], fruit: { type: 'round' as const, count: 2, size: 0.15, sizeVariation: 0.1, hang: 0.7 } };
    const tree = createTree(definition, { seed: 1 });
    const forest = createForest(definition, [{ position: [0, 0, 0] }], { variants: 1, seed: 1 });
    const variant = forest.variants[0]!;
    for (const material of [tree.wood.material, tree.leaves.material, tree.fruit.material, variant.barkMaterial, variant.leafMaterial, variant.fruitMaterial]) {
      expect(material).toMatchObject({ isWhimsicalMaterial: true, flatShading: false });
    }
    tree.dispose();
    forest.dispose();
  });
});

describe('the Whimsical suggestions', () => {
  /** Saturation (0..1) of a '#rrggbb' colour. */
  const saturationOf = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return (Math.max(r!, g!, b!) - Math.min(r!, g!, b!)) / Math.max(r!, g!, b!);
  };

  it('Tree Effects: a coloured outline, soft Inner Lines and a saturation boost, no Leaf Glow', () => {
    const { outline, innerLines, grade, glow } = SUGGESTED_TREE_EFFECTS.whimsical;
    expect(saturationOf(String(outline!.color))).toBeGreaterThan(0.3);
    expect(innerLines!.strength!).toBeLessThan(SUGGESTED_TREE_EFFECTS['low-poly'].innerLines!.strength!);
    expect(grade!.saturation!).toBeGreaterThan(1);
    expect(glow).toBeUndefined();
  });

  it('Scene Effects: Neutral tone mapping (AgX greys the candy colours), light AO, pastel-tinted fog and almost no bloom', () => {
    const { toneMapping, ao, fog, bloom } = SUGGESTED_SCENE_EFFECTS.whimsical;
    expect(toneMapping?.mapping).toBe('neutral');
    expect(ao!.scale!).toBeLessThan(SUGGESTED_SCENE_EFFECTS.stylized.ao!.scale!);
    const fogColor = String(fog!.color);
    expect(saturationOf(fogColor)).toBeGreaterThan(0.05);
    expect(Math.min(...[1, 3, 5].map((i) => parseInt(fogColor.slice(i, i + 2), 16)))).toBeGreaterThan(200); // pastel
    expect(bloom!.strength!).toBeLessThan(SUGGESTED_SCENE_EFFECTS.stylized.bloom!.strength!);
  });

  it('Material Features: Crown Normals 1', () => {
    expect(SUGGESTED_MATERIAL_FEATURES.whimsical.crownNormals).toBe(1);
  });
});

describe('the Whimsical showpieces', () => {
  const forms = { broadleaf: whimsical.broadleaf, conifer: whimsical.conifer };

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition at real size, in the Style's colours and shading`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
      expect(definition.styleScale).toBeUndefined();
      expect(definition.trunk.length).toBeGreaterThan(4);
      expect(definition.materials.shading).toBe('whimsical');
      expect(definition.season.leafPalettes).toHaveLength(5);
      expect(definition.leaves.shape).toBe('puff');
    });

    it(`${form}: corkscrews as one (Follow Twist on every level)`, () => {
      expect(definition.trunk.twistStyle).toBe('corkscrew');
      for (const level of definition.branches) expect(level).toMatchObject({ twistStyle: 'corkscrew', followTwist: true });
    });

    it(`${form}: matches the golden geometry hash (determinism across releases)`, () => {
      expect(hashTreeData(generateTree(parseDefinition(definition), 42))).toMatchSnapshot();
    });
  }

  it('the broadleaf is a tall, thin Truffula: a strong Twist Curve and a few long branches', () => {
    const { trunk, branches } = whimsical.broadleaf;
    expect(trunk.length / trunk.radius).toBeGreaterThan(40);
    expect(trunk.twistCurve!).toBeGreaterThanOrEqual(0.35);
    expect(branches[0]!.count).toBeLessThanOrEqual(5);
  });

  it('the conifer is a helter-skelter: Twists 8 on the trunk, a cone of whorls', () => {
    expect(whimsical.conifer.trunk.twists).toBe(8);
    expect(whimsical.conifer.branches[0]!.lengthProfile).toEqual(coneCurve(whimsical.conifer.branches[0]!.start));
  });
});
