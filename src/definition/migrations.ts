/**
 * Schema migrations. `MIGRATIONS[n]` turns a raw (unvalidated) schemaVersion `n` object into
 * a raw schemaVersion `n + 1` object. Migrations run in order before defaults and validation,
 * so they only need to move/rename what changed; missing fields are defaulted afterwards.
 *
 * To change the format: bump CURRENT_SCHEMA_VERSION, add `MIGRATIONS[old]`, and add a
 * fixture in test/fixtures/definition-v<old>.json with a test.
 */
type Raw = Record<string, unknown>;

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
};
