import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, type DefinitionPatch } from '../definition';
import { generateTree, type SkeletonBranch, type TreeData } from './index';

// Level 1 grows Tip Branches by default, level 2 too; a third level does not.
const base = parseDefinition({ schemaVersion: 3, branches: [{ count: 4 }, { count: 2 }], leaves: { count: 3 } });
const grow = (patch: DefinitionPatch = {}, seed = 5) => generateTree(extendDefinition(base, patch), seed);
const byPath = (data: TreeData) => new Map(data.skeleton.branches.map((b) => [b.path, b]));
const last = (b: SkeletonBranch) => b.points[b.points.length - 1]!;
const levels = (...tipBranches: number[]) => base.branches.map((level, i) => ({ ...level, tipBranches: tipBranches[i] ?? 0 }));

describe('Tip Branches', () => {
  it('grow from the very tip of each parent: first point the parent\'s last point, as thick as the parent\'s tip', () => {
    const branches = byPath(grow());
    // The trunk's Tip Branch comes after its 4 side branches, a level-1 branch's after its 2.
    for (const [parentPath, tipPath] of [['0', '0.4'], ['0.0', '0.0.2'], ['0.4', '0.4.2']] as const) {
      const parent = branches.get(parentPath)!;
      const tip = branches.get(tipPath)!;
      expect(tip.parent).toBe(parentPath);
      expect(tip.attach).toBe(1);
      expect(tip.points[0]!.position).toEqual(last(parent).position);
      expect(tip.points[0]!.radius).toBe(last(parent).radius);
    }
    // Level 2 is the outermost: its branches have no Tip Branch.
    expect(branches.has('0.0.0.0')).toBe(false);
  });
});
