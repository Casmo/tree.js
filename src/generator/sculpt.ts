import { cos, sin } from '../math';
import type { Sculpt, TreeDefinition } from '../definition';
import { seedRandom } from '../random';
import type { SkeletonBranch, SkeletonLeaf, Vec3 } from './types';
import { add, scale, sub } from './vec';

/**
 * The Sculpt pass (ADR 0003): hand edits stored in the Definition, applied after the procedural
 * skeleton is grown and before leaves, Growth timing, Wind weights and meshes are derived from it.
 * So a sculpted part still grows, changes with the Season and sways like any other.
 *
 * A Sculpt only applies on the Seed it was made on; every other Seed ignores it. Sculpts apply in
 * Definition order. A Sculpt whose path does not exist (any more) for this Seed is skipped.
 */
export function sculptsFor(definition: TreeDefinition, seed: number): Sculpt[] {
  return definition.sculpts.filter((s) => s.seed === seed);
}

/** True if `path` is `root` or grows from it (its descendants). */
export const inSubtree = (path: string, root: string): boolean => path === root || path.startsWith(`${root}.`);

/**
 * Applies the branch Sculpts to the skeleton branches (returns a new array, paths unchanged):
 * - `delete` drops the branch and everything growing from it;
 * - `move` rotates (Euler XYZ, radians, three.js convention, in tree space) and scales the branch
 *   and everything growing from it about the branch base. `scale` scales lengths; radii stay.
 */
export function sculptBranches(branches: SkeletonBranch[], sculpts: Sculpt[]): SkeletonBranch[] {
  let out = branches;
  for (const sculpt of sculpts) {
    if (sculpt.action === 'delete') {
      out = out.filter((b) => !inSubtree(b.path, sculpt.path));
    } else if (sculpt.action === 'move') {
      const root = out.find((b) => b.path === sculpt.path);
      if (!root) continue;
      const base = root.points[0]!.position;
      const rotate = eulerXYZ(sculpt.rotation);
      const move = (p: Vec3) => add(base, rotate(scale(sub(p, base), sculpt.scale)));
      out = out.map((b) =>
        inSubtree(b.path, sculpt.path)
          ? {
              ...b,
              direction: rotate(b.direction),
              points: b.points.map((p) => ({ position: move(p.position), radius: p.radius })),
            }
          : b,
      );
    }
  }
  return out;
}

/**
 * Applies the `leaves` Sculpts (painting): each sets the coverage (0..1) of a branch and everything
 * growing from it; a later Sculpt on a sub-branch overrides it there. A leaf is kept while its own
 * stable random number (from the Seed and leaf id) is below its coverage, so painting more coverage
 * only ever adds leaves. Season coverage then applies on top of the kept leaves as usual.
 */
export function sculptLeaves(leaves: SkeletonLeaf[], sculpts: Sculpt[], seed: number): SkeletonLeaf[] {
  const painted = sculpts.filter((s) => s.action === 'leaves');
  if (painted.length === 0) return leaves;
  return leaves.filter((leaf) => {
    let coverage = 1;
    for (const s of painted) if (inSubtree(leaf.branch, s.path)) coverage = s.coverage;
    return seedRandom(seed, `sculpt/${leaf.id}`) < coverage;
  });
}

/** The rotation of a three.js `Euler(x, y, z, 'XYZ')` (matrix Rx * Ry * Rz) as a function on vectors. */
function eulerXYZ([x, y, z]: Vec3): (v: Vec3) => Vec3 {
  const [a, b, c, d, e, f] = [cos(x), sin(x), cos(y), sin(y), cos(z), sin(z)];
  const [ae, af, be, bf] = [a * e, a * f, b * e, b * f];
  const m = [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
  return ([vx, vy, vz]) => [
    m[0]! * vx + m[1]! * vy + m[2]! * vz,
    m[3]! * vx + m[4]! * vy + m[5]! * vz,
    m[6]! * vx + m[7]! * vy + m[8]! * vz,
  ];
}
