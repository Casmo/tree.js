import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateTree } from '../src/generator';
import {
  coneCurve,
  CURRENT_SCHEMA_VERSION,
  loadStyle,
  STYLE_NAMES,
  hashTreeData,
  createTree,
  DEFAULT_BRANCH_LEVEL,
  DEFAULT_DEFINITION,
  DEFAULT_LEAF_GROWTH_START,
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
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(def.schemaVersion).toBe(3);
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
    expect(createTree(fixture('definition-v1.json') as TreeDefinitionInput, { seed: 3 }).definition.schemaVersion).toBe(3);
  });

  it('migrates a schemaVersion 2 broadleaf: `form` is dropped, nothing else changes', () => {
    const v2 = fixture('definition-v2-broadleaf.json') as Record<string, unknown>;
    const def = parseDefinition(v2);
    expect(def.schemaVersion).toBe(3);
    expect(def).not.toHaveProperty('form');
    expect(def.name).toBe('My oak');
    expect(def.branches.every((b) => b.lengthProfile === undefined && b.angleProfile === undefined)).toBe(true);
  });

  it('migrates a schemaVersion 2 conifer: its cone becomes a length curve on the first branch level', () => {
    const def = parseDefinition(fixture('definition-v2-conifer.json'));
    expect(def).not.toHaveProperty('form');
    // start 0.27: full length at the lowest branches, shrinking to a tenth near the tip.
    expect(def.branches[0]!.lengthProfile).toEqual([
      { t: 0.27, value: 1 },
      { t: expect.closeTo(0.927, 10) as number, value: 0.1 },
      { t: 1, value: 0.1 },
    ]);
    expect(def.branches[0]!.angleProfile).toBeUndefined();
    expect(def.branches[1]!.lengthProfile).toBeUndefined();
    expect(def.sculpts).toEqual([{ seed: 7, path: '0.4', action: 'delete' }]);
  });

  it('coneCurve is the Crown Shape the migration writes, and the curve of every Style\'s own conifer', async () => {
    expect(coneCurve(0.18)).toEqual([{ t: 0.18, value: 1 }, { t: 0.918, value: 0.1 }, { t: 1, value: 0.1 }]);
    const conifer = parseDefinition(fixture('definition-v2-conifer.json'));
    expect(conifer.branches[0]!.lengthProfile).toEqual(coneCurve(0.27));
    for (const name of STYLE_NAMES) {
      const level = (await loadStyle(name)).conifer.branches[0]!;
      expect(level.lengthProfile, name).toEqual(coneCurve(level.start));
    }
  });

  it('a migrated v2 conifer without branches stays a valid, branchless tree', () => {
    const def = parseDefinition({ schemaVersion: 2, form: 'conifer', branches: [] });
    expect(def.branches).toEqual([]);
  });

  it('a migrated v2 conifer with default branch levels gets the cone from the default start', () => {
    const def = parseDefinition({ schemaVersion: 2, form: 'conifer' });
    expect(def.branches[0]!.lengthProfile![0]).toEqual({ t: DEFAULT_BRANCH_LEVEL.start, value: 1 });
  });

  // Golden hashes recorded with the v2 generator (special-cased `form: 'conifer'`) before the migration existed;
  // re-recorded once when the trunk's base ring sank below the ground (ADR 0007: only that ring changed), and once
  // when leaves rode on their twig from Leaf Start (ADR 0019: only the leaves' Growth attributes changed).
  const before = {
    broadleaf: { 1: '528a77fb', 7: 'f654c2bb', 42: '33e534b7' },
    conifer: { 1: '2c27f8d2', 7: '9947b4f3', 42: 'f7031b28' },
  } as const;
  for (const [form, hashes] of Object.entries(before)) {
    it(`a migrated v2 ${form} grows exactly the same tree as before (geometry hash)`, () => {
      const def = parseDefinition(fixture(`definition-v2-${form}.json`));
      for (const [seed, hash] of Object.entries(hashes)) {
        expect(hashTreeData(generateTree(def, Number(seed)))).toBe(hash);
      }
    });
  }

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

  it('keeps a branch level\'s optional Twist fields: absent stays absent (no Twist), given values are kept', () => {
    const def = parseDefinition({ schemaVersion: 3, branches: [{}, { twist: 0.4, twists: 5 }] });
    expect('twist' in def.branches[0]!).toBe(false);
    expect('twists' in def.branches[0]!).toBe(false);
    expect([def.branches[1]!.twist, def.branches[1]!.twists]).toEqual([0.4, 5]);
  });

  it('keeps a branch level\'s optional Twist Style and Spin: absent stays absent (Snake, Random), given values are kept', () => {
    const def = parseDefinition({ schemaVersion: 3, branches: [{}, { twistStyle: 'corkscrew', spin: 'counterclockwise' }, { twistStyle: 'snake', spin: 'random' }] });
    expect('twistStyle' in def.branches[0]!).toBe(false);
    expect('spin' in def.branches[0]!).toBe(false);
    expect([def.branches[1]!.twistStyle, def.branches[1]!.spin]).toEqual(['corkscrew', 'counterclockwise']);
    expect([def.branches[2]!.twistStyle, def.branches[2]!.spin]).toEqual(['snake', 'random']);
    expect(parseDefinition({ schemaVersion: 3, branches: [{ spin: 'clockwise' }] }).branches[0]!.spin).toBe('clockwise');
  });

  it('keeps a branch level\'s optional Twist Curve: absent stays absent (0), given values are kept', () => {
    const def = parseDefinition({ schemaVersion: 3, branches: [{}, { twistCurve: 0.6 }, { twistStyle: 'corkscrew', twistCurve: 1 }] });
    expect('twistCurve' in def.branches[0]!).toBe(false);
    expect([def.branches[1]!.twistCurve, def.branches[2]!.twistCurve]).toEqual([0.6, 1]);
  });

  it('keeps the trunk\'s optional Twist Style, Spin and Twist Curve: absent stays absent (Snake, Random, 0), given values are kept', () => {
    const plain = parseDefinition({ schemaVersion: 3 });
    for (const key of ['twistStyle', 'spin', 'twistCurve']) expect(key in plain.trunk, key).toBe(false);
    const def = parseDefinition({ schemaVersion: 3, trunk: { twistStyle: 'corkscrew', spin: 'counterclockwise', twistCurve: 0.6 } });
    expect([def.trunk.twistStyle, def.trunk.spin, def.trunk.twistCurve]).toEqual(['corkscrew', 'counterclockwise', 0.6]);
  });

  it('keeps a branch level\'s optional Follow Twist: absent stays absent (off), given values are kept', () => {
    const def = parseDefinition({ schemaVersion: 3, branches: [{}, { followTwist: true }, { twistStyle: 'corkscrew', followTwist: false }] });
    expect('followTwist' in def.branches[0]!).toBe(false);
    expect([def.branches[1]!.followTwist, def.branches[2]!.followTwist]).toEqual([true, false]);
  });

  it('keeps the optional Leaf Start (leaves.growthStart): absent stays absent and means 0.1, given values 0..1 are kept', () => {
    const plain = parseDefinition({ schemaVersion: 3 });
    expect('growthStart' in plain.leaves).toBe(false);
    expect(plain.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(DEFAULT_LEAF_GROWTH_START).toBe(0.1);
    for (const growthStart of [0, 0.35, 1]) {
      expect(parseDefinition({ schemaVersion: 3, leaves: { growthStart } }).leaves.growthStart).toBe(growthStart);
    }
  });

  it('keeps Leaf Start through a Definition JSON round-trip', () => {
    const def = parseDefinition({ schemaVersion: 3, leaves: { growthStart: 0.4 } });
    const back = parseDefinition(JSON.stringify(def));
    expect(back.leaves.growthStart).toBe(0.4);
    expect(back).toEqual(def);
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

  it('keeps the trunk\'s optional Twist fields: absent stays absent (no Twist), given values are kept', () => {
    const plain = parseDefinition({ schemaVersion: 3 });
    expect('twist' in plain.trunk).toBe(false);
    expect('twists' in plain.trunk).toBe(false);
    const def = parseDefinition({ schemaVersion: 3, trunk: { twist: 0.6, twists: 4 } });
    expect([def.trunk.twist, def.trunk.twists]).toEqual([0.6, 4]);
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
    ['unknown section', { schemaVersion: 2, twigs: {} }, 'twigs'],
    ['section not an object', { schemaVersion: 2, leaves: 3 }, 'leaves'],
    ['unknown form (v2)', { schemaVersion: 2, form: 'palm' }, 'form'],
    ['form is no longer a v3 field', { schemaVersion: 3, form: 'conifer' }, 'form'],
    ['empty length curve', { schemaVersion: 3, branches: [{ lengthProfile: [] }] }, 'branches[0].lengthProfile'],
    [
      'length curve keyframe value',
      { schemaVersion: 3, branches: [{}, { lengthProfile: [{ t: 0, value: -1 }] }] },
      'branches[1].lengthProfile[0].value',
    ],
    [
      'unsorted angle curve',
      { schemaVersion: 3, branches: [{ angleProfile: [{ t: 0.8, value: 1 }, { t: 0.2, value: 2 }] }] },
      'branches[0].angleProfile[1].t',
    ],
    ['angle curve keyframe t', { schemaVersion: 3, branches: [{ angleProfile: [{ t: 1.5, value: 1 }] }] }, 'branches[0].angleProfile[0].t'],
    ['branch angle out of range', { schemaVersion: 2, branches: [{}, { angle: 200 }] }, 'branches[1].angle'],
    ['branch twist above 1', { schemaVersion: 3, branches: [{ twist: 1.2 }] }, 'branches[0].twist'],
    ['branch twist below 0', { schemaVersion: 3, branches: [{}, { twist: -0.1 }] }, 'branches[1].twist'],
    ['branch twists not an integer', { schemaVersion: 3, branches: [{ twists: 2.5 }] }, 'branches[0].twists'],
    ['branch twists below 1', { schemaVersion: 3, branches: [{ twists: 0 }] }, 'branches[0].twists'],
    ['branch twists above 8', { schemaVersion: 3, branches: [{ twists: 9 }] }, 'branches[0].twists'],
    ['unknown branch Twist Style', { schemaVersion: 3, branches: [{ twistStyle: 'helix' }] }, 'branches[0].twistStyle'],
    ['unknown branch Spin', { schemaVersion: 3, branches: [{}, { spin: 'left' }] }, 'branches[1].spin'],
    ['branch Twist Curve above 1', { schemaVersion: 3, branches: [{ twistCurve: 1.5 }] }, 'branches[0].twistCurve'],
    ['branch Twist Curve below 0', { schemaVersion: 3, branches: [{}, { twistCurve: -0.1 }] }, 'branches[1].twistCurve'],
    ['branch Follow Twist not a boolean', { schemaVersion: 3, branches: [{}, { followTwist: 'yes' }] }, 'branches[1].followTwist'],
    ['branch Follow Twist as a number', { schemaVersion: 3, branches: [{ followTwist: 1 }] }, 'branches[0].followTwist'],
    ['Follow Twist on the trunk', { schemaVersion: 3, trunk: { followTwist: true } }, 'trunk.followTwist'],
    ['trunk twist above 1', { schemaVersion: 3, trunk: { twist: 1.2 } }, 'trunk.twist'],
    ['trunk twist below 0', { schemaVersion: 3, trunk: { twist: -0.1 } }, 'trunk.twist'],
    ['trunk twists not an integer', { schemaVersion: 3, trunk: { twists: 2.5 } }, 'trunk.twists'],
    ['trunk twists below 1', { schemaVersion: 3, trunk: { twists: 0 } }, 'trunk.twists'],
    ['trunk twists above 8', { schemaVersion: 3, trunk: { twists: 9 } }, 'trunk.twists'],
    ['unknown trunk Twist Style', { schemaVersion: 3, trunk: { twistStyle: 'helix' } }, 'trunk.twistStyle'],
    ['unknown trunk Spin', { schemaVersion: 3, trunk: { spin: 'left' } }, 'trunk.spin'],
    ['trunk Twist Curve above 1', { schemaVersion: 3, trunk: { twistCurve: 1.5 } }, 'trunk.twistCurve'],
    ['trunk Twist Curve below 0', { schemaVersion: 3, trunk: { twistCurve: -0.1 } }, 'trunk.twistCurve'],
    ['branch end before start', { schemaVersion: 2, branches: [{ start: 0.8, end: 0.2 }] }, 'branches[0].end'],
    ['too many branch levels', { schemaVersion: 2, branches: [{}, {}, {}, {}, {}] }, 'branches'],
    ['leaf shape', { schemaVersion: 2, leaves: { shape: 'square' } }, 'leaves.shape'],
    ['Leaf Start above 1', { schemaVersion: 3, leaves: { growthStart: 1.2 } }, 'leaves.growthStart'],
    ['Leaf Start below 0', { schemaVersion: 3, leaves: { growthStart: -0.1 } }, 'leaves.growthStart'],
    ['Leaf Start not a number', { schemaVersion: 3, leaves: { growthStart: '0.2' } }, 'leaves.growthStart'],
    ['Leaf Start not finite', { schemaVersion: 3, leaves: { growthStart: NaN } }, 'leaves.growthStart'],
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
    ['sculpt path', { schemaVersion: 2, sculpts: [{ seed: 1, path: '0.x', action: 'delete' }] }, 'sculpts[0].path'],
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
    expect(def.schemaVersion).toBe(3);
    expect(def.materials.bark.color).toBe('#55402a');
    await expect(fetchDefinition('data:application/json,{"schemaVersion":2,"form":"x"}')).rejects.toThrow(/form/);
  });
});

describe('extendDefinition', () => {
  it('changes a few parameters of a base Definition and keeps the rest', () => {
    const base = parseDefinition({ schemaVersion: 2, form: 'conifer', trunk: { length: 9 } });
    const def = extendDefinition(base, { trunk: { radius: 0.5 }, materials: { bark: { color: '#112233' } } });
    expect(def.branches[0]!.lengthProfile).toEqual(base.branches[0]!.lengthProfile);
    expect(def.trunk).toMatchObject({ length: 9, radius: 0.5 });
    expect(def.materials.bark).toMatchObject({ color: '#112233', roughness: 0.9 });
    expect(base.trunk.radius).toBe(0.25);
  });

  it('validates the result', () => {
    expect(fieldOf(() => extendDefinition(DEFAULT_DEFINITION, { leaves: { count: -1 } }))).toBe('leaves.count');
  });
});
