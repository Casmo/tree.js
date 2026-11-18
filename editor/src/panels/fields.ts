// What the parameter panels edit: one entry per Tree Definition field, with its label and the
// slider range offered (the schema still validates every value; typed numbers may go beyond the
// slider). Pure data, so a test can check that every Definition field has a control.
import type { TreeDefinition } from '@casmo/tree.js';

export type Field =
  | { kind: 'number'; path: string; label: string; min: number; max: number; step: number }
  | { kind: 'choice'; path: string; label: string; options: readonly string[] }
  | { kind: 'color'; path: string; label: string }
  /** A texture URL; empty = null (no texture). */
  | { kind: 'url'; path: string; label: string }
  | { kind: 'text'; path: string; label: string };

export interface FieldGroup {
  /** Panel id (DOM id `panel-<id>`). */
  id: string;
  title: string;
  fields: Field[];
}

const num = (path: string, label: string, min: number, max: number, step: number): Field => ({ kind: 'number', path, label, min, max, step });
const fraction = (path: string, label: string): Field => num(path, label, 0, 1, 0.01);

export const PARAMETER_GROUPS: FieldGroup[] = [
  {
    id: 'tree',
    title: 'Tree',
    fields: [
      { kind: 'text', path: 'name', label: 'Name' },
      { kind: 'choice', path: 'form', label: 'Form', options: ['broadleaf', 'conifer'] },
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
    ],
  },
  {
    id: 'leaves',
    title: 'Leaves',
    fields: [
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

/** The fields of one branching level; paths relative to `branches.<i>`. */
export const BRANCH_LEVEL_FIELDS: Extract<Field, { kind: 'number' }>[] = [
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
];

type SeasonTrackKey = Exclude<keyof TreeDefinition['season'], 'blossomColor'>;

/** The Season Profile keyframe tracks; `kind` is the type of a keyframe's value. */
export const SEASON_TRACKS: { key: SeasonTrackKey; label: string; kind: 'color' | 'fraction' }[] = [
  { key: 'leafColor', label: 'Leaf colour', kind: 'color' },
  { key: 'leafCoverage', label: 'Leaf coverage', kind: 'fraction' },
  { key: 'blossom', label: 'Blossom', kind: 'fraction' },
];

/** Season fields that are not tracks. */
export const SEASON_FIELDS: Field[] = [{ kind: 'color', path: 'season.blossomColor', label: 'Blossom colour' }];
