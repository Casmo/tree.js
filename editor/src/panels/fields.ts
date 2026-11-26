// What the parameter panels edit: one entry per Tree Definition field, with its label and the
// slider range offered (the schema still validates every value; typed numbers may go beyond the
// slider). Pure data, so a test can check that every Definition field has a control.
import {
  BARK_TYPES,
  DEFAULT_FRUIT_AMOUNT,
  DEFAULT_FRUIT_COLOR,
  FRUIT_TYPES,
  LEAF_TYPES,
  SPINS,
  TWIST_STYLES,
  type BranchLevelDefinition,
  type HexColor,
  type Keyframe,
  type MaterialFeatures,
  type TreeDefinition,
} from '@casmo/tree.js';

/**
 * `absent` (optional Definition fields only): the value shown while the field is absent. A number
 * field writes the field on the first edit; a choice field with `absent` '' offers "not set", which
 * removes it, and one with `absent` among its options (what absent means) shows that option. A toggle
 * shows `absent` while absent; switching it to `absent` removes the field again.
 * `hint`: a short note shown under the control (e.g. when the field applies).
 */
export type Field = (
  | { kind: 'number'; path: string; label: string; min: number; max: number; step: number; absent?: number }
  | { kind: 'choice'; path: string; label: string; options: readonly string[]; absent?: string }
  | { kind: 'color'; path: string; label: string }
  /** A texture URL; empty = null (no texture). */
  | { kind: 'url'; path: string; label: string }
  | { kind: 'text'; path: string; label: string }
  /** A checkbox for a boolean field. */
  | { kind: 'toggle'; path: string; label: string; absent?: boolean }
) & { hint?: string };

export interface FieldGroup {
  /** Panel id (DOM id `panel-<id>`). */
  id: string;
  title: string;
  fields: Field[];
}

const num = (path: string, label: string, min: number, max: number, step: number): Field => ({ kind: 'number', path, label, min, max, step });
const fraction = (path: string, label: string): Field => num(path, label, 0, 1, 0.01);
const optionalNum = (path: string, label: string, min: number, max: number, step: number, absent: number): Field => ({
  kind: 'number', path, label, min, max, step, absent,
});

/** The hint on Twist fields that only apply to a Corkscrew (they are never hidden or disabled). */
const CORKSCREW_ONLY = 'Corkscrew only';

export const PARAMETER_GROUPS: FieldGroup[] = [
  {
    id: 'tree',
    title: 'Tree',
    fields: [
      { kind: 'text', path: 'name', label: 'Name' },
    ],
  },
  {
    id: 'trunk',
    title: 'Trunk',
    fields: [
      num('trunk.length', 'Trunk length', 0.1, 30, 0.1),
      num('trunk.radius', 'Trunk radius', 0.01, 3, 0.01),
      fraction('trunk.taper', 'Taper'),
      num('trunk.sides', 'Sides', 3, 32, 1),
      num('trunk.sections', 'Sections', 1, 32, 1),
      fraction('trunk.lengthVariation', 'Length variation'),
      fraction('trunk.bend', 'Bend'),
      optionalNum('trunk.stems', 'Stems', 1, 8, 1, 1),
      optionalNum('trunk.spread', 'Stem spread', 0, 90, 1, 0),
      optionalNum('trunk.gravity', 'Trunk gravity', -1, 1, 0.01, 0),
      { kind: 'choice', path: 'trunk.twistStyle', label: 'Twist style', options: TWIST_STYLES, absent: 'snake' },
      optionalNum('trunk.twist', 'Twist', 0, 1, 0.01, 0),
      optionalNum('trunk.twists', 'Twists', 1, 8, 1, 2),
      { kind: 'choice', path: 'trunk.spin', label: 'Spin', options: SPINS, absent: 'random', hint: CORKSCREW_ONLY },
      { ...optionalNum('trunk.twistCurve', 'Twist curve', 0, 1, 0.01, 0), hint: CORKSCREW_ONLY },
      optionalNum('trunk.flare', 'Root Flare', 0, 1, 0.01, 0),
      optionalNum('trunk.flareSections', 'Root Flare sections', 1, 8, 1, 3),
    ],
  },
  {
    id: 'leaves',
    title: 'Leaves',
    fields: [
      { kind: 'choice', path: 'leaves.type', label: 'Leaf Type', options: LEAF_TYPES, absent: '' },
      num('leaves.count', 'Leaves per twig', 0, 64, 1),
      { kind: 'choice', path: 'leaves.shape', label: 'Leaf shape', options: ['card', 'clump', 'needle', 'puff'] },
      num('leaves.size', 'Leaf size', 0.01, 5, 0.01),
      fraction('leaves.sizeVariation', 'Size variation'),
      fraction('leaves.start', 'Leaves start'),
      num('leaves.angle', 'Leaf angle', 0, 180, 1),
    ],
  },
  {
    id: 'materials',
    title: 'Materials',
    fields: [
      { kind: 'choice', path: 'materials.shading', label: 'Shading', options: ['standard', 'flat', 'toon'] },
      { kind: 'choice', path: 'materials.bark.type', label: 'Bark Type', options: BARK_TYPES, absent: '' },
      { kind: 'color', path: 'materials.bark.color', label: 'Bark colour' },
      fraction('materials.bark.roughness', 'Bark roughness'),
      { kind: 'url', path: 'materials.bark.map', label: 'Bark texture' },
      { kind: 'url', path: 'materials.bark.normalMap', label: 'Bark normal map' },
      fraction('materials.leaf.roughness', 'Leaf roughness'),
      { kind: 'url', path: 'materials.leaf.map', label: 'Leaf texture' },
      fraction('materials.leaf.alphaTest', 'Alpha cut-off'),
    ],
  },
  {
    id: 'wind',
    title: 'Wind response',
    fields: [
      fraction('wind.trunk', 'Trunk sway'),
      fraction('wind.branches', 'Branch sway'),
      fraction('wind.leaves', 'Leaf flutter'),
      num('wind.frequency', 'Sway speed', 0.05, 4, 0.05),
    ],
  },
  {
    id: 'variation',
    title: 'Seed variation',
    fields: [
      fraction('variation.color', 'Colour variation'),
      fraction('variation.growth', 'Growth timing spread'),
      fraction('variation.season', 'Season timing spread'),
    ],
  },
];

