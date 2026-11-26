import { cos, sin } from '../math';
import type { TreeDefinition, TrunkDefinition } from '../definition';
import type { Random } from '../random';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { originalSectionStart, turnCorkscrew, twistPath, type CorkscrewAlong, type TwistPath } from './twist';
import { add, cross, length, rotate, scale, sub } from './vec';

const DEG = Math.PI / 180;
/** The leader: the part of a Stem above this fraction of its length is what trunk gravity bends. */
const LEADER_START = 2 / 3;
/** How far trunk `gravity` = ±1 turns the leader over its length, degrees. */
const LEADER_BEND = 120;
/** Seed range of each Stem's lean: ± this fraction of `spread`. */
const SPREAD_VARIATION = 0.3;
/** Seed range of each Stem's place around the ring: ± this fraction of the gap between Stems. */
const RING_JITTER = 0.25;
/** Radius of the ring the Stems stand in, as a fraction of the trunk radius (several Stems only). */
const RING_RADIUS = 1;
/** How far a Stem's base ring sinks straight down below the ground, as a fraction of the trunk radius (no seam on uneven terrain). */
export const BASE_SINK = 0.1;
/** Root Flare zone: the bottom fraction of a Stem's length (measured along it, after Sculpts) that widens. */
export const FLARE_ZONE = 0.12;
/** Root Flare width: at `flare` = 1 the base ring is (1 + this) × the trunk radius. */
export const FLARE_WIDTH = 0.8;
/** Extra rings the trunk sweep puts in the Root Flare zone while `trunk.flareSections` is absent (the low-poly Style sets 2). */
export const FLARE_SECTIONS = 3;

/**
 * Builds the Stems: `trunk.stems` full trunks standing in a small ring at the base, paths "0", "1", ...
 *
 * Path stability (ADR 0003): Stem 0's centre line draws from `random.fork('trunk')` exactly as a
 * single trunk always did, Stem i > 0 from `random.fork('trunk/<i>')`; each Stem's Twist turns come
 * from that stream's own `fork('twist')` (ADR 0015); the ring and the leans come from
 * `random.fork('stems')`. So a single upright Stem without gravity is today's trunk, bit for bit.
 *
 * Each Corkscrew Stem's phase along its length goes into `corkscrews` under its path, turned with the
 * Stem as it is placed (Trunk gravity, lean), so the first-level branches on it with Follow Twist can
 * pick it up (`buildBranches`).
 */
export function buildStems(definition: TreeDefinition, random: Random, corkscrews = new Map<string, CorkscrewAlong>()): SkeletonBranch[] {
  const { trunk } = definition;
  const { stems: count = 1, spread = 0, gravity = 0 } = trunk;
  const ring = random.fork('stems');
  const turn = ring.range(0, Math.PI * 2);
  const stems: SkeletonBranch[] = [];
  for (let i = 0; i < count; i++) {
    const r = ring.fork(i);
    const azimuth = turn + ((i + r.range(-RING_JITTER, RING_JITTER)) / count) * Math.PI * 2;
    const tilt = Math.min(spread * (1 + r.range(-SPREAD_VARIATION, SPREAD_VARIATION)), 90) * DEG;
    const offset = count > 1 ? trunk.radius * RING_RADIUS : 0;
    const { points, twisting, courses } = centreLine(trunk, random.fork(i === 0 ? 'trunk' : `trunk/${i}`));
    const { stem, place } = placeStem(String(i), points, gravity, azimuth, tilt, offset);
    // A Corkscrew Stem rolls its bark and what grows on it with its Corkscrew turn (ADR 0016).
    const roll = twisting.roll(1);
    stems.push(roll ? { ...stem, roll } : stem);
    if (twisting.spin) {
      // Worked out upright on the Section's course, then turned as that Section was placed.
      corkscrews.set(stem.path, (u) => {
        const k = Math.min(Math.floor(u * courses.length), courses.length - 1);
        const at = twisting.corkscrewAt(courses[k]!, u);
        return at && turnCorkscrew(at, (v) => place(v, k));
      });
    }
  }
  return stems;
}

/**
 * One upright, unbent Stem's centre line at the origin, varied by the Seed within the trunk's ranges,
 * then snaked by the trunk's Twist (ADR 0015: max(Sections, 3 × Twists) Sections). The Twist's turns
 * come from the Stem's own `random.fork('twist')`, so the draws of today's centre line never shift.
 * A Corkscrew Stem (6 × Twists Sections, ADR 0016) corkscrews the same way, around its upright course.
 */
