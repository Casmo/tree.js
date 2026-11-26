// Leaf Masses (GLOSSARY, ADR 0014): leaf shape 'mass'. The crown's leaves are grouped into a few Leaf
// Masses (k-means over the leaves), and each leaf becomes one alpha-cut spray card inside its mass,
// so the mass reads as one ragged clump. The painted shading bends the cards' normals to their mass
// (`aMass`) and paints the dark-inside to warm-tips gradient from `aPaint`.
import type { VariationDefinition } from '../definition';
import { hypot3, pow, smoothstep as smooth } from '../math';
import { leafSeasonAttribute } from '../season/profile';
import { createRandom, seedRandom, type Random } from '../random';
import { createAttributes, leafPartGrowth, writePart } from './attributes';
import type { GeometryBuffers, LeafGrowth, SkeletonLeaf, Vec3 } from './types';
import { leafSway, NO_SWAY, type PartSway } from './wind';
import { add, cross, dot, normalize, scale, sub } from './vec';

/** One Leaf Mass: an axis-aligned ellipsoid in tree space. */
export interface LeafMass {
  centre: Vec3;
  /** Half axes (metres, > 0). */
  radii: Vec3;
}

/** k-means rounds; the clustering settles well before this on a crown. */
const ROUNDS = 15;
/** A mass reaches about this many standard deviations of its leaves out from its centre. */
const SPREAD = 2;
/** Where a leaf sits along its card, as a fraction of its size: the card's centre. */
const LEAF_CENTRE = 0.45;

// Card placement (concept D, "medium"): cards fill the outer part of the mass, biased to its shell.
/** How far cards reach inwards from the shell, as a fraction of the mass radius. */
const DEPTH = 0.6;
/** How much the card plane faces out of its mass (0 = random .. 1 = tangent to the shell). */
const OUTWARD = 0.4;
/** How much the card's own bottom-to-top (v) adds to its tip light: a little per-card gradient. */
const CARD_TIP = 0.4;
/**
 * Season timing spread over a mass (#116): a card on the shell is up to this much of the year ahead of one
 * deep inside, so the outside turns first (warm autumn tips over a greener inside) and each mass a little
 * differently ({@link MASS_SEASON}), instead of the whole crown turning one colour at once. Only ever ahead
 * (never behind the tree's own timing), so in early spring no card wraps back into the end of winter.
 */
const SHELL_SEASON = 0.035;
/** Season timing spread between masses (how far ahead of the tree a mass can be), in years. */
const MASS_SEASON = 0.025;
/** Below this (unit) height in its mass a card is often moved up: fewer cards underneath. */
const UNDERSIDE = -0.4;

/**
 * Groups points (leaf centres) into at most `k` Leaf Masses: farthest-point seeds from the highest point,
 * then k-means, with heights counted `layering` times (> 1: wide, flat masses in layers). Returns the masses (empty clusters dropped) and each point's mass index. Deterministic.
 * Radii are {@link SPREAD} standard deviations, at least `minRadius`, the height kept between 0.6 and 1.1
 * times the width (masses read as round clumps, not slivers).
 */