/** The fields of the optional `fruit` block (shown while the Definition has Fruit). */
export const FRUIT_FIELDS: Field[] = [
  { kind: 'choice', path: 'fruit.type', label: 'Fruit Type', options: FRUIT_TYPES },
  // A fraction is a chance per twig (0.3 = Fruit on about 30% of the twigs).
  num('fruit.count', 'Fruit per twig', 0, 8, 0.05),
  num('fruit.size', 'Fruit size', 0.01, 0.5, 0.01),
  fraction('fruit.sizeVariation', 'Size variation'),
  fraction('fruit.hang', 'Hang'),
  optionalNum('fruit.sides', 'Fruit sides', 3, 16, 1, 8),
];

/**
 * The fields of the optional `roots` block (shown while the Definition has Roots). Their polygon
 * detail (`roots.sides`, `roots.sections`) is left to the Style.
 */
export const ROOTS_FIELDS: Field[] = [
  num('roots.count', 'Roots per Stem', 0, 12, 1),
  fraction('roots.length', 'Root length'),
  fraction('roots.lengthVariation', 'Root length variation'),
  fraction('roots.radius', 'Root radius'),
  num('roots.angle', 'Dive angle', 0, 60, 1),
  fraction('roots.bend', 'Root bend'),
];

/**
 * The fields of the optional Ground Tint block `materials.bark.groundTint` (shown in the Materials
 * panel while the Ground Tint toggle is on).
 */
export const GROUND_TINT_FIELDS: Field[] = [
  { kind: 'color', path: 'materials.bark.groundTint.color', label: 'Ground Tint colour' },
  num('materials.bark.groundTint.height', 'Ground Tint height', 0.05, 5, 0.05),
  fraction('materials.bark.groundTint.strength', 'Ground Tint strength'),
];

/**
 * The Material Features (ADR 0008) in the Materials panel's "Material features" group: a toggle per
 * feature (on writes `path`, off removes it: absent = off) and, while it is on, its sliders.
 */
export const MATERIAL_FEATURES: {
  key: keyof MaterialFeatures;
  label: string;
  /** Where the feature lives in the Definition (a number or a block). */
  path: string;
  fields: Field[];
}[] = [
  {
    key: 'crownNormals',
    label: 'Crown Normals',
    path: 'materials.leaf.crownNormals',
    fields: [fraction('materials.leaf.crownNormals', 'Crown Normals amount')],
  },
  {
    key: 'translucency',
    label: 'Leaf Translucency',
    path: 'materials.leaf.translucency',
    fields: [
      fraction('materials.leaf.translucency.strength', 'Translucency strength'),
      fraction('materials.leaf.translucency.edge', 'Translucency edge'),
      fraction('materials.leaf.translucency.ambient', 'Translucency ambient'),
    ],
  },
  {
    key: 'occlusion',
    label: 'Structural Occlusion',
    path: 'materials.occlusion',
    fields: [fraction('materials.occlusion.strength', 'Occlusion strength')],
  },
];

