import { describe, expect, it } from 'vitest';
import { BARK_TYPES, DEFAULT_DEFINITION, LEAF_TYPES, SPINS, TWIST_STYLES, parseDefinition } from '@casmo/tree.js';
import {
  BRANCH_LEVEL_CURVES,
  BRANCH_LEVEL_FIELDS,
  FRUIT_FIELDS,
  GROUND_TINT_FIELDS,
  INNER_GLOW_FIELDS,
  LEAF_PALETTES,
  MATERIAL_FEATURES,
  PARAMETER_GROUPS,
  ROOTS_FIELDS,
  SEASON_FIELDS,
  SEASON_TRACKS,
  type Field,
} from './fields';

/** Every parameter of a Definition as a dotted path; branch levels as "branches.*.<key>", tracks whole. */
function parameterPaths(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node)) {
    if (prefix === 'branches') return parameterPaths(node[0], 'branches.*');
    return [prefix]; // keyframe tracks
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) => parameterPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

/** A Definition with every optional field and block present (Stems, Root Flare, Twist on the trunk and branch levels, Crown Shape curves, Leaf/Bark Type, Ground Tint, Material Features, Fruit, Roots). */
const FULL_DEFINITION = parseDefinition({
  ...DEFAULT_DEFINITION,
  species: 'test-oak',
  trunk: { ...DEFAULT_DEFINITION.trunk, stems: 3, spread: 20, gravity: -0.2, twist: 0.3, twists: 3, twistStyle: 'corkscrew', spin: 'clockwise', twistCurve: 0.5, flare: 0.5, flareSections: 2 },
  branches: DEFAULT_DEFINITION.branches.map((level) => ({
    ...level,
    twist: 0.3,
    twists: 3,
    twistStyle: 'corkscrew',
    spin: 'clockwise',
    twistCurve: 0.5,
    followTwist: true,
    lengthProfile: [{ t: 0, value: 1 }],
    angleProfile: [{ t: 0, value: 1 }],
  })),
  leaves: { ...DEFAULT_DEFINITION.leaves, type: 'lobed' },
  materials: {
    ...DEFAULT_DEFINITION.materials,
    bark: { ...DEFAULT_DEFINITION.materials.bark, type: 'smooth', groundTint: {} },
    leaf: { ...DEFAULT_DEFINITION.materials.leaf, crownNormals: 0.5, translucency: {} },
    occlusion: {},
    innerGlow: {},
  },
  fruit: { type: 'pear', sides: 6 },
  roots: { count: 4, sides: 6, sections: 4 },
  season: {
    ...DEFAULT_DEFINITION.season,
    fruit: [{ t: 0, value: 1 }],
    fruitColor: [{ t: 0, value: '#ff0000' }],
    leafPalettes: [{ leafColor: [{ t: 0, value: '#33cc99' }], accent: '#ff66cc' }],
  },
});

const allFields = (): Field[] => [
  ...PARAMETER_GROUPS.flatMap((group) => group.fields),
  ...FRUIT_FIELDS,
  ...ROOTS_FIELDS,
  ...GROUND_TINT_FIELDS,
  ...INNER_GLOW_FIELDS,
  ...MATERIAL_FEATURES.flatMap((feature) => feature.fields),
];

/** Polygon detail of the Roots: always the Style's choice, so no control (ADR 0007, #46). */
const STYLE_ONLY = ['roots.sides', 'roots.sections'];

const editable = [
  ...allFields().map((field) => field.path),
  ...BRANCH_LEVEL_FIELDS.map((field) => `branches.*.${field.path}`),
  ...BRANCH_LEVEL_CURVES.map((curve) => `branches.*.${curve.key}`),
  ...SEASON_FIELDS.map((field) => field.path),
  ...SEASON_TRACKS.map((track) => `season.${track.key}`),
  LEAF_PALETTES.path,
];

