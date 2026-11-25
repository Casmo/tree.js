import { cos, sin } from '../math';
import type { Random } from '../random';
import type { Vec3 } from './types';
import { add, cross, dot, length, normalize, perpendicular, scale, sub } from './vec';

/** Twists while `twists` is absent: an S. */
export const DEFAULT_TWISTS = 2;
/** How far `twist` = 1 swings a branch away from its course at every turn, radians (45°). */
const SWING = Math.PI / 4;
/** Sections a twisted branch or Stem needs per turn for the turn to show (ADR 0015). */
const SECTIONS_PER_TURN = 3;

/** The Twist settings of a branch level (or, later, the trunk): both optional, absent = no Twist / 2 Twists. */
export interface TwistSettings {
  twist?: number;
  twists?: number;
}

/**
 * The smooth twisting path one branch or Stem follows while it grows, and the Sections it is built
 * with (ADR 0015). Without Twist it changes nothing: the original Sections, every Section takes its
 * Bend jitter, and {@link steer} returns the course itself.
 */
export interface TwistPath {
  /** Sections to build: max(Sections, 3 × Twists) with Twist > 0, else the Sections given. */
  readonly sections: number;
  /**
   * The original Section whose Bend jitter is applied at built Section `n` (0 .. sections − 1), or −1
   * for an in-between Section that only follows the smooth path. Each original Section is returned
   * exactly once, in order, so Bend draws as many random numbers as without Twist.
   */
  bendSection(n: number): number;
  /**
   * The direction to grow in at fraction `u` (0..1) of the length: the unit `course` (where the
   * branch heads without Twist: its start, Gravity and Bend) swung away by the Twist of that turn.
   * Each turn swings out to `twist` × 45° and back to the course at a steady rate, so the path has no
   * kinks: its direction never jumps, also where one turn hands over to the next.
   */
  steer(course: Vec3, u: number): Vec3;
}

/** The Sections a branch or Stem with these Twist settings is built with: max(`sections`, 3 × Twists) when twisted (ADR 0015). */
export function twistedSections(sections: number, settings: TwistSettings): number {
  return (settings.twist ?? 0) > 0 ? Math.max(sections, SECTIONS_PER_TURN * (settings.twists ?? DEFAULT_TWISTS)) : sections;
}

/**
 * The Twist of one branch or Stem built with `sections` Sections, starting in the unit direction
 * `start`. `random` must be the branch's own Twist stream (ADR 0003: never a stream today's draws
 * use); it picks the direction of every turn around the branch's axis, each turn roughly opposite
 * the last so the path snakes.
 */
export function twistPath(settings: TwistSettings, sections: number, start: Vec3, random: Random): TwistPath {
  const twist = settings.twist ?? 0;
  if (twist <= 0) return { sections, bendSection: (n) => n, steer: (course) => course };

  const turns = settings.twists ?? DEFAULT_TWISTS;
  const built = twistedSections(sections, settings);
  const swing = twist * SWING;
  const across = perpendicular(start);
  const other = cross(start, across);
  const sides: Vec3[] = [];
  let azimuth = random.range(0, Math.PI * 2);
  for (let j = 0; j < turns; j++) {
    if (j > 0) azimuth += Math.PI + random.range(-Math.PI / 2, Math.PI / 2);
    sides.push(add(scale(across, cos(azimuth)), scale(other, sin(azimuth))));
  }

  return {
    sections: built,
    bendSection: (n) => {
      // Original Section j starts at fraction j / sections: its jitter goes on the first built Section there.
      const j = Math.floor((n * sections) / built);
      return Math.ceil((j * built) / sections) === n ? j : -1;
    },
    steer: (course, u) => {
      const along = Math.min(Math.max(u, 0), 1) * turns;
      const turn = Math.min(Math.floor(along), turns - 1);
      // Out at a steady rate and back (circular arcs): even on 3 Sections per turn no joint turns more than 2/3 of a swing.
      const angle = swing * (1 - Math.abs(2 * (along - turn) - 1));
      const side = sub(sides[turn]!, scale(course, dot(sides[turn]!, course)));
      const size = length(side);
      if (size < 1e-9) return course;
      return normalize(add(scale(course, cos(angle)), scale(side, sin(angle) / size)));
    },
  };
}
