import type { SkeletonBranch, Vec3 } from './types';

/**
 * The Crown Volume (GLOSSARY): one smooth, axis-aligned ellipsoid around all leaves of the fully grown
 * tree, in tree space (before Growth and Wind). Plain numbers, so it can go into glTF extras unchanged.
 * A point `p` is inside when `crownDistance(crown, p) <= 1`.
 */
export interface CrownVolume {
  /** Centre of the ellipsoid, tree space (metres). */
  center: Vec3;
  /** Half axes along x, y and z (metres, > 0). */
  radii: Vec3;
}

/** Axes of the ellipsoid. */
const D = 3;
/** Stop when no point is further out than (1 + TOLERANCE) x the ellipsoid of the current weights. */
const TOLERANCE = 1e-2;
const MAX_STEPS = 400;
/** No axis is flatter than this fraction of the largest one (a single flat leaf card still has a volume). */
const MIN_FLATNESS = 1e-3;
/** The Volume of a tree with no leaves and no branches (every Stem Sculpted away). */
const EMPTY: CrownVolume = { center: [0, 0, 0], radii: [1, 1, 1] };

/**
 * How far `p` sits from the Crown Volume's centre, in units of the ellipsoid:
 * 0 at the centre, 1 on the shell, > 1 outside. (`1 - crownDistance` is how deep a point is in the crown.)
 */
