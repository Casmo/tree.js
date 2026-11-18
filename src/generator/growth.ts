import { pow } from '../math';
import type { TreeDefinition } from '../definition';
import { seedRandom } from '../random';
import type { GrowthTiming, GrowthWindow, SkeletonBranch, SkeletonLeaf } from './types';

// Raw timeline units (normalised to 0..1 afterwards, so only their ratios matter).
/** Delay of a branch after its parent is grown, per unit of `attach` (lower branches sprout first). */
const BRANCH_STAGGER = 0.6;
/** Time a branch takes from sprouting to full size. */
const BRANCH_DURATION = 1;
/** Leaves wait this long after their branch is grown ... */
const LEAF_DELAY = 0.3;
/** ... plus this much per unit of `attach` (leaves near the base first) ... */
const LEAF_STAGGER = 0.5;
/** ... and take this long to unfold. */
const LEAF_DURATION = 0.6;

/**
 * When each part grows, as Growth windows (0..1) parallel to the skeleton arrays.
 *
 * Order: the trunk is there from Growth 0 (it only scales with the whole tree); a branch sprouts
 * once its parent is fully grown, lower branches first; leaves come after their branch. So a part
 * always sprouts from a fully-grown parent and never floats. The last part finishes at Growth 1.
 *
 * Seed (within `variation.growth` = v): each part's start is delayed by up to v/2 of its own window
 * (its end stays put, so the order above holds), and the whole timeline is warped by `t^k`,
 * k in 1 ± v (a monotone map that keeps 0 and 1). Together a window moves by less than v.
 */
export function growthTiming(
  definition: TreeDefinition,
  seed: number,
  branches: SkeletonBranch[],
  leaves: SkeletonLeaf[],
): Omit<GrowthTiming, 'fruit'> {
  const raw = new Map<string, GrowthWindow>();
  const branchWindows = branches.map((branch) => {
    let window: GrowthWindow = { start: 0, end: 0 };
    if (branch.parent !== null) {
      const start = raw.get(branch.parent)!.end + branch.attach * BRANCH_STAGGER;
      window = { start, end: start + BRANCH_DURATION };
    }
    raw.set(branch.path, window); // breadth first: parents come before children
    return window;
  });
  const leafWindows = leaves.map((leaf) => {
    const start = raw.get(leaf.branch)!.end + LEAF_DELAY + leaf.attach * LEAF_STAGGER;
    return { start, end: start + LEAF_DURATION };
  });

  const total = Math.max(0, ...branchWindows.map((w) => w.end), ...leafWindows.map((w) => w.end));
  const v = definition.variation.growth;
  const k = 1 + (2 * seedRandom(seed, 'growth') - 1) * v;
  const warp = (t: number) => (total > 0 ? pow(Math.min(1, t / total), k) : 0);
  const finish = (w: GrowthWindow, key: string): GrowthWindow => {
    const delay = seedRandom(seed, `growth/${key}`) * (v / 2) * (w.end - w.start);
    return { start: warp(w.start + delay), end: warp(w.end) };
  };
  return {
    branches: branchWindows.map((w, i) => finish(w, branches[i]!.path)),
    leaves: leafWindows.map((w, i) => finish(w, leaves[i]!.id)),
  };
}
