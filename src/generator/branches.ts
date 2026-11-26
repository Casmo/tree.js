import { cos, sin } from '../math';
import type { BranchLevelDefinition, TreeDefinition } from '../definition';
import type { Random } from '../random';
import { sampleTrack } from '../season/profile';
import { branchFrames, pathLength, sampleBranch } from './frames';
import { twistPath, type TwistPath } from './twist';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { add, normalize, scale } from './vec';

const DEG = Math.PI / 180;
/** How far `gravity` = ±1 turns a branch over its whole length (sum of per-section pulls). */
const GRAVITY_PER_BRANCH = 1.5;

/**
 * Grows all branching levels on every Stem, breadth first (level by level, over all Stems).
 *
 * Branch path stability (ADR 0003): a parent's spiral phase comes from `random.fork(parentPath)`
 * and each child's shape from `random.fork(childPath)`; a child's Twist turns come from that stream's
 * own `fork('twist')`, so Twist never shifts the draws of its shape (ADR 0015). So a branch depends
 * only on its ancestors and its own path, never on its siblings' subtrees, on deeper levels or on leaves.
 */
export function buildBranches(definition: TreeDefinition, stems: SkeletonBranch[], random: Random): SkeletonBranch[] {
  const out: SkeletonBranch[] = [];
  const queue: SkeletonBranch[] = [...stems];
  // Each grown branch's Twist (its Spin, roll and curve axis), there for its children when they are grown (Follow Twist).
  const twists = new Map<string, TwistPath>();
  for (let q = 0; q < queue.length; q++) {
    const parent = queue[q]!;
    const level = definition.branches[parent.level];
    if (!level) continue;
    const children = growChildren(parent, level, random, twists);
    out.push(...children);
    queue.push(...children);
  }
  return out;
}

/** A Crown Shape curve's multiplier at attach position `t`; an absent curve is flat (1). */
const crownShape = (curve: BranchLevelDefinition['lengthProfile'], t: number) => (curve ? sampleTrack(curve, t) : 1);

/**
 * Grows one parent's children. The Crown Shape curves (`lengthProfile`, `angleProfile`) scale each
 * child's length and angle by where it sits on the parent (ADR 0004). Each child's Twist goes into
 * `twists` under its path, so its own children can read it.
 */
function growChildren(parent: SkeletonBranch, level: BranchLevelDefinition, random: Random, twists: Map<string, TwistPath>): SkeletonBranch[] {
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

    const angle = Math.min(level.angle * crownShape(level.angleProfile, t) * (1 + r.range(-level.angleVariation, level.angleVariation)), 180) * DEG;
    const azimuth = azimuth0 + i * level.spiral * DEG;
    const across = add(scale(at.normal, cos(azimuth)), scale(at.binormal, sin(azimuth)));
    const start = normalize(add(scale(at.tangent, cos(angle)), scale(across, sin(angle))));
    const twisting = twistPath(level, level.sections, start, r.fork('twist'));
    twists.set(path, twisting);
    const sections = twisting.sections;
    // Gravity bends the branch up (+) or down (-) a little more with every Section; spread over the
    // Sections, so a Twist's extra Sections do not add to its total pull (ADR 0015).
    const pull: Vec3 = [0, (level.gravity * GRAVITY_PER_BRANCH) / sections, 0];
    // Where the branch heads without Twist; it grows along the Twist's smooth path around it.
    let course = start;

    const length = parentLength * level.length * crownShape(level.lengthProfile, t) * (1 + r.range(-level.lengthVariation, level.lengthVariation));
    const step = length / sections;
    const baseRadius = at.radius * level.radius;

    const points: SkeletonPoint[] = [];
    let position: Vec3 = at.position;
    for (let s = 0; s <= sections; s++) {
      points.push({ position, radius: baseRadius * (1 + (level.taper - 1) * (s / sections)) });
      if (s === sections) break;
      // Bend's jitter stays on the original Sections; the in-between Sections only follow the path.
      const wander: Vec3 | null = twisting.takesBend(s) ? [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)] : null;
      course = normalize(add(wander ? add(course, scale(wander, level.bend)) : course, pull));
      position = add(position, scale(twisting.steer(course, (s + 0.5) / sections), step));
    }
    children.push({ path, parent: parent.path, level: parent.level + 1, attach: t, direction: start, points });
  }
  return children;
}
