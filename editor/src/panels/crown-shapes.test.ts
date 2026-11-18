import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_LEVEL, DEFAULT_DEFINITION, parseDefinition, type BranchLevelDefinition, type Keyframe } from '@casmo/tree.js';
import { applyCrownShape, CROWN_SHAPES, type CrownShape } from './crown-shapes';

/** Linear, clamped (how the generator reads a curve); absent = 1. */
function sample(curve: Keyframe<number>[] | undefined, t: number): number {
  if (!curve) return 1;
  if (t <= curve[0]!.t) return curve[0]!.value;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (t <= b.t) return b.t === a.t ? b.value : a.value + ((b.value - a.value) * (t - a.t)) / (b.t - a.t);
  }
  return curve.at(-1)!.value;
}

const level: BranchLevelDefinition = { ...DEFAULT_BRANCH_LEVEL, start: 0.2, end: 0.95 };
const shaped = (shape: CrownShape, branches: BranchLevelDefinition[] = [level, DEFAULT_BRANCH_LEVEL], index = 0) =>
  applyCrownShape(branches, index, shape)[index]!;
/** Length and angle multipliers at the base, middle and top of where the level's branches attach. */
function profile(shape: CrownShape) {
  const curves = shaped(shape);
  const at = (f: number) => level.start + f * (level.end - level.start);
  return {
    length: [0, 0.5, 1].map((f) => sample(curves.lengthProfile, at(f))),
    angle: [0, 0.5, 1].map((f) => sample(curves.angleProfile, at(f))),
  };
}

describe('Crown Shape presets', () => {
  it('offer cone, ball, column, vase and flat top', () => {
    expect(CROWN_SHAPES.map((shape) => shape.id)).toEqual(['cone', 'ball', 'column', 'vase', 'flat-top']);
    expect(CROWN_SHAPES.map((shape) => shape.label)).toEqual(['Cone', 'Ball', 'Column', 'Vase', 'Flat top']);
  });

  it('cone is the built-in conifer curve (branches shrink to a tip), with flat angles', () => {
    const cone = shaped('cone', [{ ...DEFAULT_BRANCH_LEVEL, start: 0.18 }]);
    // The low-poly conifer Style Definition's literal cone.
    const builtIn = [{ t: 0.18, value: 1 }, { t: 0.918, value: 0.1 }, { t: 1, value: 0.1 }];
    expect(cone.lengthProfile).toHaveLength(builtIn.length);
    cone.lengthProfile!.forEach((key, i) => {
      expect(key.t).toBeCloseTo(builtIn[i]!.t, 9);
      expect(key.value).toBeCloseTo(builtIn[i]!.value, 9);
    });
    expect(cone).not.toHaveProperty('angleProfile');
  });

  it('ball: longest branches halfway up, shorter at the base and the top', () => {
    const { length } = profile('ball');
    expect(length[1]).toBe(1);
    expect(length[0]).toBeLessThan(0.8);
    expect(length[2]).toBeLessThan(0.8);
  });

  it('column: short branches all the way up, held close to the trunk', () => {
    const { length, angle } = profile('column');
    expect(new Set(length).size).toBe(1);
    expect(length[0]).toBeLessThan(0.6);
    expect(Math.max(...angle)).toBeLessThan(0.8);
  });

  it('vase: branches longer towards the top and held upright', () => {
    const { length, angle } = profile('vase');
    expect(length[0]).toBeLessThan(length[1]!);
    expect(length[1]).toBeLessThan(length[2]!);
    expect(Math.max(...angle)).toBeLessThan(1);
  });

  it('flat top: long upper branches spread out wider than the lower ones', () => {
    const { length, angle } = profile('flat-top');
    expect(length[0]).toBeLessThan(length[2]!);
    expect(angle[2]).toBeGreaterThan(1);
    expect(angle[2]).toBeGreaterThan(angle[0]!);
  });

  it('write both curves of one level only, replacing what was there, as a valid Definition', () => {
    const branches = [level, { ...DEFAULT_BRANCH_LEVEL, lengthProfile: [{ t: 0, value: 0.5 }] }];
    for (const { id } of CROWN_SHAPES) {
      const vase = applyCrownShape(branches, 0, 'vase');
      const next = applyCrownShape(vase, 0, id);
      expect(next[1]).toEqual(branches[1]);
      expect(next[0]).toMatchObject({ count: level.count, start: level.start, end: level.end });
      expect(next[0]!.lengthProfile).toBeDefined();
      expect(next[0]).toEqual(shaped(id));
      expect(() => parseDefinition({ ...DEFAULT_DEFINITION, branches: next })).not.toThrow();
    }
    expect(branches[0]).toEqual(level); // never mutated
  });
});
