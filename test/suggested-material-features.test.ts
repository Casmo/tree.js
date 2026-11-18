// SUGGESTED_MATERIAL_FEATURES and withMaterialFeatures (#57, ADR 0008): suggested values per Style
// that an app applies explicitly; built-in Styles and Species never set a Material Feature.
import { describe, expect, it } from 'vitest';
import {
  extendDefinition,
  parseDefinition,
  STYLE_NAMES,
  SUGGESTED_MATERIAL_FEATURES,
  TreeDefinitionError,
  withMaterialFeatures,
  type MaterialFeatures,
  type TreeDefinition,
} from '../src/index';
import * as allSpecies from '../src/species';
import { oak, type SpeciesDefinition } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';

const featuresOf = (definition: TreeDefinition): MaterialFeatures => {
  const { crownNormals, translucency } = definition.materials.leaf;
  const { occlusion } = definition.materials;
  return {
    ...(crownNormals === undefined ? {} : { crownNormals }),
    ...(translucency === undefined ? {} : { translucency }),
    ...(occlusion === undefined ? {} : { occlusion }),
  };
};

/** The Definition without its Material Features, to compare everything else. */
const withoutFeatures = (definition: TreeDefinition): unknown => {
  const leaf = { ...definition.materials.leaf };
  delete leaf.crownNormals;
  delete leaf.translucency;
  const materials = { ...definition.materials, leaf };
  delete materials.occlusion;
  return { ...definition, materials };
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

describe('SUGGESTED_MATERIAL_FEATURES', () => {
  it('has a suggestion for every built-in Style', () => {
    expect(Object.keys(SUGGESTED_MATERIAL_FEATURES).sort()).toEqual([...STYLE_NAMES].sort());
  });

  it.each(STYLE_NAMES)('the %s suggestion passes validation and turns features on', (style) => {
    const features = SUGGESTED_MATERIAL_FEATURES[style];
    const definition = withMaterialFeatures(stylized.broadleaf, features);
    expect(featuresOf(parseDefinition(definition))).toEqual(features);
    expect(features.crownNormals).toBeGreaterThan(0);
    expect(features.occlusion?.strength).toBeGreaterThan(0);
  });

  it('suggests translucency for the stylized and realistic Styles, not for low-poly', () => {
    expect(SUGGESTED_MATERIAL_FEATURES['low-poly'].translucency).toBeUndefined();
    expect(SUGGESTED_MATERIAL_FEATURES.stylized.translucency).toBeDefined();
    expect(SUGGESTED_MATERIAL_FEATURES.realistic.translucency).toBeDefined();
  });
});

describe('withMaterialFeatures', () => {
  const all: Required<MaterialFeatures> = {
    crownNormals: 0.4,
    translucency: { strength: 0.5, edge: 0.6, ambient: 0.3 },
    occlusion: { strength: 0.7 },
  };

  it('returns a new Definition and leaves its input untouched', () => {
    const input = deepFreeze(structuredClone(realistic.broadleaf));
    const before = structuredClone(input);
    const result = withMaterialFeatures(input, all);
    expect(result).not.toBe(input);
    expect(input).toEqual(before);
  });

  it('does not keep references to the features object it is given', () => {
    const features = structuredClone(all);
    const result = withMaterialFeatures(lowPoly.broadleaf, features);
    features.translucency.strength = 1;
    features.occlusion.strength = 0;
    expect(result.materials.leaf.translucency).toEqual(all.translucency);
    expect(result.materials.occlusion).toEqual(all.occlusion);
  });

  it('sets exactly the given features and changes nothing else', () => {
    const base = lowPoly.apply(oak);
    for (const features of [all, { crownNormals: 1 }, { occlusion: { strength: 0.2 } }, { translucency: all.translucency }]) {
      const result = withMaterialFeatures(base, features);
      expect(featuresOf(result)).toEqual(features);
      expect(withoutFeatures(result)).toEqual(withoutFeatures(base));
    }
  });

  it('replaces the features already set: a feature left out is switched off, {} switches all off', () => {
    const opted = withMaterialFeatures(stylized.broadleaf, all);
    expect(featuresOf(withMaterialFeatures(opted, { crownNormals: 0.5 }))).toEqual({ crownNormals: 0.5 });
    const off = withMaterialFeatures(opted, {});
    expect(featuresOf(off)).toEqual({});
    expect(off).toEqual(stylized.broadleaf);
  });

  it('accepts a Definition input and returns a full, valid Definition', () => {
    const result = withMaterialFeatures({ schemaVersion: 1 }, SUGGESTED_MATERIAL_FEATURES.stylized);
    expect(parseDefinition(result)).toEqual(result);
    expect(featuresOf(result)).toEqual(SUGGESTED_MATERIAL_FEATURES.stylized);
  });

  it('rejects out-of-range values like parseDefinition does', () => {
    expect(() => withMaterialFeatures(oakDefinition(), { crownNormals: 2 })).toThrow(TreeDefinitionError);
    expect(() => withMaterialFeatures(oakDefinition(), { occlusion: { strength: -1 } })).toThrow('materials.occlusion.strength');
  });

  it('composes with extendDefinition', () => {
    const result = extendDefinition(withMaterialFeatures(oakDefinition(), all), { leaves: { size: 0.5 } });
    expect(featuresOf(result)).toEqual(all);
  });
});

function oakDefinition(): TreeDefinition {
  return realistic.apply(oak);
}

describe('built-in Styles and Species', () => {
  const species = Object.values(allSpecies).filter((v): v is SpeciesDefinition => typeof v === 'object' && v !== null && 'bark' in v);

  it('no built-in Style Definition sets a Material Feature', () => {
    for (const style of [lowPoly, stylized, realistic]) {
      for (const form of ['broadleaf', 'conifer'] as const) {
        expect(featuresOf(style[form]), `${style.name} ${form}`).toEqual({});
      }
    }
  });

  it('no built-in Species sets a Material Feature, in any Style', () => {
    expect(species.length).toBeGreaterThan(0);
    for (const s of species) {
      expect(JSON.stringify(s), s.id).not.toMatch(/crownNormals|translucency|occlusion/);
      for (const style of [lowPoly, stylized, realistic]) expect(featuresOf(style.apply(s)), `${style.name} ${s.id}`).toEqual({});
    }
  });
});
