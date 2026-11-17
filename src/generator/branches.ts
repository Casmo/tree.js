import type { BranchLevelDefinition, TreeDefinition } from '../definition';
import type { Random } from '../random';
import { branchFrames, pathLength, sampleBranch } from './frames';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { add, normalize, scale } from './vec';

const DEG = Math.PI / 180;
/** How far `gravity` = ±1 turns a branch over its whole length (sum of per-section pulls). */
const GRAVITY_PER_BRANCH = 1.5;

/**
 * Grows all branching levels below the trunk, breadth first (level by level).
 *
 * Branch path stability (ADR 0003): a parent's spiral phase comes from `random.fork(parentPath)`
 * and each child's shape from `random.fork(childPath)`. So a branch depends only on its
 * ancestors and its own path, never on its siblings' subtrees, on deeper levels or on leaves.
 */
export function buildBranches(definition: TreeDefinition, trunk: SkeletonBranch, random: Random): SkeletonBranch[] {
  const out: SkeletonBranch[] = [];
  const queue: SkeletonBranch[] = [trunk];
  for (let q = 0; q < queue.length; q++) {
    const parent = queue[q]!;
    const level = definition.branches[parent.level];
    if (!level) continue;
    const children = growChildren(parent, level, random);
    out.push(...children);
    queue.push(...children);
  }
  return out;
}

function growChildren(parent: SkeletonBranch, level: BranchLevelDefinition, random: Random): SkeletonBranch[] {
  const count = level.count;
  const azimuth0 = random.fork(parent.path).range(0, Math.PI * 2);
  const frames = branchFrames(parent);
  const parentLength = pathLength(parent);

  const children: SkeletonBranch[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${parent.path}.${i}`;
    const r = random.fork(path);
    const t = level.start + ((level.end - level.start) * (i + r.range(0.15, 0.85))) / count;
    const at = sampleBranch(parent, frames, t);

    const angle = Math.min(level.angle * (1 + r.range(-level.angleVariation, level.angleVariation)), 180) * DEG;
    const azimuth = azimuth0 + i * level.spiral * DEG;
    const across = add(scale(at.normal, Math.cos(azimuth)), scale(at.binormal, Math.sin(azimuth)));
    const start = normalize(add(scale(at.tangent, Math.cos(angle)), scale(across, Math.sin(angle))));
    // Gravity bends the branch up (+) or down (-) a little more with every section.
    const pull: Vec3 = [0, (level.gravity * GRAVITY_PER_BRANCH) / level.sections, 0];
    let direction = start;

    const length = parentLength * level.length * (1 + r.range(-level.lengthVariation, level.lengthVariation));
    const step = length / level.sections;
    const baseRadius = at.radius * level.radius;

    const points: SkeletonPoint[] = [];
    let position: Vec3 = at.position;
    for (let s = 0; s <= level.sections; s++) {
      points.push({ position, radius: baseRadius * (1 + (level.taper - 1) * (s / level.sections)) });
      if (s === level.sections) break;
      const wander: Vec3 = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)];
      direction = normalize(add(add(direction, scale(wander, level.bend)), pull));
      position = add(position, scale(direction, step));
    }
    children.push({ path, parent: parent.path, level: parent.level + 1, attach: t, direction: start, points });
  }
  return children;
}