/**
 * The fields of one branching level; paths relative to `branches.<i>`. The Twist group (Twist style,
 * Twist, Twists, Spin, Twist curve, Follow twist) is optional (`absent`); fields that only apply to a Corkscrew say so in a hint.
 */
export const BRANCH_LEVEL_FIELDS: Field[] = [
  { kind: 'number', path: 'count', label: 'Count', min: 0, max: 32, step: 1 },
  { kind: 'number', path: 'start', label: 'Start', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'end', label: 'End', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'angle', label: 'Angle', min: 0, max: 180, step: 1 },
  { kind: 'number', path: 'angleVariation', label: 'Angle variation', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'spiral', label: 'Spiral', min: 0, max: 360, step: 0.5 },
  { kind: 'number', path: 'length', label: 'Length', min: 0.05, max: 2, step: 0.01 },
  { kind: 'number', path: 'lengthVariation', label: 'Length variation', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'radius', label: 'Radius', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'taper', label: 'Taper', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'sides', label: 'Sides', min: 3, max: 16, step: 1 },
  { kind: 'number', path: 'sections', label: 'Sections', min: 1, max: 16, step: 1 },
  { kind: 'number', path: 'bend', label: 'Bend', min: 0, max: 1, step: 0.01 },
  { kind: 'number', path: 'gravity', label: 'Gravity', min: -1, max: 1, step: 0.01 },
  { kind: 'choice', path: 'twistStyle', label: 'Twist style', options: TWIST_STYLES, absent: 'snake' },
  { kind: 'number', path: 'twist', label: 'Twist', min: 0, max: 1, step: 0.01, absent: 0 },
  { kind: 'number', path: 'twists', label: 'Twists', min: 1, max: 8, step: 1, absent: 2 },
  { kind: 'choice', path: 'spin', label: 'Spin', options: SPINS, absent: 'random', hint: CORKSCREW_ONLY },
  { kind: 'number', path: 'twistCurve', label: 'Twist curve', min: 0, max: 1, step: 0.01, absent: 0, hint: CORKSCREW_ONLY },
  { kind: 'toggle', path: 'followTwist', label: 'Follow twist', absent: false, hint: CORKSCREW_ONLY },
];

/** Crown Shape curve flat at 1 (what an absent curve means). */
const FLAT_CURVE: Keyframe<number>[] = [{ t: 0, value: 1 }];

/**
 * The Crown Shape curves of one branching level (keyframe tracks over the attach position on the
 * parent, 0 = base .. 1 = tip); `min`..`max` = the value slider's range (typed values may go higher).
 */
export const BRANCH_LEVEL_CURVES: {
  key: keyof BranchLevelDefinition & ('lengthProfile' | 'angleProfile');
  label: string;
  min: number;
  max: number;
  absent: Keyframe<number>[];
}[] = [
  { key: 'lengthProfile', label: 'Length curve', min: 0, max: 2, absent: FLAT_CURVE },
  { key: 'angleProfile', label: 'Angle curve', min: 0, max: 2, absent: FLAT_CURVE },
];

type SeasonTrackKey = Exclude<keyof TreeDefinition['season'], 'blossomColor'>;

/**
 * The Season Profile keyframe tracks; `kind` is the type of a keyframe's value. Optional tracks have
 * `absent` (the track in force while it is absent; the first edit writes it) and `fruit` (only shown with Fruit).
 */
export const SEASON_TRACKS: {
  key: SeasonTrackKey;
  label: string;
  kind: 'color' | 'fraction';
  absent?: Keyframe<HexColor | number>[];
  fruit?: true;
}[] = [
  { key: 'leafColor', label: 'Leaf colour', kind: 'color' },
  { key: 'leafCoverage', label: 'Leaf coverage', kind: 'fraction' },
  { key: 'blossom', label: 'Blossom', kind: 'fraction' },
  { key: 'fruit', label: 'Fruit amount', kind: 'fraction', absent: DEFAULT_FRUIT_AMOUNT, fruit: true },
  { key: 'fruitColor', label: 'Fruit colour', kind: 'color', absent: DEFAULT_FRUIT_COLOR, fruit: true },
];

/** Season fields that are not tracks. */
export const SEASON_FIELDS: Field[] = [{ kind: 'color', path: 'season.blossomColor', label: 'Blossom colour' }];
