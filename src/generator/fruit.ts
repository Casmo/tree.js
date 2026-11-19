import { cos, sin } from '../math';
import type { FruitType, TreeDefinition, VariationDefinition } from '../definition';
import { fruitSeasonAttribute } from '../season/profile';
import type { Random } from '../random';
import { seedRandom } from '../random';
import { createAttributes } from './attributes';
import { branchFrames, sampleBranch } from './frames';
import { clumpTemplate, orient, solidGeometry, type SolidTemplate } from './leaf-shapes';
import type { GeometryBuffers, GrowthWindow, SkeletonBranch, SkeletonFruit, Vec3 } from './types';
import { NO_SWAY, type PartSway } from './wind';
import { add, cross, dot, length, lerp, normalize, perpendicular, scale } from './vec';

const DEG = Math.PI / 180;
/** Angle between twig and Fruit when it does not hang (`hang` 0), degrees. */
const FRUIT_TILT = 60;
/** Fruit sits on the outer part of its twig: from this fraction of the twig length to its tip. */
const FRUIT_START = 0.3;
/** Fruit starts to grow no earlier than this Growth (it only shows on a fully grown tree) ... */
const FRUIT_GROWTH_START = 0.9;
/** ... plus up to this much per Fruit (from the Seed). */
const FRUIT_GROWTH_JITTER = 0.05;

/**
 * Places Fruit on the outermost branches (the trunk if there are no branch levels), `fruit.count`
 * per branch (a fraction = a chance of one more). `random` is the Generator's `fork('fruit')`: each Fruit draws from its own
 * `random.fork(fruitId)`, so Fruit never shifts the branches or leaves (ADR 0006).
 */
export function placeFruit(definition: TreeDefinition, branches: SkeletonBranch[], random: Random): SkeletonFruit[] {
  const { fruit } = definition;
  if (!fruit || fruit.count === 0) return [];
  const outermost = definition.branches.length;
  const half = definition.variation.color / 2;
  const tintRandom = random.fork('tint');
  const treeTint = [0, 1, 2].map(() => tintRandom.range(-half, half));
  const tilt = FRUIT_TILT * DEG;
  const down: Vec3 = [0, -1, 0];

  // A fractional count is a chance of one more Fruit per twig, drawn from the twig's own fork (so a
  // higher chance keeps the Fruit a lower one had, and whole counts draw nothing extra).
  const whole = Math.floor(fruit.count);
  const chance = fruit.count - whole;
  const out: SkeletonFruit[] = [];
  for (const branch of branches) {
    if (branch.level !== outermost) continue;
    const count = whole + (chance > 0 && random.fork(`${branch.path}/chance`).next() < chance ? 1 : 0);
    if (count === 0) continue;
    const frames = branchFrames(branch);
    for (let i = 0; i < count; i++) {
      const id = `${branch.path}/${i}`;
      const r = random.fork(id);
      const t = FRUIT_START + ((1 - FRUIT_START) * (i + r.range(0.1, 0.9))) / count;
      const at = sampleBranch(branch, frames, t);
      const azimuth = r.range(0, Math.PI * 2);
      const across = add(scale(at.normal, cos(azimuth)), scale(at.binormal, sin(azimuth)));
      const outward = normalize(add(scale(at.tangent, cos(tilt)), scale(across, sin(tilt))));
      const hanging = lerp(outward, down, fruit.hang);
      const direction = length(hanging) > 1e-3 ? normalize(hanging) : across;
      const side0 = cross(direction, [0, 1, 0]);
      const normal = dot(side0, side0) > 1e-6 ? normalize(cross(normalize(side0), direction)) : perpendicular(direction);
      const size = fruit.size * (1 + r.range(-fruit.sizeVariation, fruit.sizeVariation));
      const brightness = r.range(-half, half);
      const tint = treeTint.map((c) => 1 + c + brightness) as Vec3;
      out.push({ id, branch: branch.path, index: i, attach: t, position: at.position, direction, normal, size, tint });
    }
  }
  return out;
}

