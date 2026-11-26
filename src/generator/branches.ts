import { cos, sin } from '../math';
import { tipBranchesOf, type BranchLevelDefinition, type TreeDefinition } from '../definition';
import type { Random } from '../random';
import { sampleTrack } from '../season/profile';
import { branchFrames, pathLength, sampleBranch, type BranchSample, type Frame } from './frames';
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
    const children = growChildren(parent, level, parent.level, random, corkscrews);
    out.push(...children);
    queue.push(...children);
  }
  return out;
}

/** A Crown Shape curve's multiplier at attach position `t`; an absent curve is flat (1). */
const crownShape = (curve: BranchLevelDefinition['lengthProfile'], t: number) => (curve ? sampleTrack(curve, t) : 1);

/**
 * Grows one parent's children: first its `count` side branches spread between the level's `start` and
 * `end`, then its Tip Branches at the very tip, at the paths after them (`<parent>.<count>`, ...), so
 * turning Tip Branches on or off never moves a side branch or shifts its draws (ADR 0003, ADR 0019).
 * The Crown Shape curves (`lengthProfile`, `angleProfile`) scale each child's length and angle by where
 * it sits on the parent (ADR 0004); a Tip Branch sits at `t` = 1. Each Corkscrew child's phase goes into
 * `corkscrews` under its path, so its own children can follow it (Follow Twist).
 */
function growChildren(
  parent: SkeletonBranch,
  level: BranchLevelDefinition,
  index: number,
  random: Random,
  corkscrews: Map<string, CorkscrewAlong>,
): SkeletonBranch[] {
  const count = level.count;
  const followed = level.followTwist ? corkscrews.get(parent.path) : undefined;
  // The parent's own stream: the spiral's phase first, then (only with Tip Branches) the turn of its tip.
  const parentRandom = random.fork(parent.path);
  const azimuth0 = parentRandom.range(0, Math.PI * 2);
  const frames = branchFrames(parent);
  const parentLength = pathLength(parent);
  const lengthAt = (t: number, r: Random) =>
    parentLength * level.length * crownShape(level.lengthProfile, t) * (1 + r.range(-level.lengthVariation, level.lengthVariation));

  const children: SkeletonBranch[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${parent.path}.${i}`;
    const r = random.fork(path);
    const t = level.start + ((level.end - level.start) * (i + r.range(0.15, 0.85))) / count;
    const at = sampleBranch(parent, frames, t);
    const angle = Math.min(level.angle * crownShape(level.angleProfile, t) * (1 + r.range(-level.angleVariation, level.angleVariation)), 180) * DEG;
    const start = leaning(at, angle, azimuth0 + i * level.spiral * DEG);
    const length = lengthAt(t, r);
    children.push(growBranch(parent, level, { path, random: r, attach: t, at, start, length, baseRadius: at.radius * level.radius }, followed, corkscrews));
  }

  // One Tip Branch carries the parent on; 2-4 fork it.
  const tips = tipBranchesOf(level, index);
  if (tips === 0) return children;
  const at = tipOf(parent, frames);
  const turn = parentRandom.range(0, Math.PI * 2);
  for (let j = 0; j < tips; j++) {
    const path = `${parent.path}.${count + j}`;
    const r = random.fork(path);
    // One carries straight on along the parent's tip tangent, a fork leans out by half the level's Angle (at the
    // angle curve's tip value); angleVariation lets either wander by that half Angle times the variation.
    const splay = (tips > 1 ? 1 : 0) + r.range(-level.angleVariation, level.angleVariation);
    const lean = Math.min(0.5 * level.angle * crownShape(level.angleProfile, 1) * splay, 180) * DEG;
    const start = leaning(at, lean, turn + (j * Math.PI * 2) / tips);
    const length = lengthAt(1, r);
    // As thick as the parent's tip: the level's radius fraction does not apply, its taper does.
    children.push(growBranch(parent, level, { path, random: r, attach: 1, at, start, length, baseRadius: at.radius, tip: true }, followed, corkscrews));
  }
  return children;
}

/** The point, frame and radius at the very tip of `parent`: exactly its last centre-line point. */
function tipOf(parent: SkeletonBranch, frames: Frame[]): BranchSample {
  const last = parent.points[parent.points.length - 1]!;
  return { ...sampleBranch(parent, frames, 1), position: last.position, radius: last.radius };
}

/** The unit direction `angle` (radians) away from `at`'s tangent, towards `azimuth` (radians) around it. */
function leaning(at: Frame, angle: number, azimuth: number): Vec3 {
  const across = add(scale(at.normal, cos(azimuth)), scale(at.binormal, sin(azimuth)));
  return normalize(add(scale(at.tangent, cos(angle)), scale(across, sin(angle))));
}

/** Where and how one child starts: what differs between a side branch and a Tip Branch. */
interface ChildStart {
  path: string;
  /** The child's own stream, `random.fork(path)`, after the draws for its start. */
  random: Random;
  /** Where it sits on the parent (0..1); 1 for a Tip Branch. */
  attach: number;
  /** The parent's point and frame there. */
  at: BranchSample;
  /** Unit direction it leaves the parent in. */
  start: Vec3;
  length: number;
  baseRadius: number;
  tip?: true;
}

/**
 * Grows one child of `parent` from its {@link ChildStart}: Twist, Bend and Gravity along its Sections and
 * the level's taper, the same for a side branch and a Tip Branch. A Corkscrew child's phase goes into `corkscrews`.
 */
function growBranch(
  parent: SkeletonBranch,
  level: BranchLevelDefinition,
  { path, random: r, attach, at, start, length, baseRadius, tip }: ChildStart,
  followed: CorkscrewAlong | undefined,
  corkscrews: Map<string, CorkscrewAlong>,
): SkeletonBranch {
  const twisting = twistPath(level, level.sections, start, r.fork('twist'), followed?.(attach));
  const sections = twisting.sections;
  // Gravity bends the branch up (+) or down (-) a little more with every Section; spread over the
  // Sections, so a Twist's extra Sections do not add to its total pull (ADR 0015).
  const pull: Vec3 = [0, (level.gravity * GRAVITY_PER_BRANCH) / sections, 0];
  // Where the branch heads without Twist; it grows along the Twist's smooth path around it.
  let course = start;
  const step = length / sections;

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
  return { path, parent: parent.path, level: parent.level + 1, attach, direction: start, points, ...(roll ? { roll } : {}), ...(tip ? { tip } : {}) };
}
