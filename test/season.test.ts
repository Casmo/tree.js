import { describe, expect, it } from 'vitest';
import {
  createTree,
  evaluateSeason,
  generateTree,
  leafSeason,
  parseDefinition,
  partSeasonAt,
  sampleTrack,
  SEASON_PROFILES,
  srgbToLinear,
  wrapSeason,
  type SeasonProfileDefinition,
} from '../src/index';

const profile: SeasonProfileDefinition = {
  leafColor: [
    { t: 0, value: '#ff0000' },
    { t: 0.5, value: '#0000ff' },
  ],
  leafCoverage: [
    { t: 0.2, value: 1 },
    { t: 0.6, value: 0 },
  ],
  blossom: [{ t: 0, value: 0 }],
  blossomColor: '#ffffff',
};

describe('sampleTrack', () => {
  const track = [
    { t: 0.2, value: 1 },
    { t: 0.6, value: 0 },
  ];
  it('holds the first value before the first key and the last value after the last key', () => {
    expect(sampleTrack(track, 0)).toBe(1);
    expect(sampleTrack(track, 1)).toBe(0);
  });
  it('interpolates linearly between keys', () => {
    expect(sampleTrack(track, 0.4)).toBeCloseTo(0.5, 6);
    expect(sampleTrack(track, 0.5)).toBeCloseTo(0.25, 6);
  });
  it('steps at two keys with the same t', () => {
    const step = [
      { t: 0, value: 0 },
      { t: 0.5, value: 0 },
      { t: 0.5, value: 1 },
    ];
    expect(sampleTrack(step, 0.49)).toBe(0);
    expect(sampleTrack(step, 0.51)).toBe(1);
  });
  it('returns the only value of a one-key track', () => {
    expect(sampleTrack([{ t: 0.3, value: 0.7 }], 0.9)).toBe(0.7);
  });
});

describe('wrapSeason', () => {
  it('keeps 0..1 as is (1 is the last day of winter) and wraps anything outside', () => {
    expect(wrapSeason(0)).toBe(0);
    expect(wrapSeason(1)).toBe(1);
    expect(wrapSeason(0.25)).toBe(0.25);
    expect(wrapSeason(1.25)).toBeCloseTo(0.25, 9);
    expect(wrapSeason(-0.25)).toBeCloseTo(0.75, 9);
  });
});

describe('evaluateSeason', () => {
  it('gives leaf colour (linear RGB), coverage and blossom at a Season', () => {
    const s = evaluateSeason(profile, 0.25);
    // halfway between red and blue in linear space
    expect(s.leafColor[0]).toBeCloseTo(0.5, 5);
    expect(s.leafColor[1]).toBeCloseTo(0, 5);
    expect(s.leafColor[2]).toBeCloseTo(0.5, 5);
    expect(s.leafCoverage).toBeCloseTo(0.875, 6);
    expect(s.blossom).toBe(0);
    expect(s.blossomColor).toEqual([1, 1, 1]);
  });
  it('applies a Seed timing shift, wrapping around the year', () => {
    expect(evaluateSeason(profile, 0.2, 0.2).leafCoverage).toBeCloseTo(0.5, 6);
    expect(evaluateSeason(profile, 0.9, 0.2).leafCoverage).toBe(1); // 1.1 wraps to 0.1
  });
});

describe('srgbToLinear', () => {
  it('converts sRGB channels with the standard transfer curve', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
  });
});

describe('per-leaf Season attributes (aSeason)', () => {
  const def = parseDefinition({ schemaVersion: 2, variation: { season: 0.1 } });
  const data = generateTree(def, 7);
  const aSeason = data.leaves.attributes.aSeason!;

  it('is a vec3 on every vertex of both meshes', () => {
    expect(aSeason.itemSize).toBe(3);
    expect(aSeason.array.length).toBe(data.leaves.positions.length);
    expect(data.wood.attributes.aSeason!.array.length).toBe(data.wood.positions.length);
  });

  it('holds a timing shift within the Definition range and two 0..1 ranks per leaf', () => {
    const shifts: number[] = [];
    for (let v = 0; v < aSeason.array.length / 3; v++) {
      const { shift, coverageRank, blossomRank } = partSeasonAt(aSeason.array, v);
      expect(Math.abs(shift)).toBeLessThanOrEqual(0.1 + 1e-6);
      expect(coverageRank).toBeGreaterThanOrEqual(0);
      expect(coverageRank).toBeLessThan(1);
      expect(blossomRank).toBeGreaterThanOrEqual(0);
      expect(blossomRank).toBeLessThan(1);
      shifts.push(shift);
    }
    expect(new Set(shifts).size).toBeGreaterThan(1); // leaves do not all turn on the same day
  });

  it('has no timing shift when the Definition allows none', () => {
    const still = generateTree(parseDefinition({ schemaVersion: 2, variation: { season: 0 } }), 7);
    expect(Array.from(still.leaves.attributes.aSeason!.array).filter((_, i) => i % 3 === 0).every((x) => x === 0)).toBe(true);
  });

  it('reads as named fields: x = shift, y = coverage rank, z = blossom rank', () => {
    expect(partSeasonAt([9, 9, 9, 0.1, 0.2, 0.3], 1)).toEqual({ shift: 0.1, coverageRank: 0.2, blossomRank: 0.3 });
  });

  it('is the same for every vertex of one leaf', () => {
    for (let c = 1; c < 4; c++) {
      expect(Array.from(aSeason.array.subarray(c * 3, c * 3 + 3))).toEqual(Array.from(aSeason.array.subarray(0, 3)));
    }
  });

  it('shifts Season by Seed: two Seeds turn at different times', () => {
    const mean = (seed: number) => {
      const a = generateTree(def, seed).leaves.attributes.aSeason!.array;
      let sum = 0;
      for (let i = 0; i < a.length; i += 3) sum += a[i]!;
      return sum / (a.length / 3);
    };
    expect(mean(1)).not.toBeCloseTo(mean(2), 3);
  });
});

