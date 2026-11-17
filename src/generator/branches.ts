import type { BranchLevelDefinition, TreeDefinition } from '../definition';
import type { Random } from '../random';
import { branchFrames, pathLength, sampleBranch } from './frames';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { add, normalize, scale } from './vec';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEG = Math.PI / 180;

/**
 * Grows all branching levels below the trunk, breadth first (level by level).
 *
 * Branch path stability (ADR 0003): a parent's child count comes from `random.fork(parentPath)`
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
  const parentRandom = random.fork(parent.path);
  const count = Math.max(0, Math.round(level.count * (1 + parentRandom.range(-level.countVariation, level.countVariation))));
  const azimuth0 = parentRandom.range(0, Math.PI * 2);
  const frames = branchFrames(parent);
  const parentLength = pathLength(parent);

  const children: SkeletonBranch[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${parent.path}.${i}`;
    const r = random.fork(path);
    const t = level.start + ((1 - level.start) * (i + r.range(0.15, 0.85))) / count;
    const at = sampleBranch(parent, frames, t);

    const angle = Math.min(Math.max(level.angle + r.range(-level.angleVariation, level.angleVariation), 0), 180) * DEG;
    const azimuth = azimuth0 + i * GOLDEN_ANGLE + r.range(-0.3, 0.3);
    const across = add(scale(at.normal, Math.cos(azimuth)), scale(at.binormal, Math.sin(azimuth)));
    let direction = normalize(add(scale(at.tangent, Math.cos(angle)), scale(across, Math.sin(angle))));

    const length = parentLength * level.length * (1 + r.range(-level.lengthVariation, level.lengthVariation));
    const step = length / level.sections;
    const baseRadius = at.radius * level.radius;

    const points: SkeletonPoint[] = [];
    let position: Vec3 = at.position;
    for (let s = 0; s <= level.sections; s++) {
      points.push({ position, radius: baseRadius * (1 + (level.taper - 1) * (s / level.sections)) });
      if (s === level.sections) break;
      const wander: Vec3 = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)];
      direction = normalize(add(direction, scale(wander, level.bend)));
      position = add(position, scale(direction, step));
    }
    children.push({ path, parent: parent.path, level: parent.level + 1, attach: t, points });
  }
  return children;
}
