import type { SkeletonBranch, Vec3 } from './types';
import { add, cross, dot, length, lerp, normalize, perpendicular, scale, sub } from './vec';

/** An orthonormal frame on a branch's centre line: `tangent` along the branch, `normal`/`binormal` across it. */
export interface Frame {
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
}

/**
 * Parallel-transport frames, one per skeleton point: the cross-section does not twist
 * as the branch bends, so swept rings stay even for branches in any direction.
 */
export function branchFrames(branch: SkeletonBranch): Frame[] {
  const pts = branch.points.map((p) => p.position);
  const n = pts.length;
  const segment = (i: number): Vec3 => normalize(sub(pts[Math.min(i + 1, n - 1)]!, pts[Math.min(i, n - 2)]!));
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    // The trunk stands flat on the ground: its base ring is horizontal.
    const tangent: Vec3 =
      i === 0 && branch.parent === null
        ? [0, 1, 0]
        : i === 0 || i === n - 1
          ? segment(Math.min(i, n - 2))
          : normalize(add(segment(i - 1), segment(i)));
    let normal: Vec3;
    if (i === 0) {
      normal = perpendicular(tangent);
    } else {
      const previous = frames[i - 1]!.normal;
      normal = normalize(sub(previous, scale(tangent, dot(previous, tangent))));
    }
    frames.push({ tangent, normal, binormal: cross(tangent, normal) });
  }
  return frames;
}

/** Total length of a branch's centre line. */
export function pathLength(branch: SkeletonBranch): number {
  let total = 0;
  for (let i = 1; i < branch.points.length; i++) {
    total += length(sub(branch.points[i]!.position, branch.points[i - 1]!.position));
  }
  return total;
}

export interface BranchSample extends Frame {
  position: Vec3;
  radius: number;
}

/** The point, frame and radius at fraction `t` (0..1) of a branch's length. */
export function sampleBranch(branch: SkeletonBranch, frames: Frame[], t: number): BranchSample {
  const pts = branch.points;
  const target = Math.min(Math.max(t, 0), 1) * pathLength(branch);
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const segment = length(sub(b.position, a.position));
    if (walked + segment >= target || i === pts.length - 1) {
      const f = segment > 0 ? Math.min(Math.max((target - walked) / segment, 0), 1) : 0;
      const tangent = normalize(lerp(frames[i - 1]!.tangent, frames[i]!.tangent, f));
      const normal = normalize(sub(frames[i - 1]!.normal, scale(tangent, dot(frames[i - 1]!.normal, tangent))));
      return {
        position: lerp(a.position, b.position, f),
        radius: a.radius + (b.radius - a.radius) * f,
        tangent,
        normal,
        binormal: cross(tangent, normal),
      };
    }
    walked += segment;
  }
  const last = pts[pts.length - 1]!;
  return { position: last.position, radius: last.radius, ...frames[frames.length - 1]! };
}
