// Stylized Painterly: Enchanted's shapes (trunks, branch levels, Roots, Snake Twist recipe, gravity) drawn
// with Painterly's look (painted shading, painted bark, Leaf Masses of spray cards, the Species' colours).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createTree,
  isPaintedShading,
  loadStyle,
  parseDefinition,
  STYLE_NAMES,
  styleLabel,
  styleOfShading,
  type TreeDefinition,
} from '../../src/index';
import { createShadedMaterial } from '../../src/materials/shading';
import { PaintedNodeMaterial } from '../../src/materials/painted';
import { paintsLeafMasses } from '../../src/materials';
import { oak, pine } from '../../src/species';
import { ENCHANTED } from '../../src/styles/enchanted/recipe';
import enchanted from '../../src/styles/enchanted';
import painterly from '../../src/styles/painterly';
import { SUGGESTED_MATERIAL_FEATURES } from '../../src/styles/material-features';
import { SUGGESTED_TREE_EFFECTS } from '../../src/effects/suggested';
import { SUGGESTED_SCENE_EFFECTS } from '../../src/scene/suggested';

const style = await import('../../src/styles/stylized-painterly');
const stylizedPainterly = style.default;

/** The shape fields of a Definition: everything but its look (leaves, materials), colours and name. */
const twistOf = (d: TreeDefinition) => ({
  trunk: { twist: d.trunk.twist, twists: d.trunk.twists, twistStyle: d.trunk.twistStyle, spin: d.trunk.spin, twistCurve: d.trunk.twistCurve },
  branches: d.branches.map((b) => ({ twist: b.twist, twists: b.twists, twistStyle: b.twistStyle, spin: b.spin, twistCurve: b.twistCurve, followTwist: b.followTwist })),
});
const withoutTwist = <T extends object>(part: T) => {
  const copy = { ...part } as Record<string, unknown>;
  for (const key of ['twist', 'twists', 'twistStyle', 'spin', 'twistCurve', 'followTwist', 'sides', 'sections', 'flareSections']) delete copy[key];
  return copy;
};

describe('stylized-painterly Style: registration', () => {
  it('is a built-in Style labelled "Stylized Painterly", drawn with the stylized-painted shading', async () => {
    expect(STYLE_NAMES).toContain('stylized-painterly');
    expect(styleLabel('stylized-painterly')).toBe('Stylized Painterly');
    expect(styleOfShading('stylized-painted')).toBe('stylized-painterly');
    expect(styleOfShading('painted')).toBe('painterly');
    expect(await loadStyle('stylized-painterly')).toBe(stylizedPainterly);
    expect(stylizedPainterly).toMatchObject({ name: 'stylized-painterly', broadleaf: style.broadleaf, conifer: style.conifer });
  });

  it('is published as its own subpath, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/stylized-painterly']).toEqual({
      types: './dist/styles/stylized-painterly/index.d.ts',
      import: './dist/styles/stylized-painterly.js',
    });
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toMatch(/'styles\/stylized-painterly': resolve\(.*src\/styles\/stylized-painterly\/index\.ts'\)/);
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/stylized-painterly/);
  });

  it('has suggestions: Painterly’s Material Features, Tree Effects and Scene Effects', () => {
    expect(SUGGESTED_MATERIAL_FEATURES['stylized-painterly']).toEqual(SUGGESTED_MATERIAL_FEATURES.painterly);
    expect(SUGGESTED_TREE_EFFECTS['stylized-painterly']).toEqual(SUGGESTED_TREE_EFFECTS.painterly);
    expect(SUGGESTED_SCENE_EFFECTS['stylized-painterly']).toEqual(SUGGESTED_SCENE_EFFECTS.painterly);
  });
});

