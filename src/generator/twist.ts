import { cos, sin } from '../math';
import type { TwistSettings } from '../definition';
import type { Random } from '../random';
import type { Vec3 } from './types';
import { add, cross, dot, length, normalize, perpendicular, rotate, scale, sub } from './vec';

/** Twists while `twists` is absent: an S. */
export const DEFAULT_TWISTS = 2;
/** How far `twist` = 1 swings a branch away from its course at every turn, or leans a Corkscrew off it, radians (45°). */
const SWING = Math.PI / 4;
/** Over how many turns a Corkscrew's lean eases in from its start direction (half a turn). */
const EASE_TURNS = 0.5;
/** Sections a twisted branch or Stem needs per turn for the turn to show: 3 for a Snake (ADR 0015), 6 for a Corkscrew's full turn around its course (ADR 0016). */
const SECTIONS_PER_TURN = { snake: 3, corkscrew: 6 } as const;

/**
 * The smooth twisting path one branch or Stem follows while it grows, and the Sections it is built
 * with (ADR 0015, 0016). Without Twist it changes nothing: the original Sections, every Section takes its
 * Bend jitter, {@link steer} returns the course itself and {@link roll} is 0.
 */
export interface TwistPath {
  /** Sections to build: max(Sections, 3 × Twists) for a Snake, 6 × Twists for a Corkscrew, with Twist > 0; else the Sections given. */
  readonly sections: number;
  /**
   * Which way a Corkscrew turns: 1 clockwise seen from its base looking along it (right-handed about
   * its course), −1 counter-clockwise; the Seed's pick when its Spin is Random. 0 for a Snake or without Twist.
   */
  readonly spin: -1 | 0 | 1;
  /**
   * Whether built Section `n` (0 .. sections − 1) takes Bend's jitter: true where an original Section
   * starts, false for an in-between Section that only follows the smooth path. Exactly one built Section
   * per original Section takes it, so Bend draws as many random numbers as without Twist.
   */
  takesBend(n: number): boolean;
  /**
   * The direction to grow in at fraction `u` (0..1) of the length: the unit `course` (where the
   * branch heads without Twist: its start, Gravity and Bend) swung away by the Twist of that turn.
   * Each turn swings out to `twist` × 45° and back to the course at a steady rate, so the path has no
   * kinks: its direction never jumps, also where one turn hands over to the next.
   */
  steer(course: Vec3, u: number): Vec3;
  /**
   * How far a Corkscrew has turned around its course at fraction `u` (0..1) of the length, radians:
   * `spin` × 2π × Twists × `u`, so one full turn per Twists, 0 at the start (its Corkscrew phase, which
   * rolls its frames, ADR 0016). Always 0 for a Snake or without Twist.
   */
  roll(u: number): number;
  /**
   * The unit axis across `start` a Corkscrew's Twist Curve turns its course about (right-handed, by
   * up to Twist Curve × 180°), picked by the Seed; carried onto the course like its Corkscrew side.
   * Drawn also while Twist Curve is 0, so a branch's children can bend the same way (Follow Twist).
   * Null for a Snake or without Twist.
   */
  readonly curveAxis: Vec3 | null;
  /**
   * Where a Corkscrew stands in its turn at fraction `u` of the length, given the unit `course` there (as
   * passed to {@link steer}): what a child with Follow Twist picks up. Null for a Snake or without Twist.
   */
  corkscrewAt(course: Vec3, u: number): CorkscrewPhase | null;
}

/**
 * Where a Corkscrew stands in its turn at one point along a branch or Stem, in world directions: what the
 * branches growing there with Follow Twist pick up (GLOSSARY.md).
 */
export interface CorkscrewPhase {
  /** Its Spin: 1 clockwise seen from its base looking along it, −1 counter-clockwise. */
  readonly spin: -1 | 1;
  /** Unit: where it heads there without the Corkscrew's lean (its course, turned by its Twist Curve). */
  readonly course: Vec3;
  /** Unit, across `course`: the side the Corkscrew leans to there (its phase). */
  readonly side: Vec3;
  /** Unit, across `course`: the axis its Twist Curve turns it about. */
  readonly curveAxis: Vec3;
}

