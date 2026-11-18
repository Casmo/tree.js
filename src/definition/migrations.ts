/**
 * Schema migrations. `MIGRATIONS[n]` turns a raw (unvalidated) schemaVersion `n` object into
 * a raw schemaVersion `n + 1` object. Migrations run in order before defaults and validation,
 * so they only need to move/rename what changed; missing fields are defaulted afterwards.
 *
 * To change the format: bump CURRENT_SCHEMA_VERSION, add `MIGRATIONS[old]`, and add a
 * fixture in test/fixtures/definition-v<old>.json with a test.
 */
import { DEFAULT_BRANCH_LEVEL, DEFAULT_DEFINITION } from './defaults';

type Raw = Record<string, unknown>;

/** The v2 conifer cone's shortest trunk branch, as a fraction of the declared length. */
const MIN_CONE = 0.1;

/**
 * The v2 conifer cone as a Crown Shape length curve: full length at the level's `start`, shrinking
 * linearly to {@link MIN_CONE} of it at the trunk tip, never below MIN_CONE (the old generator
 * computed `max(0.1, (1 - t) / (1 - start))`; this curve is the same line).
 */
function coneProfile(start: number) {
  return [
    { t: start, value: 1 },
    { t: 1 - MIN_CONE * (1 - start), value: MIN_CONE },
    { t: 1, value: MIN_CONE },
  ];
}

export const MIGRATIONS: Record<number, (input: Raw) => Raw> = {
  /**
   * v1 -> v2: `bark` moved into `materials.bark`; branches, leaves, Season Profile, Wind,
   * variation and sculpts were added. A v1 tree was a bare trunk, so it keeps no branches
   * and no leaves (same tree as before).
   */
  1: (input) => {
    const { bark, ...rest } = input;
    return {
      ...rest,
      schemaVersion: 2,
      branches: [],
      leaves: { count: 0 },
      ...(bark === undefined ? {} : { materials: { bark } }),
    };
  },
  /**
   * v2 -> v3: `form` is removed (ADR 0004). A conifer's cone becomes a Crown Shape length curve on
   * the first branch level (identical tree); a broadleaf just drops `form`. Unknown `form` values are
   * kept so validation reports them.
   */
  2: (input) => {
    const { form, ...rest } = input;
    const out: Raw = { ...rest, schemaVersion: 3 };
    if (form !== undefined && form !== 'broadleaf' && form !== 'conifer') out.form = form;
    if (form !== 'conifer') return out;
    // A v2 Definition without `branches` grew the default levels; make them explicit to curve the first.
    const branches = Array.isArray(rest.branches) ? rest.branches : DEFAULT_DEFINITION.branches.map((b) => ({ ...b }));
    if (branches.length === 0) return out;
    const [first, ...deeper] = branches as unknown[];
    if (typeof first !== 'object' || first === null || Array.isArray(first)) return out; // validation reports it
    const level = first as Raw;
    const start = typeof level.start === 'number' ? level.start : DEFAULT_BRANCH_LEVEL.start;
    return { ...out, branches: [{ ...level, lengthProfile: coneProfile(start) }, ...deeper] };
  },
};
