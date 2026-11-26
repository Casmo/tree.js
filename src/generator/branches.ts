import { cos, sin } from '../math';
import type { BranchLevelDefinition, TreeDefinition } from '../definition';
import type { Random } from '../random';
import { sampleTrack } from '../season/profile';
import { branchFrames, pathLength, sampleBranch } from './frames';
import { buildStems } from './trunk';
import { twistPath, type CorkscrewAlong } from './twist';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { add, normalize, scale } from './vec';

const DEG = Math.PI / 180;
/** How far `gravity` = ±1 turns a branch over its whole length (sum of per-section pulls). */
const GRAVITY_PER_BRANCH = 1.5;

/**
 * The Stems and then every branch on them, before Sculpts: the Stems from `random` ({@link buildStems}),
 * the branches from `random.fork('branches')`, with each Corkscrew Stem passed on for Follow Twist.
 */
export function growStemsAndBranches(definition: TreeDefinition, random: Random): SkeletonBranch[] {
  const corkscrews = new Map<string, CorkscrewAlong>();
  const stems = buildStems(definition, random, corkscrews);
  return [...stems, ...buildBranches(definition, stems, random.fork('branches'), corkscrews)];
}

/**
 * Grows all branching levels on every Stem, breadth first (level by level, over all Stems).
 *
 * Branch path stability (ADR 0003): a parent's spiral phase comes from `random.fork(parentPath)`
 * and each child's shape from `random.fork(childPath)`; a child's Twist turns come from that stream's
 * own `fork('twist')`, so Twist never shifts the draws of its shape (ADR 0015). So a branch depends
 * only on its ancestors and its own path, never on its siblings' subtrees, on deeper levels or on leaves.
 *
 * `stemCorkscrews` holds each Corkscrew Stem's phase along its length (by path), which first-level
 * branches with Follow Twist pick up; a Stem without one is not followed.
 */
function buildBranches(
  definition: TreeDefinition,
  stems: SkeletonBranch[],
  random: Random,
  stemCorkscrews: ReadonlyMap<string, CorkscrewAlong>,
): SkeletonBranch[] {
  const out: SkeletonBranch[] = [];
  const queue: SkeletonBranch[] = [...stems];
  // Each Corkscrew's phase along its length, there for its children when they are grown (Follow Twist).
  const corkscrews = new Map<string, CorkscrewAlong>(stemCorkscrews);
  for (let q = 0; q < queue.length; q++) {
    const parent = queue[q]!;
    const level = definition.branches[parent.level];
    if (!level) continue;
    const children = growChildren(parent, level, random, corkscrews);
    out.push(...children);
    queue.push(...children);
  }
  return out;
}

/** A Crown Shape curve's multiplier at attach position `t`; an absent curve is flat (1). */
const crownShape = (curve: BranchLevelDefinition['lengthProfile'], t: number) => (curve ? sampleTrack(curve, t) : 1);

/**
 * Grows one parent's children. The Crown Shape curves (`lengthProfile`, `angleProfile`) scale each
 * child's length and angle by where it sits on the parent (ADR 0004). Each Corkscrew child's phase
 * goes into `corkscrews` under its path, so its own children can follow it (Follow Twist).
 */
function growChildren(parent: SkeletonBranch, level: BranchLevelDefinition, random: Random, corkscrews: Map<string, CorkscrewAlong>): SkeletonBranch[] {
  const count = level.count;
  const followed = level.followTwist ? corkscrews.get(parent.path) : undefined;
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
    const twisting = twistPath(level, level.sections, start, r.fork('twist'), followed?.(t));
    const sections = twisting.sections;
    // Gravity bends the branch up (+) or down (-) a little more with every Section; spread over the
    // Sections, so a Twist's extra Sections do not add to its total pull (ADR 0015).
    const pull: Vec3 = [0, (level.gravity * GRAVITY_PER_BRANCH) / sections, 0];
    // Where the branch heads without Twist; it grows along the Twist's smooth path around it.
    let course = start;

    const length = parentLength * level.length * crownShape(level.lengthProfile, t) * (1 + r.range(-level.lengthVariation, level.lengthVariation));
    const step = length / sections;
    const baseRadius = at.radius * level.radius;

    // Each Section's course, for where its children pick up its Corkscrew phase (Follow Twist); kept for Corkscrews only.
    const courses: Vec3[] | null = twisting.spin ? [] : null;
    const points: SkeletonPoint[] = [];
    let position: Vec3 = at.position;
    for (let s = 0; s <= sections; s++) {
      points.push({ position, radius: baseRadius * (1 + (level.taper - 1) * (s / sections)) });
      if (s === sections) break;
      // Bend's jitter stays on the original Sections; the in-between Sections only follow the path.
      const wander: Vec3 | null = twisting.takesBend(s) ? [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)] : null;
      course = normalize(add(wander ? add(course, scale(wander, level.bend)) : course, pull));
      courses?.push(course);
      position = add(position, scale(twisting.steer(course, (s + 0.5) / sections), step));
    }
    // A Corkscrew rolls its bark and what grows on it with its Corkscrew turn (ADR 0016).
    if (courses) corkscrews.set(path, (u) => twisting.corkscrewAt(courses[Math.min(Math.floor(u * sections), sections - 1)]!, u));
    const roll = twisting.roll(1);
    children.push({ path, parent: parent.path, level: parent.level + 1, attach: t, direction: start, points, ...(roll ? { roll } : {}) });
  }
  return children;
}