/** `at` with its directions (course, side, curve axis) each turned by `turn`, such as a rotation placing a Stem; the same Spin. */
export function turnCorkscrew(at: CorkscrewPhase, turn: (v: Vec3) => Vec3): CorkscrewPhase {
  return { spin: at.spin, course: turn(at.course), side: turn(at.side), curveAxis: turn(at.curveAxis) };
}

/** A branch's or Stem's {@link CorkscrewPhase} at each fraction (0..1) of its length; null where it has none (Snake, no Twist). */
export type CorkscrewAlong = (u: number) => CorkscrewPhase | null;

/**
 * The Sections a branch or Stem with these Twist settings is built with when twisted: max(`sections`,
 * 3 × Twists) for a Snake (ADR 0015), max(`sections`, 6 × Twists) for a Corkscrew (ADR 0016).
 */
export function twistedSections(sections: number, settings: TwistSettings): number {
  if ((settings.twist ?? 0) <= 0) return sections;
  return Math.max(sections, SECTIONS_PER_TURN[settings.twistStyle ?? 'snake'] * (settings.twists ?? DEFAULT_TWISTS));
}

/**
 * The built Section where original Section `j` of `sections` starts once the branch or Stem is built
 * with `built` (>= `sections`) Sections (ADR 0015): Bend's jitter and the trunk's Bend corners stay there.
 */
export function originalSectionStart(j: number, sections: number, built: number): number {
  return Math.ceil((j * built) / sections);
}

/**
 * The Twist of one branch or Stem built with `sections` Sections, starting in the unit direction
 * `start`. A branch samples {@link TwistPath.steer} at the middle of each Section; a Stem samples its
 * base Section at the very start (so the base grows upright) and the others at their middle.
 * `random` must be the branch's or Stem's own Twist stream (ADR 0003: never a stream today's draws
 * use); it picks the direction of every turn around the branch's axis, each turn roughly opposite
 * the last so the path snakes. A Corkscrew makes the same draws (the first turn's direction is where
 * its phase starts), then one for its Spin, also when the Spin is given, and then one for the axis
 * its Twist Curve turns the course about, also when the Twist Curve is 0 (ADR 0003).
 *
 * `follow` is the parent's {@link CorkscrewPhase} where this branch attaches, given when its level has Follow
 * Twist: a Corkscrew then takes its Spin, starts its phase at its side and bends its Twist Curve about
 * its curve axis, both carried from the parent's course onto `start` (the draws stay the same). A Snake
 * or a branch without Twist ignores it.
 */