export function clusterLeafMasses(points: readonly Vec3[], k: number, minRadius: number, layering = 1): { masses: LeafMass[]; assign: number[] } {
  if (points.length === 0) return { masses: [], assign: [] };
  const sq = (x: number) => x * x;
  const d2 = (a: Vec3, b: Vec3) => sq(a[0] - b[0]) + sq((a[1] - b[1]) * layering) + sq(a[2] - b[2]);
  const centres: Vec3[] = [[...points.reduce((a, b) => (b[1] > a[1] ? b : a))]];
  while (centres.length < Math.min(k, points.length)) {
    let best = points[0]!;
    let bestD = -1;
    for (const p of points) {
      let d = Infinity;
      for (const c of centres) d = Math.min(d, d2(c, p));
      if (d > bestD) [best, bestD] = [p, d];
    }
    if (bestD <= 0) break;
    centres.push([...best]);
  }
  let assign: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    assign = points.map((p) => nearest(centres, p, d2));
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[assign[i]!]!;
      s[0]! += p[0];
      s[1]! += p[1];
      s[2]! += p[2];
      s[3]! += 1;
    });
    sums.forEach((s, c) => {
      if (s[3]! > 0) centres[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }
  // Drop empty clusters and renumber.
  const used = centres.map((_, c) => assign.includes(c));
  const index = centres.map((_, c) => used.slice(0, c).filter(Boolean).length);
  const masses = centres.flatMap((centre, c) => {
    if (!used[c]) return [];
    const own = points.filter((_, i) => assign[i] === c);
    const sd = [0, 1, 2].map((a) => Math.sqrt(own.reduce((s, p) => s + sq(p[a]! - centre[a]!), 0) / own.length));
    const wide = Math.max(sd[0]!, sd[2]!);
    const rx = Math.max(Math.max(sd[0]!, wide * 0.75) * SPREAD, minRadius);
    const rz = Math.max(Math.max(sd[2]!, wide * 0.75) * SPREAD, minRadius);
    const ry = Math.min(Math.max(sd[1]! * SPREAD, rx * 0.6), rx * 1.1);
    return [{ centre, radii: [rx, Math.max(ry, minRadius), rz] as Vec3 }];
  });
  return { masses, assign: assign.map((c) => index[c]!) };
}

function nearest(centres: readonly Vec3[], p: Vec3, d2: (a: Vec3, b: Vec3) => number): number {
  let best = 0;
  let bestD = d2(centres[0]!, p);
  for (let c = 1; c < centres.length; c++) {
    const d = d2(centres[c]!, p);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/** Distance of `p` from a mass's centre in units of its ellipsoid (1 = on the shell). */
export function massDistance({ centre, radii }: LeafMass, p: Vec3): number {
  return hypot3((p[0] - centre[0]) / radii[0], (p[1] - centre[1]) / radii[1], (p[2] - centre[2]) / radii[2]);
}

/** Unit outward normal at `p` of the mass's ellipsoid through `p` (straight up at the centre). */
export function massNormal({ centre, radii }: LeafMass, p: Vec3): Vec3 {
  const g: Vec3 = [(p[0] - centre[0]) / (radii[0] * radii[0]), (p[1] - centre[1]) / (radii[1] * radii[1]), (p[2] - centre[2]) / (radii[2] * radii[2])];
  return dot(g, g) > 1e-12 ? normalize(g) : [0, 1, 0];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The crown the masses make up: its height span and its (horizontal) centre and reach. */
interface MassCrown {
  bottom: number;
  top: number;
  cx: number;
  cz: number;
  reach: number;
}

function massCrown(masses: readonly LeafMass[]): MassCrown {
  let bottom = Infinity;
  let top = -Infinity;
  let cx = 0;
  let cz = 0;
  for (const m of masses) {
    bottom = Math.min(bottom, m.centre[1] - m.radii[1]);
    top = Math.max(top, m.centre[1] + m.radii[1]);
    cx += m.centre[0] / masses.length;
    cz += m.centre[2] / masses.length;
  }
  let reach = 1e-6;
  for (const m of masses) reach = Math.max(reach, hypot3(m.centre[0] - cx, 0, m.centre[2] - cz) + Math.max(m.radii[0], m.radii[2]));
  return { bottom, top: Math.max(top, bottom + 1e-6), cx, cz, reach };
}

/**
 * How buried a point is (0 open .. 1 hidden), painted rather than lit: inside or near other masses,
 * near the trunk in the lower crown, and low in the crown.
 */
function occlusionAt(p: Vec3, masses: readonly LeafMass[], self: number, crown: MassCrown): number {
  let occ = 0;
  masses.forEach((m, i) => {
    if (i !== self) occ += smooth(1.35, 0.7, massDistance(m, p)) * 0.55;
  });
  const axis = hypot3(p[0] - crown.cx, 0, p[2] - crown.cz) / crown.reach;
  occ += smooth(0.75, 0.1, axis) * 0.35 * smooth(crown.top, crown.bottom, p[1]);
  occ += smooth((crown.top + crown.bottom) / 2, crown.bottom, p[1]) * 0.3;
  return clamp01(occ);
}

/** A random vector with each component in ±`spread` (per axis). */
const jitter = (r: Random, x: number, y0: number, y1: number, z: number): Vec3 => [r.range(-x, x), r.range(y0, y1), r.range(-z, z)];

/**
 * Leaf geometry for `shape: 'mass'`: the leaves grouped into `grouping.count` Leaf Masses (heights counted
 * `grouping.layering` times, see {@link clusterLeafMasses}), each leaf one square
 * spray card (UVs 0..1, stem at v = 0) inside its mass, towards the side of the mass the leaf is on,
 * between the shell and {@link DEPTH} inwards, its plane partly facing out and its tip out and up.
 * Each card keeps its leaf's tint, Growth window and Season timing; it sprouts and flutters about its own
 * base (`aOrigin`), and sways with its whole mass (the mean branch sway of the mass's leaves).
 * Besides the usual part attributes the vertices carry:
 * - `aMass` (vec3): the outward normal of the mass's ellipsoid there (the painted shading bends to it);
 * - `aPaint` (vec4): x = height in the crown (0 bottom .. 1 top), y = how buried (0 open .. 1 hidden),
 *   z = tip light (0 deep in the mass .. 1 at a card tip on the shell), w = a random number per mass.
 * The geometry's own normals are the card normals.
 */
export function massLeafGeometry(
  leaves: SkeletonLeaf[],
  grouping: { count: number; layering: number },
  level: number,
  seed: number,
  variation: Pick<VariationDefinition, 'season'> = { season: 0 },
  growth: LeafGrowth[] = [],
  branchSway: ReadonlyMap<string, PartSway> = new Map(),
): GeometryBuffers {
  const n = leaves.length;
  const positions = new Float32Array(n * 4 * 3);
  const normals = new Float32Array(n * 4 * 3);
  const uvs = new Float32Array(n * 4 * 2);
  const colors = new Float32Array(n * 4 * 3);
  const indices = new Uint32Array(n * 6);
  const attributes = createAttributes(n * 4, true);
  const aMass = new Float32Array(n * 4 * 3);
  const aPaint = new Float32Array(n * 4 * 4);
  attributes.aMass = { array: aMass, itemSize: 3 };
  attributes.aPaint = { array: aPaint, itemSize: 4 };
  if (n === 0) return { positions, normals, uvs, colors, indices, attributes };

  const centres = leaves.map((leaf) => add(leaf.position, scale(leaf.direction, leaf.size * LEAF_CENTRE)));
  const meanSize = leaves.reduce((s, leaf) => s + leaf.size, 0) / n;
  const { masses, assign } = clusterLeafMasses(centres, grouping.count, meanSize * 0.5, grouping.layering);
  const crown = massCrown(masses);
  const massRandom = masses.map((_, m) => seedRandom(seed, `mass/${m}`));
  // Each mass sways as one (the mean branch sway of its leaves): its cards no longer sit on their own
  // twigs, and different sways inside one clump would pull it apart in Wind and Wind Bursts (#116).
  const leafSways = leaves.map((leaf) => leafSway(branchSway.get(leaf.branch) ?? NO_SWAY, leaf.attach));
  const massSway = masses.map((_, m) => {
    const own = leafSways.filter((_, l) => assign[l] === m);
    return { base: own.reduce((sum, sway) => sum + sway.base, 0) / Math.max(own.length, 1), gain: 0, flutter: true };
  });
  const random = createRandom(seed).fork('masses');
  const cornerUvs = [0, 0, 1, 0, 1, 1, 0, 1];

  leaves.forEach((leaf, l) => {
    const r = random.fork(leaf.id);
    const m = assign[l]!;
    const mass = masses[m]!;
    // Direction in the mass towards its leaf (in units of the ellipsoid), loosened, fewer underneath.
    const unit: Vec3 = [0, 1, 2].map((a) => (centres[l]![a]! - mass.centre[a]!) / mass.radii[a]!) as Vec3;
    let d = normalize(add(dot(unit, unit) > 1e-8 ? normalize(unit) : [0, 1, 0], jitter(r, 0.6, -0.6, 0.6, 0.6)));
    if (d[1] < UNDERSIDE && r.next() < 0.6) d = normalize([d[0], -d[1] * 0.5, d[2]]);
    const radius = 1 - DEPTH * pow(r.next(), 0.6);
    const p: Vec3 = [0, 1, 2].map((a) => mass.centre[a]! + d[a]! * mass.radii[a]! * radius) as Vec3;
    const outward = massNormal(mass, p);
    // The card plane: partly facing out of the mass, partly random.
    const plane = normalize(add(scale(outward, OUTWARD), scale(jitter(r, 1, -0.6, 1, 1), 1 - OUTWARD * 0.6)));
    // The tip: out and up, in the card plane.
    let tip = add(add(outward, [0, 0.6, 0]), jitter(r, 0.8, -0.4, 0.4, 0.8));
    tip = sub(tip, scale(plane, dot(tip, plane)));
    tip = dot(tip, tip) > 1e-8 ? normalize(tip) : normalize(cross(plane, [1, 0, 0]));
    const side = cross(tip, plane); // (side, tip) span the card; side x tip = plane, so the front faces `plane`
    const s = leaf.size;
    const base = sub(p, scale(tip, s * 0.35));
    const corners: Vec3[] = [
      sub(base, scale(side, s / 2)),
      add(base, scale(side, s / 2)),
      add(add(base, scale(side, s / 2)), scale(tip, s)),
      add(sub(base, scale(side, s / 2)), scale(tip, s)),
    ];
    const depthLight = clamp01(massDistance(mass, p));
    const season = leafSeasonAttribute(seed, variation, leaf.id);
    const part = {
      level,
      attach: leaf.attach,
      random: seedRandom(seed, leaf.id),
      origin: base,
      season: { ...season, shift: season.shift + clamp01((depthLight - (1 - DEPTH)) / DEPTH) * SHELL_SEASON + massRandom[m]! * MASS_SEASON },
      ...leafPartGrowth(growth[l], base),
      sway: massSway[m]!,
    };
    corners.forEach((q, c) => {
      const v = l * 4 + c;
      const along = cornerUvs[c * 2 + 1]!;
      positions.set(q, v * 3);
      normals.set(plane, v * 3);
      uvs.set([cornerUvs[c * 2]!, along], v * 2);
      colors.set(leaf.tint, v * 3);
      writePart(attributes, v, part, along);
      aMass.set(massNormal(mass, q), v * 3);
      aPaint.set(
        [
          q[1], // height in the crown: filled in below, once the crown's span is known
          clamp01(occlusionAt(q, masses, m, crown) + (1 - depthLight) * 0.6),
          depthLight * (1 - CARD_TIP) + along * CARD_TIP,
          massRandom[m]!,
        ],
        v * 4,
      );
    });
    const v0 = l * 4;
    indices.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], l * 6);
  });
  let bottom = Infinity;
  let top = -Infinity;
  for (let v = 0; v < n * 4; v++) [bottom, top] = [Math.min(bottom, aPaint[v * 4]!), Math.max(top, aPaint[v * 4]!)];
  for (let v = 0; v < n * 4; v++) aPaint[v * 4] = (aPaint[v * 4]! - bottom) / Math.max(top - bottom, 1e-6);
  return { positions, normals, uvs, colors, indices, attributes };
}
