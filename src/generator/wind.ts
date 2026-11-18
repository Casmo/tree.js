import type { GeometryBuffers, SkeletonBranch } from './types';

/**
 * Wind weights (ticket #8). Every vertex carries `aWind` = (trunk sway, branch sway, leaf flutter),
 * each 0..1, which the Wind TSL node scales by the Definition's Wind response and the scene Wind.
 *
 * - trunk sway: (height / trunk height)², clamped: the trunk bends from the ground and carries
 *   everything above it.
 * - branch sway: 0 on the trunk; along a branch of level L it rises by 1/levels from the value its
 *   parent has at the attach point, so joints never tear and the outermost twigs reach up to 1.
 * - leaf flutter: 0 on wood; along a leaf from 0 at its base to 1 at its tip.
 */
export interface PartSway {
  /** Branch sway at the base of the part. */
  base: number;
  /** Branch sway gained from the base (along = 0) to the tip (along = 1). */
  gain: number;
  /** True for leaves: leaf flutter = along. */
  flutter: boolean;
}

export const NO_SWAY: PartSway = { base: 0, gain: 0, flutter: false };

/** Branch sway of every branch (by path). `branches` must be ordered parents first (the skeleton is). */
export function branchSway(branches: SkeletonBranch[], levels: number): Map<string, PartSway> {
  const gain = levels > 0 ? 1 / levels : 0;
  const out = new Map<string, PartSway>();
  for (const branch of branches) {
    if (branch.parent === null) {
      out.set(branch.path, NO_SWAY);
      continue;
    }
    const parent = out.get(branch.parent)!;
    out.set(branch.path, { base: parent.base + parent.gain * branch.attach, gain, flutter: false });
  }
  return out;
}

/** The sway of a leaf: its branch's sway at the attach point, plus flutter. */
export function leafSway(branch: PartSway, attach: number): PartSway {
  return { base: branch.base + branch.gain * attach, gain: 0, flutter: true };
}

/** Fills the trunk-sway channel (x of `aWind`) from each vertex's height. */
export function writeTrunkSway(buffers: GeometryBuffers, trunkHeight: number): void {
  const aWind = buffers.attributes.aWind.array;
  const count = buffers.positions.length / 3;
  for (let v = 0; v < count; v++) {
    const h = Math.min(Math.max(buffers.positions[v * 3 + 1]! / Math.max(trunkHeight, 1e-6), 0), 1);
    aWind[v * 3] = h * h;
  }
}
