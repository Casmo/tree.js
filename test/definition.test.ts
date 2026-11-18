import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createTree,
  DEFAULT_BRANCH_LEVEL,
  DEFAULT_DEFINITION,
  extendDefinition,
  fetchDefinition,
  parseDefinition,
  TreeDefinitionError,
  type TreeDefinitionInput,
} from '../src/index';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TreeDefinitionError);
    return (e as TreeDefinitionError).field;
  }
  throw new Error('expected a TreeDefinitionError');
}

describe('Definition migration', () => {
  it('migrates a schemaVersion 1 file (bark colour moves to materials, no branches or leaves)', () => {
    const def = parseDefinition(fixture('definition-v1.json'));
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(def.schemaVersion).toBe(2);
    expect(def.trunk.length).toBe(5);
    expect(def.trunk.sides).toBe(7);
    expect(def.materials.bark.color).toBe('#55402a');
    expect(def).not.toHaveProperty('bark');
    // A v1 tree was a bare trunk; migration keeps it that way.
    expect(def.branches).toEqual([]);
    expect(def.leaves.count).toBe(0);
    expect(def.sculpts).toEqual([]);
  });

  it('createTree accepts a v1 file', () => {
    expect(createTree(fixture('definition-v1.json') as TreeDefinitionInput, { seed: 3 }).definition.schemaVersion).toBe(2);
  });

  it('rejects a schemaVersion newer than this library supports', () => {
    expect(fieldOf(() => parseDefinition({ schemaVersion: 99 }))).toBe('schemaVersion');
  });
});