/**
 * When each Fruit grows: only at the very end of Growth (from about {@link FRUIT_GROWTH_START},
 * never before its twig is fully grown), so a sapling bears none. Computed apart from the other
 * parts' timing, so Fruit never shifts the Growth of wood or leaves.
 */
export function fruitGrowth(seed: number, fruit: SkeletonFruit[], twigGrowth: ReadonlyMap<string, GrowthWindow>): GrowthWindow[] {
  return fruit.map((f) => {
    const from = FRUIT_GROWTH_START + seedRandom(seed, `growth/fruit/${f.id}`) * FRUIT_GROWTH_JITTER;
    return { start: Math.min(Math.max(from, twigGrowth.get(f.branch)?.end ?? 0), 1), end: 1 };
  });
}

/**
 * Fruit geometry: one small solid per Fruit from its Fruit Type's template, hanging from its
 * attachment point. Vertex colours carry the Seed's tint; `aSeason` = (timing shift, fruit rank, 0);
 * it sways with its twig at the attachment point (no leaf flutter).
 */
export function fruitGeometry(
  fruit: SkeletonFruit[],
  { type, sides }: { type: FruitType; sides?: number | undefined },
  level: number,
  seed: number,
  variation: Pick<VariationDefinition, 'season'>,
  growth: GrowthWindow[],
  branchSway: ReadonlyMap<string, PartSway>,
): GeometryBuffers {
  if (fruit.length === 0) return emptyGeometry();
  return solidGeometry(fruitTemplate(type, sides), fruit, (f, i) => {
    const twig = branchSway.get(f.branch) ?? NO_SWAY;
    return {
      level,
      attach: f.attach,
      random: seedRandom(seed, `fruit/${f.id}`),
      origin: f.position,
      season: fruitSeasonAttribute(seed, variation, f.id),
      growth: growth[i] ?? { start: 0, end: 0 },
      sway: { base: twig.base + twig.gain * f.attach, gain: 0, flutter: false },
    };
  });
}

/** Empty geometry buffers (a tree without Fruit). */
export function emptyGeometry(): GeometryBuffers {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    attributes: createAttributes(0),
  };
}

// --- Fruit Type templates: closed solids in units of the Fruit size, z = 0 at the twig .. 1 at the far end.

/** A solid of revolution around z: rings of `sides` vertices at (z, radius), closed by a point at each end. */
function lathe(profile: [number, number][], sides: number, ends: [number, number], twist = 0): SolidTemplate {
  const positions: Vec3[] = [[0, 0, ends[0]], [0, 0, ends[1]]];
  const normals: Vec3[] = [[0, 0, -1], [0, 0, 1]];
  const triangles: [number, number, number][] = [];
  profile.forEach(([z, r], ring) => {
    for (let s = 0; s < sides; s++) {
      const angle = ((s + ring * twist) / sides) * Math.PI * 2;
      const radial: Vec3 = [cos(angle), sin(angle), 0];
      positions.push([radial[0] * r, radial[1] * r, z]);
      normals.push(radial);
    }
  });
  const at = (ring: number, s: number) => 2 + ring * sides + (s % sides);
  for (let s = 0; s < sides; s++) {
    triangles.push([0, at(0, s), at(0, s + 1)]);
    for (let ring = 0; ring < profile.length - 1; ring++) {
      triangles.push([at(ring, s), at(ring + 1, s), at(ring + 1, s + 1)], [at(ring, s), at(ring + 1, s + 1), at(ring, s + 1)]);
    }
    triangles.push([1, at(profile.length - 1, s + 1), at(profile.length - 1, s)]);
  }
  return orient({ positions, normals, triangles });
}

