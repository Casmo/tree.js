import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION, parseDefinition } from '@casmo/tree.js';
import { BRANCH_LEVEL_FIELDS, PARAMETER_GROUPS, SEASON_FIELDS, SEASON_TRACKS, type Field } from './fields';

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

const editable = [
  ...PARAMETER_GROUPS.flatMap((group) => group.fields.map((field) => field.path)),
  ...BRANCH_LEVEL_FIELDS.map((field) => `branches.*.${field.path}`),
  ...SEASON_FIELDS.map((field) => field.path),
  ...SEASON_TRACKS.map((track) => `season.${track.key}`),
];

describe('parameter panels', () => {
  it('offer a control for every Definition field (Sculpts are edited in the preview, #20)', () => {
    const paths = parameterPaths(DEFAULT_DEFINITION).filter((path) => path !== 'schemaVersion' && path !== 'sculpts');
    expect(paths).toContain('materials.bark.normalMap');
    expect(paths).toContain('branches.*.gravity');
    expect([...editable].sort()).toEqual([...paths].sort());
  });

  it('have slider ranges the schema accepts, around the default values', () => {
    const numbers = [
      ...PARAMETER_GROUPS.flatMap((group) => group.fields),
      ...BRANCH_LEVEL_FIELDS.map((field) => ({ ...field, path: `branches.0.${field.path}` })),
    ].filter((field): field is Extract<Field, { kind: 'number' }> => field.kind === 'number');
    for (const field of numbers) {
      const [section, ...rest] = field.path.split('.');
      const set = (value: number) => {
        const patch = structuredClone(DEFAULT_DEFINITION) as unknown as Record<string, unknown>;
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

  it('offer exactly the choices the schema accepts', () => {
    const choices = PARAMETER_GROUPS.flatMap((group) => group.fields).filter((field) => field.kind === 'choice');
    expect(Object.fromEntries(choices.map((field) => [field.path, field.options]))).toEqual({
      'leaves.shape': ['card', 'clump', 'needle', 'puff'],
      'materials.shading': ['standard', 'flat', 'toon'],
    });
  });
});