export function twistPath(settings: TwistSettings, sections: number, start: Vec3, random: Random, follow?: CorkscrewPhase | null): TwistPath {
  const twist = settings.twist ?? 0;
  if (twist <= 0) return { sections, spin: 0, curveAxis: null, takesBend: () => true, steer: (course) => course, roll: () => 0, corkscrewAt: () => null };

  const turns = settings.twists ?? DEFAULT_TWISTS;
  const builtSections = twistedSections(sections, settings);
  const swing = twist * SWING;
  // Two axes across `start`: each turn's side is picked around the branch in their plane.
  const axisA = perpendicular(start);
  const axisB = cross(start, axisA);
  const sides: Vec3[] = [];
  let azimuth = random.range(0, Math.PI * 2);
  const corkscrewStart = azimuth; // Where a Corkscrew's phase starts around `start`.
  for (let j = 0; j < turns; j++) {
    if (j > 0) azimuth += Math.PI + random.range(-Math.PI / 2, Math.PI / 2);
    sides.push(add(scale(axisA, cos(azimuth)), scale(axisB, sin(azimuth))));
  }

  // Original Section j starts at fraction j / sections: its jitter goes on the first built Section there.
  const takesBend = (n: number) => originalSectionStart(Math.floor((n * sections) / builtSections), sections, builtSections) === n;

  if (settings.twistStyle === 'corkscrew') {
    const picked = random.next() < 0.5 ? 1 : -1;
    let spin: -1 | 1 = settings.spin === 'clockwise' ? 1 : settings.spin === 'counterclockwise' ? -1 : picked;
    const curveAzimuth = random.range(0, Math.PI * 2);
    let curveAxis = add(scale(axisA, cos(curveAzimuth)), scale(axisB, sin(curveAzimuth)));
    // Follow Twist: the parent's Spin, and its Corkscrew side and curve axis carried from its course onto `start`.
    const side = follow && carry(follow.side, follow.course, start);
    const axis = follow && carry(follow.curveAxis, follow.course, start);
    // The Corkscrew's side goes round `start` from `fromA` towards `fromB` (right-handed), starting at angle `phase0`.
    let [fromA, fromB, phase0] = [axisA, axisB, corkscrewStart];
    if (follow && side && axis) {
      spin = follow.spin;
      [fromA, fromB, phase0] = [side, cross(start, side), 0];
      curveAxis = axis;
    }
    const curve = (settings.twistCurve ?? 0) * Math.PI;
    const roll = (u: number) => spin * 2 * Math.PI * turns * Math.min(Math.max(u, 0), 1);
    /** The course at `u` turned by the Twist Curve, the side the Corkscrew leans to there and the curve axis; null where the course turned right round from `start`. */
    const corkscrewAt = (course: Vec3, u: number): CorkscrewPhase | null => {
      // The side it leans to goes round `start` (right-handed for spin 1), carried onto the course by
      // the smallest rotation from `start` to it, so the Corkscrew follows a course that Gravity or Bend turn.
      const phase = phase0 + roll(u);
      let side = carry(add(scale(fromA, cos(phase)), scale(fromB, sin(phase))), start, course);
      if (!side) return null;
      // The Twist Curve turns the course, and the Corkscrew's side with it, about the curve axis carried
      // onto the course: eased in and out over the whole length, so it adds no kinks.
      const axis = carry(curveAxis, start, course)!;
      if (curve > 0) {
        const angle = curve * smoothstep(Math.min(Math.max(u, 0), 1));
        course = rotate(course, axis, angle);
        side = rotate(side, axis, angle);
      }
      return { spin, course, side, curveAxis: axis };
    };
    return {
      sections: builtSections,
      spin,
      curveAxis,
      takesBend,
      roll,
      corkscrewAt,
      steer: (course, u) => {
        const at = corkscrewAt(course, u);
        if (!at) return course;
        const along = Math.min(Math.max(u, 0), 1) * turns;
        const lean = swing * smoothstep(Math.min(along / EASE_TURNS, 1));
        return normalize(add(scale(at.course, cos(lean)), scale(at.side, sin(lean))));
      },
    };
  }

  return {
    sections: builtSections,
    spin: 0,
    curveAxis: null,
    takesBend,
    roll: () => 0,
    corkscrewAt: () => null,
    steer: (course, u) => {
      const along = Math.min(Math.max(u, 0), 1) * turns;
      const turn = Math.min(Math.floor(along), turns - 1);
      // Out at a steady rate and back (circular arcs): sampled mid-Section, even on 3 Sections per turn no joint turns more than 2/3 of a swing.
      const angle = swing * (1 - Math.abs(2 * (along - turn) - 1));
      const side = sub(sides[turn]!, scale(course, dot(sides[turn]!, course)));
      const size = length(side);
      if (size < 1e-9) return course;
      return normalize(add(scale(course, cos(angle)), scale(side, sin(angle) / size)));
    },
  };
}

/** 0 at 0, 1 at 1, with no slope at either end: the Corkscrew's lean and its Twist Curve ease in (and out) without a kink. */
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/**
 * The unit vector `v` (across `from`) turned by the smallest rotation taking unit `from` onto unit
 * `to`, so it lies across `to`; null where `to` is (almost) opposite `from` and there is no such rotation.
 */
function carry(v: Vec3, from: Vec3, to: Vec3): Vec3 | null {
  const c = dot(from, to);
  if (c < -1 + 1e-9) return null;
  const w = cross(from, to);
  return normalize(add(add(scale(v, c), cross(w, v)), scale(w, dot(w, v) / (1 + c))));
}
