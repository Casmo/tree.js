import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_LEVEL, DEFAULT_DEFINITION, extendDefinition } from '@casmo/tree.js';
import { getAt, setAt } from './definition-path';

const base = extendDefinition(DEFAULT_DEFINITION, {
  branches: [
    { ...DEFAULT_BRANCH_LEVEL, count: 5, angle: 30 },
    { ...DEFAULT_BRANCH_LEVEL, count: 3, angle: 60 },
  ],
});

describe('Definition paths', () => {
  it('reads a parameter by dotted path', () => {
    expect(getAt(base, 'trunk.length')).toBe(DEFAULT_DEFINITION.trunk.length);
    expect(getAt(base, 'branches.1.angle')).toBe(60);
    expect(getAt(base, 'nope.x')).toBeUndefined();
  });

  it('changes one parameter and nothing else', () => {
    const next = setAt(base, 'trunk.length', 9);
    expect(next.trunk).toEqual({ ...base.trunk, length: 9 });
    expect({ ...next, trunk: base.trunk }).toEqual(base);
  });

  it('changes one field of one branch level, keeping the other levels and fields', () => {
    const next = setAt(base, 'branches.1.count', 8);
    expect(next.branches).toEqual([base.branches[0], { ...base.branches[1], count: 8 }]);
  });

  it('validates the result', () => {
    expect(() => setAt(base, 'trunk.length', -2)).toThrow(/trunk\.length/);
  });
});
