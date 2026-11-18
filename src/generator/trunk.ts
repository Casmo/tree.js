import { cos, sin } from '../math';
import type { TreeDefinition, TrunkDefinition } from '../definition';
import type { Random } from '../random';
import type { SkeletonBranch, SkeletonPoint, Vec3 } from './types';
import { add, cross, dot, scale, sub } from './vec';

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

/**
 * Builds the Stems: `trunk.stems` full trunks standing in a small ring at the base, paths "0", "1", ...
 *
 * Path stability (ADR 0003): Stem 0's centre line draws from `random.fork('trunk')` exactly as a
 * single trunk always did, Stem i > 0 from `random.fork('trunk/<i>')`; the ring and the leans come
 * from `random.fork('stems')`. So a single upright Stem without gravity is today's trunk, bit for bit.
 */
export function buildStems(definition: TreeDefinition, random: Random): SkeletonBranch[] {
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
    const line = centreLine(trunk, random.fork(i === 0 ? 'trunk' : `trunk/${i}`));
    stems.push(placeStem(String(i), line, gravity, azimuth, tilt, offset));
  }
  return stems;
}

/** One upright, unbent Stem's centre line at the origin, varied by the Seed within the trunk's ranges. */
function centreLine(trunk: TrunkDefinition, random: Random): SkeletonPoint[] {
  const length = trunk.length * (1 + random.range(-trunk.lengthVariation, trunk.lengthVariation));
  const sectionLength = length / trunk.sections;
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
    points.push({ position: [x, t * length, z], radius: trunk.radius * (1 + (trunk.taper - 1) * t) });
  }
  return points;
}

/**
 * Bends the leader by `gravity`, leans the Stem `tilt` radians out towards `azimuth` and moves its
 * base `offset` out along the ring. All bending happens in the vertical plane towards `azimuth`.
 */
function placeStem(path: string, line: SkeletonPoint[], gravity: number, azimuth: number, tilt: number, offset: number): SkeletonBranch {
  const out: Vec3 = [cos(azimuth), 0, sin(azimuth)];
  const axis = cross([0, 1, 0], out); // rotating about it by a positive angle turns up towards `out`
  let points = line;

  if (gravity !== 0) {
    const sections = line.length - 1;
    const first = Math.min(sections - 1, Math.ceil(LEADER_START * sections));
    const step = (-gravity * LEADER_BEND * DEG) / (sections - first);
    // The leader turns a little more at every section; never back past vertical, never upside down.
    let bend = 0;
    points = line.slice(0, first + 1);
    for (let k = first; k < sections; k++) {
      bend = Math.min(Math.max(bend + step, -tilt), Math.PI - tilt);
      const segment = sub(line[k + 1]!.position, line[k]!.position);
      points.push({ position: add(points[k]!.position, rotate(segment, axis, bend)), radius: line[k + 1]!.radius });
    }
  }
  if (tilt !== 0) points = points.map((p) => ({ position: rotate(p.position, axis, tilt), radius: p.radius }));
  if (offset !== 0) points = points.map((p) => ({ position: add(p.position, scale(out, offset)), radius: p.radius }));

  return { path, parent: null, level: 0, attach: 0, direction: rotate([0, 1, 0], axis, tilt), points };
}

/** Rotates `v` about the unit `axis` by `angle` radians (Rodrigues). */
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  if (angle === 0) return v;
  const c = cos(angle);
  const s = sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
