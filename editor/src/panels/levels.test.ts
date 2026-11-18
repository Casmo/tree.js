import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_LEVEL, MAX_BRANCH_LEVELS } from '@casmo/tree.js';
import { addBranchLevel, removeBranchLevel } from './levels';

const level = (count: number) => ({ ...DEFAULT_BRANCH_LEVEL, count });

describe('branching levels', () => {
  it('adds a level below the deepest one, shaped like it', () => {
    expect(addBranchLevel([level(5), level(3)])).toEqual([level(5), level(3), level(3)]);
  });

  it('adds the default level to a bare trunk', () => {
    expect(addBranchLevel([])).toEqual([DEFAULT_BRANCH_LEVEL]);
  });

  it(`stops at ${MAX_BRANCH_LEVELS} levels`, () => {
    const full = Array.from({ length: MAX_BRANCH_LEVELS }, (_, i) => level(i));
    expect(() => addBranchLevel(full)).toThrow(/at most 4/);
  });

  it('removes a level; deeper levels move up', () => {
    expect(removeBranchLevel([level(5), level(3), level(2)], 1)).toEqual([level(5), level(2)]);
  });
});
