import { MIGRATIONS } from './migrations';
import { isObject, TreeDefinitionError, validateDefinition } from './schema';
import { CURRENT_SCHEMA_VERSION, type DeepPartial, type TreeDefinition, type TreeDefinitionInput } from './types';

export { TreeDefinitionError } from './schema';

/**
 * Turns untrusted input into a complete, valid Tree Definition:
 * - `input` is a Definition object (e.g. parsed JSON) or a JSON string;
 * - older `schemaVersion`s are migrated to {@link CURRENT_SCHEMA_VERSION};
 * - missing fields are filled from {@link DEFAULT_DEFINITION} (missing fields of a
 *   `branches[i]` entry from {@link DEFAULT_BRANCH_LEVEL});
 * - every field is validated; unknown fields are rejected.
 * Throws {@link TreeDefinitionError} naming the first bad field (`field`, e.g. `branches[1].angle`).
 * Never mutates `input`.
 */
export function parseDefinition(input: unknown): TreeDefinition {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      throw new TreeDefinitionError('(root)', `is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!isObject(raw)) throw new TreeDefinitionError('(root)', 'must be an object');
  const version = raw.schemaVersion;
  if (version === undefined) throw new TreeDefinitionError('schemaVersion', 'is missing');
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new TreeDefinitionError('schemaVersion', `must be an integer >= 1, got ${JSON.stringify(version)}`);
  }
  if ((version as number) > CURRENT_SCHEMA_VERSION) {
    throw new TreeDefinitionError(
      'schemaVersion',
      `is ${version}, newer than this version of @casmo/tree.js supports (${CURRENT_SCHEMA_VERSION}); upgrade the library`,
    );
  }
  for (let v = version as number; v < CURRENT_SCHEMA_VERSION; v++) raw = MIGRATIONS[v]!(raw as Record<string, unknown>);
  return validateDefinition(raw as Record<string, unknown>);
}

/** Changes to apply on top of a Definition: any subset of its fields (arrays replace as a whole). */
export type DefinitionPatch = DeepPartial<Omit<TreeDefinition, 'schemaVersion'>>;

/**
 * Starts from a Definition (e.g. a built-in Style) and changes a few parameters:
 * objects are merged deeply, arrays and values replace. Returns a new, validated Definition.
 *
 * ```ts
 * const tall = extendDefinition(broadleaf, { trunk: { length: 7 }, wind: { leaves: 1 } });
 * ```
 */
export function extendDefinition(base: TreeDefinition | TreeDefinitionInput, patch: DefinitionPatch): TreeDefinition {
  const parsed = parseDefinition(base);
  if (!isObject(patch)) throw new TreeDefinitionError('(root)', 'patch must be an object');
  return parseDefinition({ ...merge(parsed as unknown as Record<string, unknown>, patch), schemaVersion: CURRENT_SCHEMA_VERSION });
}

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

/**
 * Fetches a Tree Definition JSON file (e.g. a Tree Editor export) and parses it with
 * {@link parseDefinition}. Rejects with an Error for an HTTP error, or a TreeDefinitionError.
 */
export async function fetchDefinition(url: string | URL, init?: RequestInit): Promise<TreeDefinition> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Could not load Tree Definition from ${String(url)}: HTTP ${response.status}`);
  return parseDefinition(await response.text());
}
