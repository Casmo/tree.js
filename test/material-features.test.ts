// Material Features (#52, ADR 0008): optional fields in the Definition's `materials` section,
// off when absent, with no schemaVersion change.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_OCCLUSION,
  DEFAULT_TRANSLUCENCY,
  extendDefinition,
  parseDefinition,
  TreeDefinitionError,
  type MaterialFeatures,
} from '../src/index';
import * as allSpecies from '../src/species';
import { oak, type SpeciesDefinition } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import painterly from '../src/styles/painterly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

const withMaterials = (materials: unknown) => ({ schemaVersion: CURRENT_SCHEMA_VERSION, materials });

describe('Material Features in the Definition', () => {
  it('are all absent (off) unless given', () => {
    const { materials } = parseDefinition({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(materials.leaf).not.toHaveProperty('crownNormals');
    expect(materials.leaf).not.toHaveProperty('translucency');
    expect(materials).not.toHaveProperty('occlusion');
  });

  it('keeps the values it is given, at the edges of their ranges too', () => {
    for (const [lo, hi] of [
      [0, 1],
      [1, 0],
      [0.25, 0.75],
    ] as const) {
      const { materials } = parseDefinition(
        withMaterials({
          leaf: { crownNormals: lo, translucency: { strength: lo, edge: hi, ambient: lo } },
          occlusion: { strength: hi },
        }),
      );
      expect(materials.leaf.crownNormals).toBe(lo);
      expect(materials.leaf.translucency).toEqual({ strength: lo, edge: hi, ambient: lo });
      expect(materials.occlusion).toEqual({ strength: hi });
    }
  });
});

describe('Material Feature validation', () => {
  it('fills the missing fields of a partial block from the defaults', () => {
    const { materials } = parseDefinition(withMaterials({ leaf: { translucency: { edge: 0.9 } }, occlusion: {} }));
    expect(materials.leaf.translucency).toEqual({ ...DEFAULT_TRANSLUCENCY, edge: 0.9 });
    expect(materials.occlusion).toEqual(DEFAULT_OCCLUSION);
  });

  it.each([
    ['leaf.crownNormals', { leaf: { crownNormals: -0.1 } }],
    ['leaf.crownNormals', { leaf: { crownNormals: 1.01 } }],
    ['leaf.crownNormals', { leaf: { crownNormals: '0.5' } }],
    ['leaf.translucency.strength', { leaf: { translucency: { strength: 2 } } }],
    ['leaf.translucency.edge', { leaf: { translucency: { edge: -1 } } }],
    ['leaf.translucency.ambient', { leaf: { translucency: { ambient: 1.5 } } }],
    ['leaf.translucency.glow', { leaf: { translucency: { glow: 1 } } }],
    ['leaf.translucency', { leaf: { translucency: 0.5 } }],
    ['occlusion.strength', { occlusion: { strength: 1.2 } }],
    ['occlusion.strength', { occlusion: { strength: -0.2 } }],
    ['occlusion', { occlusion: 0.5 }],
  ])('rejects an invalid materials.%s', (field, materials) => {
    expect(() => parseDefinition(withMaterials(materials))).toThrow(TreeDefinitionError);
    expect(() => parseDefinition(withMaterials(materials))).toThrow(`materials.${field} `);
  });

  it.each(['definition-v1.json', 'definition-v2-broadleaf.json', 'definition-v2-conifer.json'])(
    'loads the old fixture %s unchanged, with the same schemaVersion and no feature switched on',
    (name) => {
      const def = parseDefinition(fixture(name));
      expect(def.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(def.materials.leaf).not.toHaveProperty('crownNormals');
      expect(def.materials.leaf).not.toHaveProperty('translucency');
      expect(def.materials).not.toHaveProperty('occlusion');
    },
  );

  it('round-trips through JSON', () => {
    const def = parseDefinition(withMaterials({ leaf: { crownNormals: 0.6 }, occlusion: { strength: 0.8 } }));
    expect(parseDefinition(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });
});

describe('Material Features and Styles', () => {
  const features: Required<MaterialFeatures> = {
    crownNormals: 0.6,
    translucency: { strength: 0.6, edge: 0.7, ambient: 0.3 },
    occlusion: { strength: 0.8 },
  };

  it('no built-in Style turns one on for any Species', () => {
    const species = Object.values(allSpecies).filter((v): v is SpeciesDefinition => typeof v === 'object' && v !== null && 'bark' in v);
    for (const style of [lowPoly, stylized, realistic, painterly]) {
      for (const s of species) {
        const { materials } = style.apply(s);
        expect(materials.leaf, `${style.name} ${s.id}`).not.toHaveProperty('crownNormals');
        expect(materials.leaf, `${style.name} ${s.id}`).not.toHaveProperty('translucency');
        expect(materials, `${style.name} ${s.id}`).not.toHaveProperty('occlusion');
      }
    }
  });

  it('survive re-styling a Definition (they are the app\'s choice, not part of a look)', () => {
    const { occlusion, ...leaf } = features;
    const opted = extendDefinition(lowPoly.apply(oak), { materials: { leaf, occlusion } });
    for (const style of [realistic, stylized, lowPoly]) {
      const { materials } = style.apply(opted);
      expect(materials.leaf.crownNormals).toBe(features.crownNormals);
      expect(materials.leaf.translucency).toEqual(features.translucency);
      expect(materials.occlusion).toEqual(features.occlusion);
    }
  });
});