describe('parameter panels', () => {
  it('offer a control for every Definition field, optional ones included (Sculpts are edited in the preview, the Species label comes from the Start, Root detail from the Style)', () => {
    const paths = parameterPaths(FULL_DEFINITION).filter((path) => !['schemaVersion', 'sculpts', 'species', ...STYLE_ONLY].includes(path));
    expect(paths).toContain('materials.bark.normalMap');
    expect(paths).toContain('branches.*.gravity');
    expect(paths).toContain('branches.*.angleProfile');
    expect(paths).toContain('trunk.stems');
    expect(paths).toContain('trunk.flare');
    expect(paths).toContain('trunk.flareSections');
    expect(paths).toContain('fruit.hang');
    for (const key of ['color', 'height', 'strength']) expect(paths).toContain(`materials.bark.groundTint.${key}`);
    expect(paths).toContain('materials.leaf.crownNormals');
    for (const key of ['strength', 'edge', 'ambient']) expect(paths).toContain(`materials.leaf.translucency.${key}`);
    expect(paths).toContain('materials.occlusion.strength');
    for (const key of ['count', 'length', 'lengthVariation', 'radius', 'angle', 'bend']) expect(paths).toContain(`roots.${key}`);
    expect(paths).toContain('season.fruitColor');
    expect(paths).toContain('season.leafPalettes');
    for (const key of ['leaf', 'veins']) expect(paths).toContain(`materials.innerGlow.${key}`);
    expect([...editable].sort()).toEqual([...paths].sort());
  });

  it('show the value an optional field means while it is absent', () => {
    const shown = Object.fromEntries(allFields().flatMap((field) => ('absent' in field ? [[field.path, field.absent]] : [])));
    expect(shown).toEqual({
      'trunk.stems': 1,
      'trunk.spread': 0,
      'trunk.gravity': 0,
      'trunk.twistStyle': 'snake',
      'trunk.twist': 0,
      'trunk.twists': 2,
      'trunk.spin': 'random',
      'trunk.twistCurve': 0,
      'trunk.flare': 0,
      'trunk.flareSections': 3,
      'leaves.type': '',
      'materials.bark.type': '',
      'fruit.sides': 8,
    });
    expect(SEASON_TRACKS.find((track) => track.key === 'fruit')?.absent).toEqual([{ t: 0, value: 1 }]);
    expect(SEASON_TRACKS.find((track) => track.key === 'fruitColor')?.absent).toEqual([{ t: 0, value: '#b8322a' }]);
    expect(BRANCH_LEVEL_CURVES.map((curve) => curve.absent)).toEqual([[{ t: 0, value: 1 }], [{ t: 0, value: 1 }]]);
  });

  it('have slider ranges the schema accepts, around the default values', () => {
    const numbers = [
      ...allFields(),
      ...BRANCH_LEVEL_FIELDS.map((field) => ({ ...field, path: `branches.0.${field.path}` })),
    ].filter((field): field is Extract<Field, { kind: 'number' }> => field.kind === 'number');
    for (const field of numbers) {
      const [section, ...rest] = field.path.split('.');
      const set = (value: number) => {
        const patch = structuredClone(FULL_DEFINITION) as unknown as Record<string, unknown>;
        let node = patch[section!] as Record<string, unknown>;
        for (const key of rest.slice(0, -1)) node = node[key] as Record<string, unknown>;
        node[rest.at(-1)!] = value;
        return parseDefinition(patch);
      };
      // start <= end is checked across fields: test start only at its min, end only at its max.
      if (field.path !== 'branches.0.start') expect(() => set(field.max), field.path).not.toThrow();
      if (field.path !== 'branches.0.end') expect(() => set(field.min), field.path).not.toThrow();
    }
  });

  it('offer a Material features group: one toggle per feature, sliders over its 0..1 range', () => {
    expect(MATERIAL_FEATURES.map((feature) => [feature.key, feature.label, feature.path])).toEqual([
      ['crownNormals', 'Crown Normals', 'materials.leaf.crownNormals'],
      ['translucency', 'Leaf Translucency', 'materials.leaf.translucency'],
      ['occlusion', 'Structural Occlusion', 'materials.occlusion'],
    ]);
    const sliders = MATERIAL_FEATURES.flatMap((feature) => feature.fields);
    expect(sliders.map((field) => field.path)).toEqual([
      'materials.leaf.crownNormals',
      'materials.leaf.translucency.strength',
      'materials.leaf.translucency.edge',
      'materials.leaf.translucency.ambient',
      'materials.occlusion.strength',
    ]);
    for (const field of sliders) expect(field).toMatchObject({ kind: 'number', min: 0, max: 1, step: 0.01 });
    // Out of range is still rejected by the schema (a typed value beyond the slider).
    expect(() => parseDefinition({ ...FULL_DEFINITION, materials: { ...FULL_DEFINITION.materials, occlusion: { strength: 1.5 } } })).toThrow(
      /materials.occlusion.strength/,
    );
  });

  it('offer Inner Glow sliders for the leaves and the bark veins over 0..4 (1 = the Enchanted Style\'s own)', () => {
    expect(INNER_GLOW_FIELDS).toEqual([
      { kind: 'number', path: 'materials.innerGlow.leaf', label: 'Leaves', min: 0, max: 4, step: 0.05 },
      { kind: 'number', path: 'materials.innerGlow.veins', label: 'Bark veins', min: 0, max: 4, step: 0.05 },
    ]);
    const glow = (leaf: number) => () => parseDefinition({ ...DEFAULT_DEFINITION, materials: { ...DEFAULT_DEFINITION.materials, innerGlow: { leaf } } });
    expect(glow(4)).not.toThrow();
    expect(glow(4.1)).toThrow(/materials.innerGlow.leaf/);
  });

  it('offer exactly the choices the schema accepts', () => {
    const choices = allFields().filter((field) => field.kind === 'choice');
    expect(Object.fromEntries(choices.map((field) => [field.path, field.options]))).toEqual({
      'trunk.twistStyle': ['snake', 'corkscrew'],
      'trunk.spin': ['random', 'clockwise', 'counterclockwise'],
      'leaves.shape': ['card', 'clump', 'needle', 'puff'],
      'leaves.type': LEAF_TYPES,
      'materials.shading': ['standard', 'flat', 'toon', 'painted', 'whimsical', 'enchanted', 'stylized-painted'],
      'materials.bark.type': BARK_TYPES,
      'fruit.type': ['round', 'pear', 'nut', 'cone', 'berry'],
    });
    const fruitType = (type: string) => () => parseDefinition({ ...DEFAULT_DEFINITION, fruit: { type } });
    for (const type of ['round', 'pear', 'nut', 'cone', 'berry']) expect(fruitType(type)).not.toThrow();
    expect(fruitType('apple')).toThrow(/fruit.type/);
    const shading = (value: string) => () => parseDefinition({ ...DEFAULT_DEFINITION, materials: { ...DEFAULT_DEFINITION.materials, shading: value } });
    for (const value of ['standard', 'flat', 'toon', 'painted', 'whimsical', 'enchanted', 'stylized-painted']) expect(shading(value)).not.toThrow();
    expect(shading('glow')).toThrow(/materials.shading/);
    expect(() => parseDefinition({ ...DEFAULT_DEFINITION, trunk: { ...DEFAULT_DEFINITION.trunk, twistStyle: 'helix' } })).toThrow(/trunk.twistStyle/);
    expect(() => parseDefinition({ ...DEFAULT_DEFINITION, trunk: { ...DEFAULT_DEFINITION.trunk, spin: 'left' } })).toThrow(/trunk.spin/);
  });

  it('offer the Twist group right after Gravity on each branch level: Twist style, Twist, Twists, Spin, Twist curve, Follow twist, showing Snake / no Twist / Random / 0 / off while absent', () => {
    const paths = BRANCH_LEVEL_FIELDS.map((field) => field.path);
    const at = paths.indexOf('gravity');
    expect(paths.slice(at, at + 7)).toEqual(['gravity', 'twistStyle', 'twist', 'twists', 'spin', 'twistCurve', 'followTwist']);
    const field = (path: string) => BRANCH_LEVEL_FIELDS.find((f) => f.path === path);
    expect(field('twistStyle')).toEqual({ kind: 'choice', path: 'twistStyle', label: 'Twist style', options: TWIST_STYLES, labels: { snake: 'Snake', corkscrew: 'Corkscrew' }, absent: 'snake' });
    expect(field('twist')).toEqual({ kind: 'number', path: 'twist', label: 'Twist', min: 0, max: 1, step: 0.01, absent: 0 });
    expect(field('twists')).toEqual({ kind: 'number', path: 'twists', label: 'Twists', min: 1, max: 8, step: 1, absent: 2 });
    expect(field('spin')).toEqual({ kind: 'choice', path: 'spin', label: 'Spin', options: SPINS, labels: { random: 'Random', clockwise: 'Clockwise', counterclockwise: 'Counter-clockwise' }, absent: 'random', hint: 'Corkscrew only' });
    expect(field('twistCurve')).toEqual({ kind: 'number', path: 'twistCurve', label: 'Twist curve', min: 0, max: 1, step: 0.01, absent: 0, hint: 'Corkscrew only' });
    expect(field('followTwist')).toEqual({ kind: 'toggle', path: 'followTwist', label: 'Follow twist', absent: false, hint: 'Corkscrew only' });
    expect(TWIST_STYLES).toEqual(['snake', 'corkscrew']);
    expect(SPINS).toEqual(['random', 'clockwise', 'counterclockwise']);
    for (const [path, value] of [['twistStyle', 'helix'], ['spin', 'left']]) {
      expect(() => parseDefinition({ ...DEFAULT_DEFINITION, branches: [{ ...DEFAULT_DEFINITION.branches[0]!, [path!]: value }] })).toThrow(`branches[0].${path}`);
    }
  });

  it('offer the Twist group on the trunk right after Trunk gravity: Twist style, Twist, Twists, Spin, Twist curve, showing Snake / no Twist / Random / 0 while absent; Follow twist only on branch levels', () => {
    const fields = PARAMETER_GROUPS.find((group) => group.id === 'trunk')!.fields;
    const paths = fields.map((field) => field.path);
    expect(allFields().filter((field) => field.path.endsWith('followTwist'))).toEqual([]);
    const at = paths.indexOf('trunk.gravity');
    expect(paths.slice(at, at + 6)).toEqual(['trunk.gravity', 'trunk.twistStyle', 'trunk.twist', 'trunk.twists', 'trunk.spin', 'trunk.twistCurve']);
    const field = (path: string) => fields.find((f) => f.path === path);
    expect(field('trunk.twistStyle')).toEqual({ kind: 'choice', path: 'trunk.twistStyle', label: 'Twist style', options: TWIST_STYLES, labels: { snake: 'Snake', corkscrew: 'Corkscrew' }, absent: 'snake' });
    expect(field('trunk.twist')).toEqual({ kind: 'number', path: 'trunk.twist', label: 'Twist', min: 0, max: 1, step: 0.01, absent: 0 });
    expect(field('trunk.twists')).toEqual({ kind: 'number', path: 'trunk.twists', label: 'Twists', min: 1, max: 8, step: 1, absent: 2 });
    expect(field('trunk.spin')).toEqual({ kind: 'choice', path: 'trunk.spin', label: 'Spin', options: SPINS, labels: { random: 'Random', clockwise: 'Clockwise', counterclockwise: 'Counter-clockwise' }, absent: 'random', hint: 'Corkscrew only' });
    expect(field('trunk.twistCurve')).toEqual({ kind: 'number', path: 'trunk.twistCurve', label: 'Twist curve', min: 0, max: 1, step: 0.01, absent: 0, hint: 'Corkscrew only' });
    // The trunk has no Follow Twist.
    expect(paths.filter((path) => path.includes('follow'))).toEqual([]);
  });

  it('let a Crown Shape curve go beyond 1 (longer or wider branches) but not below 0', () => {
    for (const curve of BRANCH_LEVEL_CURVES) {
      expect(curve.min).toBe(0);
      expect(curve.max).toBeGreaterThan(1);
      const level = (value: number) => () =>
        parseDefinition({ ...DEFAULT_DEFINITION, branches: [{ ...DEFAULT_DEFINITION.branches[0]!, [curve.key]: [{ t: 0, value }] }] });
      expect(level(curve.max)).not.toThrow();
      expect(level(-0.1)).toThrow();
    }
  });
});
