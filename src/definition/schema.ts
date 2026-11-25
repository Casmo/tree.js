import {
  DEFAULT_BRANCH_LEVEL,
  DEFAULT_DEFINITION,
  DEFAULT_FRUIT,
  DEFAULT_GROUND_TINT,
  DEFAULT_OCCLUSION,
  DEFAULT_ROOTS,
  DEFAULT_TRANSLUCENCY,
} from './defaults';
import {
  BARK_TYPES,
  FRUIT_TYPES,
  CURRENT_SCHEMA_VERSION,
  LEAF_TYPES,
  MAX_BRANCH_LEVELS,
  type BarkMaterialDefinition,
  type BranchLevelDefinition,
  type DeleteSculpt,
  type FruitDefinition,
  type GroundTintDefinition,
  type LeafMaterialDefinition,
  type MaterialsDefinition,
  type OcclusionDefinition,
  type RootsDefinition,
  type TranslucencyDefinition,
  type SeasonProfileDefinition,
  type Keyframe,
  type LeavesDefinition,
  type LeavesSculpt,
  type MoveSculpt,
  type Sculpt,
  type TreeDefinition,
  type TrunkDefinition,
} from './types';

/** Thrown for an invalid Tree Definition; `field` is the path of the bad field, e.g. `branches[1].angle`. */
export class TreeDefinitionError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`Invalid Tree Definition: ${field} ${message}`);
    this.name = 'TreeDefinitionError';
    this.field = field;
  }
}

/**
 * A schema node: validates `value` at `path`, filling it from `fallback` (the default)
 * when it is undefined, and returns a fresh, complete value. Throws TreeDefinitionError.
 */
type Schema<T> = (value: unknown, fallback: T | undefined, path: string) => T;