function centreLine(trunk: TrunkDefinition, random: Random): { points: SkeletonPoint[]; twisting: TwistPath; courses: Vec3[] } {
  const line = straightLine(trunk, random);
  const twisting = twistPath(trunk, trunk.sections, [0, 1, 0], random.fork('twist'));
  if ((trunk.twist ?? 0) <= 0) return { points: line, twisting, courses: [] };

  // Today's line on the Twist's Sections (Bend's drift stays tied to the original Sections), then every
  // Section steered along the Twist. The base Section grows upright (sampled at the very start); the
  // others are sampled at their middle like a branch's, so every turn reaches its full swing.
  const untwisted = resample(line, twisting.sections);
  const points: SkeletonPoint[] = [untwisted[0]!];
  // Each Section's unit course (upright when it has no length), where the branches on it pick up its Corkscrew phase (Follow Twist).
  const courses: Vec3[] = [];
  for (let k = 0; k < twisting.sections; k++) {
    const segment = sub(untwisted[k + 1]!.position, untwisted[k]!.position);
    const size = length(segment);
    const u = k === 0 ? 0 : (k + 0.5) / twisting.sections;
    courses.push(size > 0 ? scale(segment, 1 / size) : [0, 1, 0]);
    const direction = size > 0 ? twisting.steer(courses[k]!, u) : segment;
    points.push({ position: add(points[k]!.position, scale(direction, size)), radius: untwisted[k + 1]!.radius });
  }
  return { points, twisting, courses };
}

/** Today's centre line: upright, drifting sideways by up to `bend` per Section. */
function straightLine(trunk: TrunkDefinition, random: Random): SkeletonPoint[] {
  const stemLength = trunk.length * (1 + random.range(-trunk.lengthVariation, trunk.lengthVariation));
  const sectionLength = stemLength / trunk.sections;
  const maxDrift = trunk.bend * sectionLength;

  const points: SkeletonPoint[] = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i <= trunk.sections; i++) {
    const t = i / trunk.sections;
    if (i > 0) {
      x += random.range(-maxDrift, maxDrift);
      z += random.range(-maxDrift, maxDrift);
    }
    points.push({ position: [x, t * stemLength, z], radius: trunk.radius * (1 + (trunk.taper - 1) * t) });
  }
  return points;
}

/**
 * The same polyline on `sections` (>= its own) Sections: every original corner is kept, where the
 * original Section starts as for a branch's Bend (ADR 0015), and the extra Sections are spread evenly
 * within the original Sections, so Bend's drift stays exact.
 */
function resample(line: SkeletonPoint[], sections: number): SkeletonPoint[] {
  const n = line.length - 1;
  const cornerAt = (j: number) => originalSectionStart(j, n, sections);
  const points: SkeletonPoint[] = [line[0]!];
  for (let j = 0; j < n; j++) {
    const [a, b] = [line[j]!, line[j + 1]!];
    const [from, to] = [cornerAt(j), cornerAt(j + 1)];
    for (let k = from + 1; k < to; k++) {
      const f = (k - from) / (to - from);
      points.push({ position: add(a.position, scale(sub(b.position, a.position), f)), radius: a.radius + (b.radius - a.radius) * f });
    }
    points.push(b);
  }
  return points;
}

/**
 * Bends the leader by `gravity`, leans the Stem `tilt` radians out towards `azimuth` and moves its
 * base `offset` out along the ring. All bending happens in the vertical plane towards `azimuth`.
 * `place` turns a direction along the centre line's Section `k` as that Section was turned.
 */
function placeStem(
  path: string,
  line: SkeletonPoint[],
  gravity: number,
  azimuth: number,
  tilt: number,
  offset: number,
): { stem: SkeletonBranch; place(v: Vec3, k: number): Vec3 } {
  const out: Vec3 = [cos(azimuth), 0, sin(azimuth)];
  const axis = cross([0, 1, 0], out); // rotating about it by a positive angle turns up towards `out`
  let points = line;
  // How far gravity turned each Section of the leader.
  const bends: number[] = [];

  if (gravity !== 0) {
    const sections = line.length - 1;
    const first = Math.min(sections - 1, Math.ceil(LEADER_START * sections));
    const step = (-gravity * LEADER_BEND * DEG) / (sections - first);
    // The leader turns a little more at every section; never back past vertical, never upside down.
    let bend = 0;
    points = line.slice(0, first + 1);
    for (let k = first; k < sections; k++) {
      bend = Math.min(Math.max(bend + step, -tilt), Math.PI - tilt);
      bends[k] = bend;
      const segment = sub(line[k + 1]!.position, line[k]!.position);
      points.push({ position: add(points[k]!.position, rotate(segment, axis, bend)), radius: line[k + 1]!.radius });
    }
  }
  if (tilt !== 0) points = points.map((p) => ({ position: rotate(p.position, axis, tilt), radius: p.radius }));
  if (offset !== 0) points = points.map((p) => ({ position: add(p.position, scale(out, offset)), radius: p.radius }));

  return {
    stem: { path, parent: null, level: 0, attach: 0, direction: rotate([0, 1, 0], axis, tilt), points },
    place: (v, k) => rotate(v, axis, tilt + (bends[k] ?? 0)),
  };
}