export function crownDistance({ center, radii }: CrownVolume, p: Readonly<Vec3>): number {
  const x = (p[0] - center[0]) / radii[0];
  const y = (p[1] - center[1]) / radii[1];
  const z = (p[2] - center[2]) / radii[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * The unit outward normal at `p` of the Crown Volume's ellipsoid through `p` (the shell scaled to pass
 * through it), i.e. the normalized gradient `(p - center) / radii²`. At the centre itself: straight up.
 */
export function crownNormal({ center, radii }: CrownVolume, p: Readonly<Vec3>): Vec3 {
  const x = (p[0] - center[0]) / (radii[0] * radii[0]);
  const y = (p[1] - center[1]) / (radii[1] * radii[1]);
  const z = (p[2] - center[2]) / (radii[2] * radii[2]);
  const length = Math.sqrt(x * x + y * y + z * z);
  return length > 0 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/**
 * Fits the Crown Volume to the leaf vertex positions of the fully grown tree. A tree without leaves gets
 * a Volume around its branches (centre lines, Roots excluded).
 */
export function crownVolume(leafPositions: Float32Array, branches: readonly SkeletonBranch[]): CrownVolume {
  if (leafPositions.length > 0) return fitEllipsoid(leafPositions);
  const points = branches.flatMap((b) => b.points.map((p) => p.position));
  return points.length > 0 ? fitEllipsoid(Float64Array.from(points.flat())) : { center: [...EMPTY.center], radii: [...EMPTY.radii] };
}

/**
 * The smallest axis-aligned ellipsoid around `positions` (x, y, z triples), close to minimum volume.
 *
 * Frank-Wolfe on the dual (as in Khachiyan's algorithm, restricted to axis-aligned ellipsoids): weights
 * on the points give a weighted mean `m` and per-axis variance `v`, and the ellipsoid `sum (p - m)² / (3v)
 * <= 1`. Each step moves weight to the point furthest outside, or off the weighted point furthest inside
 * (an away step), by an exact line search on `sum log v`.
 * Converged, the furthest point lies on the shell; the ellipsoid is then scaled to contain every point
 * exactly. Only + - * / and sqrt, no randomness: the same numbers on every machine.
 */
function fitEllipsoid(positions: ArrayLike<number>): CrownVolume {
  const n = positions.length / D;
  // Start from the outermost point along each axis (a core set); the steps add the points that matter.
  const u = new Float64Array(n);
  const core = new Set<number>();
  for (let i = 0; i < D; i++) {
    let lo = 0;
    let hi = 0;
    for (let j = 1; j < n; j++) {
      if (positions[j * D + i]! < positions[lo * D + i]!) lo = j;
      if (positions[j * D + i]! > positions[hi * D + i]!) hi = j;
    }
    core.add(lo).add(hi);
  }
  for (const j of core) u[j] = 1 / core.size;
  const m = [0, 0, 0];
  const q = [0, 0, 0]; // weighted mean of p²
  const v = [0, 0, 0];
  const p = [0, 0, 0];
  const at = (j: number) => {
    p[0] = positions[j * D]!;
    p[1] = positions[j * D + 1]!;
    p[2] = positions[j * D + 2]!;
    return p;
  };
  for (const j of core) {
    at(j);
    for (let i = 0; i < D; i++) {
      m[i]! += u[j]! * p[i]!;
      q[i]! += u[j]! * p[i]! * p[i]!;
    }
  }
  // A floor on each axis's variance, relative to the largest, keeps a flat point set fittable.
  const floorOf = () => MIN_FLATNESS * MIN_FLATNESS * Math.max(q[0]! - m[0]! * m[0]!, q[1]! - m[1]! * m[1]!, q[2]! - m[2]! * m[2]!, 1e-12);
  let floor = floorOf();
  const variances = () => {
    for (let i = 0; i < D; i++) v[i] = Math.max(q[i]! - m[i]! * m[i]!, floor);
  };
  /**
   * Scores every point (its squared distance in units of sqrt(v) per axis): the furthest point of all,
   * and the nearest point that carries weight. Returns [furthest, its score, nearest, its score].
   */
  const extremes = (): [number, number, number, number] => {
    const [m0, m1, m2] = m as [number, number, number];
    const w0 = 1 / v[0]!;
    const w1 = 1 / v[1]!;
    const w2 = 1 / v[2]!;
    let far = 0;
    let farScore = -1;
    let near = -1;
    let nearScore = Infinity;
    for (let j = 0, o = 0; j < n; j++, o += D) {
      const x = positions[o]! - m0;
      const y = positions[o + 1]! - m1;
      const z = positions[o + 2]! - m2;
      const score = x * x * w0 + y * y * w1 + z * z * w2;
      if (score > farScore) {
        farScore = score;
        far = j;
      }
      if (score < nearScore && u[j]! > 0) {
        nearScore = score;
        near = j;
      }
    }
    return [far, farScore, near, nearScore];
  };

  variances();
  let [far, score, near, nearScore] = extremes();
  for (let step = 0; step < MAX_STEPS && score > D * (1 + TOLERANCE); step++) {
    // Towards the furthest point, or (an away step) weight off the nearest weighted point, whichever is
    // further from optimal: away steps drop inner points and make the fit converge fast.
    const away = D - nearScore > score - D && u[near]! < 1;
    const j = away ? near : far;
    at(j);
    // The furthest an away step can go: all of the point's weight.
    const drop = -u[j]! / (1 - u[j]!);
    const a = away ? lineSearch(m, q, p, floor, drop, 0) : lineSearch(m, q, p, floor, 0, 1);
    const weight = a === drop ? 0 : (1 - a) * u[j]! + a;
    for (let k = 0; k < n; k++) u[k]! *= 1 - a;
    u[j] = weight;
    for (let i = 0; i < D; i++) {
      m[i] = (1 - a) * m[i]! + a * p[i]!;
      q[i] = (1 - a) * q[i]! + a * p[i]! * p[i]!;
    }
    floor = floorOf();
    variances();
    [far, score, near, nearScore] = extremes();
  }
  // Scale so the furthest point lies exactly on the shell: every point is inside.
  return {
    center: [m[0]!, m[1]!, m[2]!],
    radii: [Math.sqrt(v[0]! * score), Math.sqrt(v[1]! * score), Math.sqrt(v[2]! * score)],
  };
}

/**
 * The step `a` in `lo..hi` towards point `p` (away from it when negative) that maximizes `sum log v(a)`,
 * where moving weight `a` to `p` gives `v(a) = (1-a) q + a p² - ((1-a) m + a p)²`. Concave in `a`, so its
 * derivative `sum v'(a) / v(a)` falls through 0 at most once: bisect for it.
 */
function lineSearch(m: number[], q: number[], p: number[], floor: number, lo: number, hi: number): number {
  const slope = (a: number) => {
    let s = 0;
    for (let i = 0; i < D; i++) {
      const mean = (1 - a) * m[i]! + a * p[i]!;
      const variance = Math.max((1 - a) * q[i]! + a * p[i]! * p[i]! - mean * mean, floor);
      s += (p[i]! * p[i]! - q[i]! - 2 * mean * (p[i]! - m[i]!)) / variance;
    }
    return s;
  };
  if (slope(lo) <= 0) return lo;
  if (slope(hi) >= 0) return hi;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (slope(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