const ROOT = '(root)';
const join = (path: string, key: string) => (path === ROOT ? key : `${path}.${key}`);
const show = (v: unknown) => (v === undefined ? 'undefined' : JSON.stringify(v));

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Leaf schema from a predicate; `undefined` takes the fallback, or is reported missing. */
function leaf<T>(expected: string, ok: (v: unknown) => boolean): Schema<T> {
  return (value, fallback, path) => {
    const v = value === undefined ? fallback : value;
    if (v === undefined) throw new TreeDefinitionError(path, 'is missing');
    if (!ok(v)) throw new TreeDefinitionError(path, `must be ${expected}, got ${show(v)}`);
    return (Array.isArray(v) ? [...v] : v) as T;
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const range = (min: number, max: number) => leaf<number>(`a number from ${min} to ${max}`, (v) => isNum(v) && v >= min && v <= max);
const unit = range(0, 1);
const nonNegative = leaf<number>('a number >= 0', (v) => isNum(v) && v >= 0);
const positive = leaf<number>('a number > 0', (v) => isNum(v) && v > 0);
const finite = leaf<number>('a finite number', isNum);
const intAtLeast = (min: number) => leaf<number>(`an integer >= ${min}`, (v) => Number.isInteger(v) && (v as number) >= min);
const intRange = (min: number, max: number) =>
  leaf<number>(`an integer from ${min} to ${max}`, (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max);
/** Faces around a Fruit or a Root (its polygon detail). */
const partSides = intRange(3, 16);
const hexColor = leaf<string>('a colour like "#6b4a2b"', (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));
const text = leaf<string>('a string', (v) => typeof v === 'string');
const url = leaf<string | null>('a URL string or null', (v) => v === null || (typeof v === 'string' && v.length > 0));
const vec3 = leaf<[number, number, number]>('[x, y, z] numbers', (v) => Array.isArray(v) && v.length === 3 && v.every(isNum));
const oneOf = <T extends string>(...values: T[]) =>
  leaf<T>(`one of ${values.map((x) => `"${x}"`).join(', ')}`, (v) => values.includes(v as T));
const literal = <T>(expected: T) => leaf<T>(String(expected), (v) => v === expected);

/** An optional field: absent (undefined) stays absent, anything else must match `schema`. */
function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return (value, fallback, path) => (value === undefined && fallback === undefined ? undefined : schema(value, fallback, path));
}

/** An optional block: absent stays absent; a given (possibly partial) block is filled from `defaults`. */
function optionalBlock<T>(schema: Schema<T>, defaults: T): Schema<T | undefined> {
  return (value, fallback, path) => (value === undefined && fallback === undefined ? undefined : schema(value, fallback ?? defaults, path));
}

/** Object with exactly these fields; unknown fields are rejected (catches typos). */
function obj<T>(fields: { [K in keyof T]-?: Schema<T[K]> }): Schema<T> {
  return (value, fallback, path) => {
    if (value === undefined && fallback === undefined) throw new TreeDefinitionError(path, 'is missing');
    const given = value === undefined ? {} : value;
    if (!isObject(given)) throw new TreeDefinitionError(path, `must be an object, got ${show(given)}`);
    for (const key of Object.keys(given)) {
      if (!(key in fields)) throw new TreeDefinitionError(join(path, key), 'is not a known field');
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      const field = fields[key](given[key], fallback?.[key], join(path, key));
      // Optional fields (see `optional`) that are absent stay absent.
      if (field !== undefined) out[key] = field;
    }
    return out as T;
  };
}

/** Array; a missing array takes the fallback array, each item is filled from `itemFallback`. */
function arr<T>(item: Schema<T>, opts: { min?: number; max?: number; itemFallback?: T } = {}): Schema<T[]> {
  const { min = 0, max = Infinity, itemFallback } = opts;
  return (value, fallback, path) => {
    const v = value === undefined ? fallback : value;
    if (v === undefined) throw new TreeDefinitionError(path, 'is missing');
    if (!Array.isArray(v)) throw new TreeDefinitionError(path, `must be an array, got ${show(v)}`);
    if (v.length < min) throw new TreeDefinitionError(path, `must have at least ${min} entries`);
    if (v.length > max) throw new TreeDefinitionError(path, `must have at most ${max} entries`);
    return v.map((x, i) => item(x, itemFallback, `${path}[${i}]`));
  };
}

/** Adds a cross-field check; `check` returns [field, problem] or null. */
function refine<T>(schema: Schema<T>, check: (v: T) => [string, string] | null): Schema<T> {
  return (value, fallback, path) => {
    const v = schema(value, fallback, path);
    const problem = check(v);
    if (problem) throw new TreeDefinitionError(join(path, problem[0]), problem[1]);
    return v;
  };
}

/** Union discriminated by `key`. */
function tagged<T>(key: string, variants: Record<string, Schema<T>>): Schema<T> {
  const names = Object.keys(variants);
  return (value, fallback, path) => {
    if (!isObject(value)) throw new TreeDefinitionError(path, `must be an object, got ${show(value)}`);
    const variant = variants[value[key] as string];
    if (!variant) {
      throw new TreeDefinitionError(join(path, key), `must be one of ${names.map((n) => `"${n}"`).join(', ')}, got ${show(value[key])}`);
    }
    return variant(value, fallback, path);
  };
}

/** Keyframe track: at least one key, `t` in 0..1 and non-decreasing. */
function track<V>(value: Schema<V>): Schema<Keyframe<V>[]> {
  const keys = arr(obj<Keyframe<V>>({ t: unit, value }), { min: 1 });
  return (v, fallback, path) => {
    const out = keys(v, fallback, path);
    for (let i = 1; i < out.length; i++) {
      if (out[i]!.t < out[i - 1]!.t) {
        throw new TreeDefinitionError(`${path}[${i}].t`, `must be >= the previous keyframe's t (${out[i - 1]!.t}), got ${out[i]!.t}`);
      }
    }
    return out;
  };
}

const branchLevel = refine(
  obj<BranchLevelDefinition>({
    count: intAtLeast(0),
    start: unit,
    end: unit,
    angle: range(0, 180),
    angleVariation: unit,
    spiral: range(0, 360),
    length: positive,
    lengthVariation: unit,
    radius: unit,
    taper: unit,
    sides: intAtLeast(3),
    sections: intAtLeast(1),
    bend: unit,
    gravity: range(-1, 1),
    twist: optional(unit),
    twists: optional(intRange(1, 8)),
    lengthProfile: optional(track(nonNegative)),
    angleProfile: optional(track(nonNegative)),
  }),
  (b) => (b.end < b.start ? ['end', `must be >= start (${b.start}), got ${b.end}`] : null),
);

const branchPath = leaf<string>('a branch path like "0", "1" or "0.3.1"', (v) => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v));
const sculpt = tagged<Sculpt>('action', {
  delete: obj<DeleteSculpt>({ action: literal('delete'), seed: finite, path: branchPath }) as Schema<Sculpt>,
  move: obj<MoveSculpt>({ action: literal('move'), seed: finite, path: branchPath, rotation: vec3, scale: positive }) as Schema<Sculpt>,
  leaves: obj<LeavesSculpt>({ action: literal('leaves'), seed: finite, path: branchPath, coverage: unit }) as Schema<Sculpt>,
});

/** The whole Tree Definition schema (current version). Mirrors the interfaces in types.ts. */
const treeDefinition = obj<TreeDefinition>({
  schemaVersion: literal(CURRENT_SCHEMA_VERSION),
  name: text,
  species: optional(text),
  styleScale: optional(positive),
  trunk: obj<TrunkDefinition>({
    length: positive,
    radius: positive,
    taper: unit,
    sides: intAtLeast(3),
    sections: intAtLeast(1),
    lengthVariation: unit,
    bend: unit,
    stems: optional(intAtLeast(1)),
    spread: optional(range(0, 90)),
    gravity: optional(range(-1, 1)),
    twist: optional(unit),
    twists: optional(intRange(1, 8)),
    flare: optional(unit),
    flareSections: optional(intAtLeast(1)),
  }),
  branches: arr(branchLevel, { max: MAX_BRANCH_LEVELS, itemFallback: DEFAULT_BRANCH_LEVEL }),
  leaves: obj<LeavesDefinition>({
    type: optional(oneOf(...LEAF_TYPES)),
    count: intAtLeast(0),
    shape: oneOf('card', 'clump', 'needle', 'puff', 'mass'),
    size: positive,
    sizeVariation: unit,
    start: unit,
    angle: range(0, 180),
    masses: optional(intAtLeast(1)),
    massLayering: optional(positive),
  }),
  fruit: optionalBlock<FruitDefinition>(
    obj<FruitDefinition>({
      type: oneOf(...FRUIT_TYPES),
      count: nonNegative,
      size: positive,
      sizeVariation: unit,
      hang: unit,
      sides: optional(partSides),
    }),
    DEFAULT_FRUIT,
  ),
  roots: optionalBlock<RootsDefinition>(
    obj<RootsDefinition>({
      count: intRange(0, 12),
      length: unit,
      lengthVariation: unit,
      radius: unit,
      angle: range(0, 60),
      bend: unit,
      sides: optional(partSides),
      sections: optional(intAtLeast(1)),
    }),
    DEFAULT_ROOTS,
  ),
  materials: obj<MaterialsDefinition>({
    shading: oneOf('standard', 'flat', 'toon', 'painted'),
    bark: obj<BarkMaterialDefinition>({
      type: optional(oneOf(...BARK_TYPES)),
      color: hexColor,
      roughness: unit,
      map: url,
      normalMap: url,
      groundTint: optionalBlock<GroundTintDefinition>(
        obj<GroundTintDefinition>({ color: hexColor, height: positive, strength: unit }),
        DEFAULT_GROUND_TINT,
      ),
    }),
    leaf: obj<LeafMaterialDefinition>({
      roughness: unit,
      map: url,
      alphaTest: unit,
      // Material Features (ADR 0008): optional, absent = off.
      crownNormals: optional(unit),
      translucency: optionalBlock<TranslucencyDefinition>(
        obj<TranslucencyDefinition>({ strength: unit, edge: unit, ambient: unit }),
        DEFAULT_TRANSLUCENCY,
      ),
    }),
    occlusion: optionalBlock<OcclusionDefinition>(obj<OcclusionDefinition>({ strength: unit }), DEFAULT_OCCLUSION),
  }),
  season: obj<SeasonProfileDefinition>({
    leafColor: track(hexColor),
    leafCoverage: track(unit),
    blossom: track(unit),
    blossomColor: hexColor,
    fruit: optional(track(unit)),
    fruitColor: optional(track(hexColor)),
  }),
  wind: obj({ trunk: unit, branches: unit, leaves: unit, frequency: positive }),
  variation: obj({ color: unit, growth: unit, season: unit }),
  sculpts: arr(sculpt),
});

/**
 * Validates a raw current-version Definition and fills every missing field from
 * {@link DEFAULT_DEFINITION}. Returns a fresh object (never aliases input or defaults).
 */
export function validateDefinition(raw: Record<string, unknown>): TreeDefinition {
  return treeDefinition(raw, DEFAULT_DEFINITION, ROOT);
}
