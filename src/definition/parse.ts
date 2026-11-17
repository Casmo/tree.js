import { DEFAULT_BRANCH_LEVEL, DEFAULT_DEFINITION } from './defaults';
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from './types';

/** Thrown for an invalid Tree Definition; `field` is the dotted path of the bad field. */
export class TreeDefinitionError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`Invalid Tree Definition: ${field} ${message}`);
    this.name = 'TreeDefinitionError';
    this.field = field;
  }
}

type Rule = (value: unknown) => string | null;

const positive: Rule = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : 'must be a number > 0');
const unit: Rule = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? null : 'must be a number from 0 to 1');
const intAtLeast =
  (min: number): Rule =>
  (v) => (Number.isInteger(v) && (v as number) >= min ? null : `must be an integer >= ${min}`);
const hexColor: Rule = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? null : 'must be a colour like "#6b4a2b"');

const between =
  (min: number, max: number): Rule =>
  (v) => (typeof v === 'number' && v >= min && v <= max ? null : `must be a number from ${min} to ${max}`);

type Rules = Record<string, Rule>;

const BRANCH_LEVEL_RULES: Rules = {
  count: intAtLeast(0),
  countVariation: unit,
  start: unit,
  length: positive,
  lengthVariation: unit,
  radius: unit,
  taper: unit,
  angle: between(0, 180),
  angleVariation: between(0, 180),
  bend: unit,
  sides: intAtLeast(3),
  sections: intAtLeast(1),
};

const RULES: Record<string, Rules> = {
  trunk: {
    length: positive,
    radius: positive,
    taper: unit,
    sides: intAtLeast(3),
    sections: intAtLeast(1),
    lengthVariation: unit,
    bend: unit,
  },
  bark: { color: hexColor },
  leaves: {
    count: intAtLeast(0),
    start: unit,
    size: positive,
    sizeVariation: unit,
    color: hexColor,
    colorVariation: unit,
  },
};


function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Turns untrusted input (e.g. parsed JSON) into a complete, valid Tree Definition:
 * checks `schemaVersion`, fills defaults and validates every field.
 * Throws {@link TreeDefinitionError} naming the first bad field.
 *
 * Full schema, migration of older versions and richer validation: ticket #3.
 */
export function parseDefinition(input: unknown): TreeDefinition {
  if (!isObject(input)) throw new TreeDefinitionError('(root)', 'must be an object');
  if (input.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new TreeDefinitionError(
      'schemaVersion',
      input.schemaVersion === undefined
        ? 'is missing'
        : `must be ${CURRENT_SCHEMA_VERSION}, got ${JSON.stringify(input.schemaVersion)}`,
    );
  }
  const out: Record<string, unknown> = { schemaVersion: CURRENT_SCHEMA_VERSION };
  for (const [section, rules] of Object.entries(RULES)) {
    const defaults = (DEFAULT_DEFINITION as unknown as Record<string, Record<string, unknown>>)[section]!;
    out[section] = parseSection(section, input[section], defaults, rules);
  }
  // Branch levels: a given array replaces the default levels; each level is filled from DEFAULT_BRANCH_LEVEL.
  const branches = input.branches;
  if (branches === undefined) {
    out.branches = DEFAULT_DEFINITION.branches.map((level) => ({ ...level }));
  } else if (!Array.isArray(branches)) {
    throw new TreeDefinitionError('branches', 'must be an array of branch levels');
  } else {
    out.branches = branches.map((level: unknown, i) =>
      parseSection(`branches.${i}`, level, { ...DEFAULT_BRANCH_LEVEL }, BRANCH_LEVEL_RULES),
    );
  }
  return out as unknown as TreeDefinition;
}

function parseSection(
  field: string,
  given: unknown,
  defaults: Record<string, unknown>,
  rules: Rules,
): Record<string, unknown> {
  if (given !== undefined && !isObject(given)) throw new TreeDefinitionError(field, 'must be an object');
  const merged: Record<string, unknown> = { ...defaults, ...given };
  for (const [key, rule] of Object.entries(rules)) {
    const problem = rule(merged[key]);
    if (problem) throw new TreeDefinitionError(`${field}.${key}`, `${problem}, got ${JSON.stringify(merged[key])}`);
  }
  return merged;
}
