import { pow } from '../math';
import { DEFAULT_LEAF_GROWTH_START, type TreeDefinition } from '../definition';
import { seedRandom } from '../random';
import type { GrowthTiming, GrowthWindow, LeafGrowth, SkeletonBranch, SkeletonLeaf } from './types';

// Raw timeline units (normalised to 0..1 afterwards, so only their ratios matter).
/** Delay of a branch after its parent is grown, per unit of `attach` (lower branches sprout first). */
const BRANCH_STAGGER = 0.6;
/** Time a branch takes from sprouting to full size. */
const BRANCH_DURATION = 1;
// The leaf windows of the old timing (a leaf waited for its twig). Leaves no longer use them (ADR 0020),
// but the timeline is still normalised over them, so the branch windows stay exactly as they were.
const LEAF_DELAY = 0.3;
const LEAF_STAGGER = 0.5;
const LEAF_DURATION = 0.6;

/**
 * When each part grows, as Growth windows (0..1) parallel to the skeleton arrays.
 *
 * Order: the trunk is there from Growth 0 (it only scales with the whole tree); a branch sprouts
 * once its parent is fully grown, lower branches first and a Tip Branch at once. So a branch always
 * sprouts from a fully-grown parent and never floats. Leaves don't wait for their twig: they unfold from
 * Leaf Start and ride on their twig while it sprouts (see {@link leafWindow}, ADR 0020).
 *
 * Seed (within `variation.growth` = v): each branch's start is delayed by up to v/2 of its own window
 * (its end stays put, so the order above holds), and the whole timeline is warped by `t^k`,
 * k in 1 ± v (a monotone map that keeps 0 and 1). Together a window moves by less than v.
 */
export function growthTiming(
  definition: TreeDefinition,
  seed: number,
  branches: SkeletonBranch[],
  leaves: SkeletonLeaf[],
): Omit<GrowthTiming, 'fruit' | 'roots'> {
  const raw = new Map<string, GrowthWindow>();
  const branchWindows = branches.map((branch) => {
    let window: GrowthWindow = { start: 0, end: 0 };
    if (branch.parent !== null) {
      // A Tip Branch carries its parent on: it sprouts as soon as the parent is grown, like a branch at its base.
      const start = raw.get(branch.parent)!.end + (branch.tip ? 0 : branch.attach) * BRANCH_STAGGER;
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
    leaves: leaves.map((leaf) => leafWindow(definition, seed, leaf)),
  };
}

/**
 * When one leaf unfolds (its own window; its size is also its twig's sprout progress, see `growPositions`):
 * from `s = Leaf Start + stagger` to Growth 1. The stagger is up to `variation.growth` of the remaining
 * range (1 - Leaf Start): half from the leaf's Seed, half from where it sits on its twig (`attach`, so
 * leaves near the twig base come a little earlier). Used by every Detail Level, so they all agree.
 */
export function leafWindow(definition: TreeDefinition, seed: number, leaf: Pick<SkeletonLeaf, 'id' | 'attach'>): GrowthWindow {
  const leafStart = definition.leaves.growthStart ?? DEFAULT_LEAF_GROWTH_START;
  const share = (seedRandom(seed, `growth/${leaf.id}`) + Math.min(Math.max(leaf.attach, 0), 1)) / 2;
  return { start: Math.min(leafStart + (1 - leafStart) * definition.variation.growth * share, 1), end: 1 };
}

/**
 * How each leaf grows, for its mesh: its own window (`leafWindows`, parallel to `leaves`) and the sprout
 * of the twig it rides on (the window in `branchWindows`, parallel to `branches`, and the twig's base point).
 */
export function leafGrowth(leaves: SkeletonLeaf[], leafWindows: GrowthWindow[], branches: SkeletonBranch[], branchWindows: GrowthWindow[]): LeafGrowth[] {
  const twigs = new Map(branches.map((branch, i) => [branch.path, { window: branchWindows[i]!, origin: branch.points[0]!.position }]));
  return leaves.map((leaf, l) => {
    const twig = twigs.get(leaf.branch)!;
    return { leaf: leafWindows[l]!, twig: twig.window, twigOrigin: twig.origin };
  });
}