/** Chestnut husk: a ball (icosphere, diameter 0.8) with a spike at each of the icosahedron's 12 corners. */
function nutTemplate(): SolidTemplate {
  const ico = clumpTemplate();
  const centre: Vec3 = [0, 0, 0.5];
  const directions = ico.positions.map((p) => normalize([p[0], p[1], p[2] - 0.5]));
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let index = midpoints.get(key);
    if (index === undefined) {
      index = directions.push(normalize(add(directions[a]!, directions[b]!))) - 1;
      midpoints.set(key, index);
    }
    return index;
  };
  const triangles: [number, number, number][] = ico.triangles.flatMap(([a, b, c]) => {
    const [ab, bc, ca] = [midpoint(a, b), midpoint(b, c), midpoint(c, a)];
    return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][];
  });
  // The first 12 directions are the icosahedron corners: the spikes.
  const positions = directions.map((d, i) => add(centre, scale(d, i < 12 ? 0.5 : 0.36)));
  return orient({ positions, normals: directions, triangles });
}

/** Each Fruit Type's smooth profile (z, radius) along its axis, and its end points. */
const PROFILES: Record<Exclude<FruitType, 'nut'>, { rings: [number, number][]; ends: [number, number]; twist?: number }> = {
  round: { rings: [[0.04, 0.22], [0.2, 0.44], [0.45, 0.5], [0.7, 0.45], [0.9, 0.28]], ends: [0.1, 1] },
  pear: { rings: [[0.08, 0.1], [0.25, 0.18], [0.45, 0.3], [0.65, 0.4], [0.82, 0.38], [0.95, 0.2]], ends: [0, 1] },
  // Staggered rings (half a side per ring) give the cone its scales.
  cone: { rings: [[0.08, 0.2], [0.22, 0.32], [0.38, 0.36], [0.54, 0.34], [0.7, 0.28], [0.86, 0.18]], ends: [0, 1], twist: 0.5 },
  berry: { rings: [[0.15, 0.36], [0.5, 0.5], [0.85, 0.36]], ends: [0, 1] },
};

/** Coarse profiles (low detail): two rings (berry one), a few flat facets. */
const COARSE: Record<Exclude<FruitType, 'nut'>, [number, number][]> = {
  round: [[0.28, 0.48], [0.72, 0.42]],
  pear: [[0.3, 0.2], [0.75, 0.4]],
  cone: [[0.25, 0.32], [0.65, 0.28]],
  berry: [[0.5, 0.5]],
};

/** At or below this many sides, Fruit uses the coarse profiles (and the nut a plain icosahedron). */
export const COARSE_SIDES = 5;

/** The default templates: each Fruit Type's own sides (Definitions without `fruit.sides`). */
const DEFAULT_SIDES: Record<Exclude<FruitType, 'nut'>, number> = { round: 8, pear: 8, cone: 7, berry: 6 };

const templates = new Map<string, SolidTemplate>();

/** The template of a Fruit Type drawn with `sides` faces around (absent = the Type's own detail), cached. */
function fruitTemplate(type: FruitType, sides?: number): SolidTemplate {
  const key = `${type}/${sides ?? ''}`;
  let template = templates.get(key);
  if (!template) {
    const coarse = sides !== undefined && sides <= COARSE_SIDES;
    if (type === 'nut') template = coarse ? coarseNutTemplate() : nutTemplate();
    else {
      const { rings, ends, twist } = PROFILES[type];
      template = lathe(coarse ? COARSE[type] : rings, sides ?? DEFAULT_SIDES[type], ends, twist);
    }
    templates.set(key, template);
  }
  return template;
}

/** Low-detail chestnut husk: an icosahedron (its corners are the spikes). */
function coarseNutTemplate(): SolidTemplate {
  const ico = clumpTemplate();
  const directions = ico.positions.map((p) => normalize([p[0], p[1], p[2] - 0.5]));
  return orient({ positions: directions.map((d) => add([0, 0, 0.5], scale(d, 0.45))), normals: directions, triangles: ico.triangles });
}