describe('Definition defaults', () => {
  it('fills a minimal Definition with the documented defaults', () => {
    expect(parseDefinition({ schemaVersion: 2 })).toEqual(DEFAULT_DEFINITION);
  });

  it('keeps given values and fills the rest of that section', () => {
    const def = parseDefinition({ schemaVersion: 2, trunk: { length: 7 }, wind: { leaves: 0.1 } });
    expect(def.trunk.length).toBe(7);
    expect(def.trunk.radius).toBe(0.25);
    expect(def.wind).toEqual({ trunk: 0.2, branches: 0.5, leaves: 0.1, frequency: 1 });
  });

  it('replaces the branches array and fills each partial level from DEFAULT_BRANCH_LEVEL', () => {
    const def = parseDefinition({ schemaVersion: 2, branches: [{ count: 3 }] });
    expect(def.branches).toHaveLength(1);
    expect(def.branches[0]).toEqual({ ...DEFAULT_BRANCH_LEVEL, count: 3 });
  });

  it('never returns objects shared with the defaults or the input', () => {
    const input = { schemaVersion: 2, trunk: { length: 3 } };
    const def = parseDefinition(input);
    def.trunk.length = 99;
    def.season.leafColor[0]!.value = '#000000';
    expect(input.trunk.length).toBe(3);
    expect(DEFAULT_DEFINITION.season.leafColor[0]!.value).not.toBe('#000000');
    expect(parseDefinition({ schemaVersion: 2 }).trunk.length).toBe(4);
  });

  it('fills a fully valid Definition back to itself (round-trips through JSON)', () => {
    const def = parseDefinition({ schemaVersion: 2, sculpts: [{ seed: 4, path: '0.2', action: 'delete' }] });
    expect(parseDefinition(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });
});

describe('Definition validation names the bad field', () => {
  const cases: [string, unknown, string][] = [
    ['no schemaVersion', {}, 'schemaVersion'],
    ['non-integer schemaVersion', { schemaVersion: '2' }, 'schemaVersion'],
    ['negative trunk radius', { schemaVersion: 2, trunk: { radius: -1 } }, 'trunk.radius'],
    ['too few trunk sides', { schemaVersion: 2, trunk: { sides: 2 } }, 'trunk.sides'],
    ['unknown field (typo)', { schemaVersion: 2, trunk: { lenght: 3 } }, 'trunk.lenght'],
    ['unknown section', { schemaVersion: 2, roots: {} }, 'roots'],
    ['section not an object', { schemaVersion: 2, leaves: 3 }, 'leaves'],
    ['unknown form', { schemaVersion: 2, form: 'palm' }, 'form'],
    ['branch angle out of range', { schemaVersion: 2, branches: [{}, { angle: 200 }] }, 'branches[1].angle'],
    ['branch end before start', { schemaVersion: 2, branches: [{ start: 0.8, end: 0.2 }] }, 'branches[0].end'],
    ['too many branch levels', { schemaVersion: 2, branches: [{}, {}, {}, {}, {}] }, 'branches'],
    ['leaf shape', { schemaVersion: 2, leaves: { shape: 'square' } }, 'leaves.shape'],
    ['bark colour', { schemaVersion: 2, materials: { bark: { color: 'brown' } } }, 'materials.bark.color'],
    ['texture url', { schemaVersion: 2, materials: { leaf: { map: 3 } } }, 'materials.leaf.map'],
    ['shading', { schemaVersion: 2, materials: { shading: 'pbr' } }, 'materials.shading'],
    ['empty keyframe track', { schemaVersion: 2, season: { blossom: [] } }, 'season.blossom'],
    ['keyframe value', { schemaVersion: 2, season: { leafCoverage: [{ t: 0, value: 2 }] } }, 'season.leafCoverage[0].value'],
    ['keyframe missing t', { schemaVersion: 2, season: { leafColor: [{ value: '#ffffff' }] } }, 'season.leafColor[0].t'],
    [
      'unsorted keyframes',
      { schemaVersion: 2, season: { blossom: [{ t: 0.5, value: 1 }, { t: 0.2, value: 0 }] } },
      'season.blossom[1].t',
    ],
    ['wind frequency', { schemaVersion: 2, wind: { frequency: 0 } }, 'wind.frequency'],
    ['variation range', { schemaVersion: 2, variation: { season: 1.5 } }, 'variation.season'],
    ['sculpt action', { schemaVersion: 2, sculpts: [{ seed: 1, path: '0', action: 'paint' }] }, 'sculpts[0].action'],
    ['sculpt path', { schemaVersion: 2, sculpts: [{ seed: 1, path: '1.2', action: 'delete' }] }, 'sculpts[0].path'],
    ['sculpt missing seed', { schemaVersion: 2, sculpts: [{ path: '0', action: 'delete' }] }, 'sculpts[0].seed'],
    [
      'move sculpt rotation',
      { schemaVersion: 2, sculpts: [{ seed: 1, path: '0.1', action: 'move', rotation: [0, 1], scale: 1 }] },
      'sculpts[0].rotation',
    ],
    [
      'move sculpt scale',
      { schemaVersion: 2, sculpts: [{ seed: 1, path: '0.1', action: 'move', rotation: [0, 1, 0], scale: 0 }] },
      'sculpts[0].scale',
    ],
    ['leaves sculpt coverage', { schemaVersion: 2, sculpts: [{ seed: 1, path: '0', action: 'leaves', coverage: 1.5 }] }, 'sculpts[0].coverage'],
    ['sculpt seed', { schemaVersion: 2, sculpts: [{ seed: Infinity, path: '0', action: 'delete' }] }, 'sculpts[0].seed'],
    ['sculpt field of another action', { schemaVersion: 2, sculpts: [{ seed: 1, path: '0', action: 'delete', scale: 2 }] }, 'sculpts[0].scale'],
    ['bad field after migration', { schemaVersion: 1, bark: { color: 'red' } }, 'materials.bark.color'],
  ];
  it.each(cases)('%s', (_name, input, field) => {
    expect(fieldOf(() => parseDefinition(input))).toBe(field);
  });

  it('puts the field path and the received value in the message', () => {
    expect(() => parseDefinition({ schemaVersion: 2, trunk: { radius: -1 } })).toThrow(
      'Invalid Tree Definition: trunk.radius must be a number > 0, got -1',
    );
  });

  it('rejects non-objects', () => {
    expect(() => parseDefinition(null)).toThrow(TreeDefinitionError);
    expect(() => parseDefinition([])).toThrow(TreeDefinitionError);
  });
});

describe('loading Definitions from JSON', () => {
  const json = JSON.stringify({ schemaVersion: 2, name: 'oak', trunk: { length: 6 } });

  it('createTree accepts a Definition from parsed JSON', () => {
    const tree = createTree(JSON.parse(json) as unknown as TreeDefinitionInput, { seed: 1 });
    expect(tree.definition.name).toBe('oak');
    expect(tree.definition.trunk.length).toBe(6);
  });

  it('parseDefinition accepts a JSON string and reports bad JSON', () => {
    expect(parseDefinition(json).trunk.length).toBe(6);
    expect(fieldOf(() => parseDefinition('{ nope'))).toBe('(root)');
  });

  it('fetchDefinition loads, migrates and validates a JSON file by URL', async () => {
    const v1 = readFileSync(new URL('./fixtures/definition-v1.json', import.meta.url), 'utf8');
    const def = await fetchDefinition(`data:application/json,${encodeURIComponent(v1)}`);
    expect(def.schemaVersion).toBe(2);
    expect(def.materials.bark.color).toBe('#55402a');
    await expect(fetchDefinition('data:application/json,{"schemaVersion":2,"form":"x"}')).rejects.toThrow(/form/);
  });
});

describe('extendDefinition', () => {
  it('changes a few parameters of a base Definition and keeps the rest', () => {
    const base = parseDefinition({ schemaVersion: 2, form: 'conifer', trunk: { length: 9 } });
    const def = extendDefinition(base, { trunk: { radius: 0.5 }, materials: { bark: { color: '#112233' } } });
    expect(def.form).toBe('conifer');
    expect(def.trunk).toMatchObject({ length: 9, radius: 0.5 });
    expect(def.materials.bark).toMatchObject({ color: '#112233', roughness: 0.9 });
    expect(base.trunk.radius).toBe(0.25);
  });

  it('validates the result', () => {
    expect(fieldOf(() => extendDefinition(DEFAULT_DEFINITION, { leaves: { count: -1 } }))).toBe('leaves.count');
  });
});
