// Geometry for the viewport Sculpt tools, on the tree's skeleton (tree space): which branch a point on
// the mesh belongs to, which leaf-bearing branches a brush reaches, and the turn a drag makes.
import { Quaternion, Vector3 } from 'three/webgpu';
import type { SkeletonBranch, Vec3 } from '@casmo/tree.js';
import type { MoveDelta } from './sculpts';

const a = new Vector3();
const b = new Vector3();
const p = new Vector3();
const closest = new Vector3();

/** Distance from `point` to the centre line of `branch`, and the branch radius there. */
function distanceToBranch(branch: SkeletonBranch, point: Vec3): { distance: number; radius: number } {
  p.set(...point);
  let best = { distance: Infinity, radius: 0 };
  const { points } = branch;
  for (let i = 0; i < Math.max(1, points.length - 1); i++) {
    const start = points[i]!;
    const end = points[Math.min(i + 1, points.length - 1)]!;
    a.set(...start.position);
    b.set(...end.position).sub(a);
    const lengthSq = b.lengthSq();
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, p.clone().sub(a).dot(b) / lengthSq)) : 0;
    closest.copy(a).addScaledVector(b, t);
    const distance = closest.distanceTo(p);
    if (distance < best.distance) best = { distance, radius: start.radius + (end.radius - start.radius) * t };
  }
  return best;
}

/** The path of the branch whose bark is nearest to `point` (e.g. a raycast hit on the wood), or null. */
export function nearestBranch(branches: readonly SkeletonBranch[], point: Vec3): string | null {
  let best: { path: string; gap: number } | null = null;
  for (const branch of branches) {
    const { distance, radius } = distanceToBranch(branch, point);
    const gap = Math.abs(distance - radius);
    if (!best || gap < best.gap) best = { path: branch.path, gap };
  }
  return best?.path ?? null;
}

/**
 * The leaf-bearing branches (level `leafLevel`: the outermost one) that come within `radius` of
 * `point`: the branches a leaf brush stroke at `point` paints.
 */
export function brushBranches(branches: readonly SkeletonBranch[], leafLevel: number, point: Vec3, radius: number): string[] {
  return branches.filter((branch) => branch.level === leafLevel && distanceToBranch(branch, point).distance <= radius).map((b) => b.path);
}

/**
 * The move made by dragging the point `from` of a branch to `to`, turning about the branch `base`.
 * With `stretch` the branch also scales by how much farther from the base the point now is.
 */
export function dragTurn(base: Vec3, from: Vec3, to: Vec3, stretch: boolean): MoveDelta {
  const origin = new Vector3(...base);
  const start = new Vector3(...from).sub(origin);
  const end = new Vector3(...to).sub(origin);
  if (start.lengthSq() === 0 || end.lengthSq() === 0) return { rotation: [0, 0, 0, 1], scale: 1 };
  const rotation = new Quaternion().setFromUnitVectors(start.clone().normalize(), end.clone().normalize());
  return { rotation: rotation.toArray() as MoveDelta['rotation'], scale: stretch ? end.length() / start.length() : 1 };
}