describe('leafSeason', () => {
  const ranks = (shift: number, coverageRank: number, blossomRank: number) => ({ shift, coverageRank, blossomRank });

  it('shows a leaf while the coverage is above its rank', () => {
    expect(leafSeason(profile, 0, ranks(0, 0.99, 0.5)).visible).toBe(true); // coverage 1
    expect(leafSeason(profile, 0.9, ranks(0, 0.01, 0.5)).visible).toBe(false); // coverage 0
    expect(leafSeason(profile, 0.4, ranks(0, 0.4, 0.5)).visible).toBe(true); // coverage 0.5
    expect(leafSeason(profile, 0.4, ranks(0, 0.6, 0.5)).visible).toBe(false);
  });

  it('turns a leaf into a blossom (shown, blossom colour) while blossom is above its blossom rank', () => {
    const blooming = { ...profile, blossom: [{ t: 0, value: 0.5 }], blossomColor: '#ffffff' };
    const bare = 0.9;
    expect(leafSeason(blooming, bare, ranks(0, 0.5, 0.2))).toMatchObject({ visible: true, blossom: true, color: [1, 1, 1] });
    expect(leafSeason(blooming, bare, ranks(0, 0.5, 0.8))).toMatchObject({ visible: false, blossom: false });
  });

  it('applies the leaf timing shift', () => {
    expect(leafSeason(profile, 0.4, ranks(0.2, 0.3, 0.5)).visible).toBe(false); // coverage at 0.6 is 0
  });
});

describe('Tree.season', () => {
  it('starts at 0 (first day of spring)', () => {
    expect(createTree({ schemaVersion: 2 }).season).toBe(0);
  });

  it('only updates a uniform: no new geometry, no new material, no recompile', () => {
    const tree = createTree({ schemaVersion: 2 }, { seed: 3 });
    const { geometry, material } = tree.leaves;
    const { version } = material;
    const positions = geometry.getAttribute('position');
    tree.season = 0.6;
    expect(tree.season).toBe(0.6);
    expect(tree.seasonUniform.value).toBe(0.6);
    expect(tree.leaves.geometry).toBe(geometry);
    expect(geometry.getAttribute('position')).toBe(positions);
    expect(tree.leaves.material).toBe(material);
    expect(material.version).toBe(version);
  });

  it('wraps values outside 0..1 around the year', () => {
    const tree = createTree({ schemaVersion: 2 });
    tree.season = 1.25;
    expect(tree.season).toBeCloseTo(0.25, 9);
  });

  it('rejects a non-finite Season', () => {
    const tree = createTree({ schemaVersion: 2 });
    expect(() => (tree.season = Number.NaN)).toThrow(RangeError);
  });

  it('can be set at creation', () => {
    expect(createTree({ schemaVersion: 2 }, { season: 0.7 }).seasonUniform.value).toBe(0.7);
  });

  it('drives the leaf colour and leaf coverage through the leaf material nodes', () => {
    const tree = createTree({ schemaVersion: 2 });
    expect(tree.leaves.material.colorNode).not.toBeNull();
    expect(tree.leaves.material.maskNode).not.toBeNull(); // coverage cut also applies to shadows
  });
});

describe('SEASON_PROFILES', () => {
  const SPRING = 0.12, SUMMER = 0.37, AUTUMN = 0.62, WINTER = 0.87;
  const greenish = ([r, g, b]: number[]) => g! > r! && g! > b!;
  const autumnal = ([r, g, b]: number[]) => r! > g! && r! > b!;

  it('validates as Definition Season Profiles', () => {
    for (const season of Object.values(SEASON_PROFILES)) {
      expect(parseDefinition({ schemaVersion: 2, season }).season).toEqual(season);
    }
  });

  it('deciduous: green and full in spring and summer, autumn colours in autumn, bare in winter', () => {
    const p = SEASON_PROFILES.deciduous;
    for (const s of [SPRING, SUMMER]) {
      expect(greenish(evaluateSeason(p, s).leafColor)).toBe(true);
      expect(evaluateSeason(p, s).leafCoverage).toBeGreaterThan(0.95);
    }
    expect(autumnal(evaluateSeason(p, AUTUMN).leafColor)).toBe(true);
    expect(evaluateSeason(p, AUTUMN).leafCoverage).toBeGreaterThan(0.6);
    expect(evaluateSeason(p, WINTER).leafCoverage).toBe(0);
  });

  it('evergreen: always full and green, a little darker in winter', () => {
    const p = SEASON_PROFILES.evergreen;
    for (const s of [0, SPRING, SUMMER, AUTUMN, WINTER, 1]) {
      expect(evaluateSeason(p, s).leafCoverage).toBe(1);
      expect(greenish(evaluateSeason(p, s).leafColor)).toBe(true);
    }
    const luma = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    const summer = luma(evaluateSeason(p, SUMMER).leafColor);
    const winter = luma(evaluateSeason(p, WINTER).leafColor);
    expect(winter).toBeLessThan(summer);
    expect(winter).toBeGreaterThan(summer * 0.5);
  });
});