describe('stylized-painterly Style: the painted look', () => {
  it('the stylized-painted shading round-trips through the schema and draws with the painted material', () => {
    expect(parseDefinition({ schemaVersion: 3, materials: { shading: 'stylized-painted' } }).materials.shading).toBe('stylized-painted');
    expect(isPaintedShading('stylized-painted')).toBe(true);
    expect(isPaintedShading('painted')).toBe(true);
    expect(isPaintedShading('enchanted')).toBe(false);
    const material = createShadedMaterial('stylized-painted');
    expect(material).toBeInstanceOf(PaintedNodeMaterial);
    material.dispose();
  });

  it.each([['broadleaf', oak], ['conifer', pine]] as const)('apply(%s Species) draws Painterly’s leaves, bark and colours', (_, species) => {
    const definition = stylizedPainterly.apply(species);
    const reference = painterly.apply(species);
    expect(parseDefinition(definition)).toEqual(definition);
    expect(definition.materials.shading).toBe('stylized-painted');
    expect(paintsLeafMasses(definition)).toBe(true);
    // Painterly's leaf and bark materials and Leaf Masses; leaf count and layering as Painterly's.
    expect(definition.materials.leaf).toEqual(reference.materials.leaf);
    expect(definition.materials.bark).toEqual(reference.materials.bark);
    expect(definition.materials.bark.map).toMatch(/^painterly\//);
    // (Leaf size aside: Painterly also shrinks the whole tree.)
    expect({ ...definition.leaves, size: 0 }).toEqual({ ...reference.leaves, size: 0 });
    // The Species' own colours and Season: no Leaf Palettes, no Inner Glow.
    expect(definition.season).toEqual(reference.season);
    expect(definition.season.leafPalettes).toBeUndefined();
    expect(definition.materials.innerGlow).toBeUndefined();
  });

  it('keeps real sizes (no Painterly height compression)', () => {
    const definition = stylizedPainterly.apply(oak);
    expect(definition.styleScale).toBeUndefined();
    expect(definition.trunk.length).toBe(oak.trunk.length);
    expect(definition.trunk.radius).toBe(oak.trunk.radius);
  });
});

describe('stylized-painterly Style: Enchanted’s shapes', () => {
  it.each([['broadleaf', oak], ['conifer', pine]] as const)('apply(%s Species) writes the Enchanted Twist recipe and keeps the shape fields', (_, species) => {
    const definition = stylizedPainterly.apply(species);
    const reference = enchanted.apply(species);
    expect(twistOf(definition)).toEqual(twistOf(reference));
    expect(definition.trunk.twistStyle).toBe('snake');
    expect(definition.branches[0]).toMatchObject(ENCHANTED.twist[species.form].level1);
    // Every other shape field is the Species' own, as in Enchanted.
    expect(withoutTwist(definition.trunk)).toEqual(withoutTwist(reference.trunk));
    expect(definition.branches.map(withoutTwist)).toEqual(reference.branches.map(withoutTwist));
  });

  it('its own Definitions have the Enchanted trunks, branch levels and Roots, in Painterly’s look', () => {
    for (const form of ['broadleaf', 'conifer'] as const) {
      const own = style[form];
      const shape = enchanted[form];
      expect(parseDefinition(own)).toEqual(own);
      expect(withoutTwist(own.trunk)).toEqual(withoutTwist(shape.trunk));
      expect(twistOf(own)).toEqual(twistOf(shape));
      expect(own.branches.map(withoutTwist)).toEqual(shape.branches.map(withoutTwist));
      expect(own.roots && withoutTwist(own.roots)).toEqual(shape.roots && withoutTwist(shape.roots));
      expect(own.materials.shading).toBe('stylized-painted');
      expect(own.leaves.shape).toBe('mass');
      expect(own.leaves.type).toBe(painterly[form].leaves.type);
      expect(own.materials.leaf).toEqual(painterly[form].materials.leaf);
      expect(own.materials.bark).toEqual(painterly[form].materials.bark);
      expect(own.season).toEqual(painterly[form].season);
      expect(own.materials.innerGlow).toBeUndefined();
    }
  });

  it('re-applied to its own Definitions it shapes them as Enchanted re-applied to its own', () => {
    for (const form of ['broadleaf', 'conifer'] as const) {
      const again = stylizedPainterly.apply(style[form]);
      const shape = enchanted.apply(enchanted[form]);
      expect(twistOf(again)).toEqual(twistOf(shape));
      expect(again.branches.map(withoutTwist)).toEqual(shape.branches.map(withoutTwist));
      expect(again.leaves.shape).toBe('mass');
    }
  });

  it('re-styles an Enchanted tree: its shape as Enchanted draws it, Painterly’s leaves and bark textures', () => {
    const definition = stylizedPainterly.apply(enchanted.broadleaf);
    expect(twistOf(definition)).toEqual(twistOf(enchanted.apply(enchanted.broadleaf)));
    expect(definition.materials.shading).toBe('stylized-painted');
    expect(definition.leaves.shape).toBe('mass');
    expect(definition.materials.bark.map).toMatch(/^painterly\//);
  });

  it('Painterly re-applied to a Stylized Painterly tree shrinks it (it is not Painterly-sized)', () => {
    const definition = painterly.apply(stylizedPainterly.apply(oak));
    expect(definition.styleScale).toBeLessThan(1);
  });

  it.each(['broadleaf', 'conifer'] as const)('grows its %s with painted Leaf Masses', (form) => {
    const tree = createTree(style[form], { seed: 1 });
    expect(tree.leaves.material).toBeInstanceOf(PaintedNodeMaterial);
    expect(tree.data.skeleton.leaves.length).toBeGreaterThan(50);
    tree.dispose();
  });
});
