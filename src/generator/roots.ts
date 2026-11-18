import { cos, hypot3, pow, sin } from '../math';
import type { RootsDefinition, TreeDefinition } from '../definition';
import type { Random } from '../random';
import { pathLength } from './frames';
import type { SkeletonBranch, SkeletonRoot, Vec3 } from './types';

const DEG = Math.PI / 180;
/** Sections along a Root while `roots.sections` is absent. */
export const ROOT_SECTIONS = 4;
/** Seed range of each Root's place around its Stem: ± this fraction of the gap between Roots. */
const ROOT_JITTER = 0.25;
/** Where a Root starts: this fraction of the trunk radius out from the Stem's centre, inside the Root Flare. */
const ROOT_START_OUT = 0.5;
/** ... and this many of the Root's own radii above the ground (it sits on the ground there), so its top blends into the flare. */
const ROOT_START_UP = 1;
/** How far `bend` = 1 turns a Root sideways per section (at most), radians. */
const ROOT_BEND_TURN = 0.5;
/** A Root tapers as (1 − t)^this along its length (t = 0 base .. 1 tip): below 1 it stays thick longer, then comes to a point. */
const ROOT_TAPER = 0.6;
/** A Root's tip ends at least this many of its base radii below the ground (it curves down to get there). */
const ROOT_TIP_DEPTH = 1;

/** Sides around a Root while `roots.sides` is absent: about two thirds of the trunk's. */
export const rootSides = (definition: TreeDefinition): number =>
  definition.roots?.sides ?? Math.max(3, Math.round((definition.trunk.sides * 2) / 3));

/** Where around a Stem its Roots go (see `rootArc`). */
interface RootArc {
  out: readonly [number, number];
  from: number;
  width: number;
}

/**
 * The part of the circle around a Stem its Roots are spread evenly over: azimuths `from` .. `from` +
 * `width` radians, measured from the horizontal unit vector `out` ([x, z]) round towards +z. A single
 * Stem's Roots go all the way round, starting at the Seed's `turn`. Of several Stems (standing in a
 * ring round the origin), each one's Roots cover only the half-circle facing `out`, away from the ring
 * centre, so they don't pile up between the Stems.
 */
function rootArc(definition: TreeDefinition, stem: SkeletonBranch, turn: number): RootArc {
  const [x, , z] = stem.points[0]!.position;
  const away = hypot3(x, 0, z);
  if ((definition.trunk.stems ?? 1) <= 1 || away === 0) return { out: [1, 0], from: turn, width: Math.PI * 2 };
  return { out: [x / away, z / away], from: -Math.PI / 2, width: Math.PI };
}

/** The horizontal unit vector ([x, z]) at `azimuth` in `arc`. */
function toward(arc: RootArc, azimuth: number): [number, number] {
  const [c, s] = [cos(azimuth), sin(azimuth)];
  const [ox, oz] = arc.out;
  return [ox * c - oz * s, oz * c + ox * s];
}

/**
 * Grows the Roots (ADR 0007) of every Stem in `stems` (the Stems left after the Sculpt pass, as
 * they are after it: a deleted Stem has none, a moved one keeps them at its base, a scaled one
 * scales them with its length). Stem `<p>`'s Roots are `<p>/r0`, `<p>/r1`, ...; Root i draws only
 * from `random.fork('roots/<p>/<i>')` and the Stem's turn from `random.fork('roots/<p>')`, so Roots
 * never change the wood, leaves or Fruit, and one Stem's Sculpts never change another's Roots.
 */
export function growRoots(definition: TreeDefinition, stems: SkeletonBranch[], random: Random): SkeletonRoot[] {
  const roots = definition.roots;
  if (!roots) return [];
  return stems.flatMap((stem) => {
    const turn = random.fork(`roots/${stem.path}`).range(0, Math.PI * 2);
    const arc = rootArc(definition, stem, turn);
    return Array.from({ length: roots.count }, (_, i) => {
      const r = random.fork(`roots/${stem.path}/${i}`);
      const azimuth = arc.from + ((i + 0.5 + r.range(-ROOT_JITTER, ROOT_JITTER)) / roots.count) * arc.width;
      return growRoot(`${stem.path}/r${i}`, stem, roots, arc, azimuth, r);
    });
  });
}

/**
 * One Root: from just inside the Stem's Root Flare, slightly above the Stem's base (the ground), it runs out towards
 * `azimuth` (in `arc`) and down at `angle`, turns sideways by up to `bend` per section, and tapers to a point.
 * If the dive alone would not take its tip below the ground, it curves down (more towards the tip) until it does.
 */
function growRoot(path: string, stem: SkeletonBranch, roots: RootsDefinition, arc: RootArc, azimuth: number, r: Random): SkeletonRoot {
  const base = stem.points[0]!;
  const sections = roots.sections ?? ROOT_SECTIONS;
  const length = pathLength(stem) * roots.length * (1 + r.range(-roots.lengthVariation, roots.lengthVariation));
  const radius = base.radius * roots.radius;
  const step = length / sections;
  const pitch = roots.angle * DEG;

  const [outX, outZ] = toward(arc, azimuth);
  let heading = azimuth;
  let position: Vec3 = [
    base.position[0] + outX * base.radius * ROOT_START_OUT,
    base.position[1] + radius * ROOT_START_UP,
    base.position[2] + outZ * base.radius * ROOT_START_OUT,
  ];
  const positions: Vec3[] = [position];
  for (let s = 0; s < sections; s++) {
    const [x, z] = toward(arc, heading);
    position = [position[0] + step * cos(pitch) * x, position[1] - step * sin(pitch), position[2] + step * cos(pitch) * z];
    positions.push(position);
    heading += r.range(-1, 1) * roots.bend * ROOT_BEND_TURN;
  }

  const drop = Math.max(0, positions[sections]![1] + ROOT_TIP_DEPTH * radius);
  const points = positions.map(([x, y, z], s) => {
    const t = s / sections;
    return { position: [x, y - drop * t * t, z] as Vec3, radius: radius * pow(1 - t, ROOT_TAPER) };
  });
  const direction: Vec3 = [cos(pitch) * outX, -sin(pitch), cos(pitch) * outZ];
  return { path, parent: stem.path, level: 0, attach: 0, direction, points };
}
