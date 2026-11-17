import type { LeafShape, VariationDefinition } from '../definition';
import { leafSeasonAttribute } from '../season/profile';
import { createAttributes, partRandom, writePart } from './attributes';
import type { GeometryBuffers, GrowthWindow, SkeletonLeaf, Vec3 } from './types';
import { add, cross, dot, normalize, scale, sub } from './vec';

/**
 * A closed solid leaf shape in a leaf's local frame, in units of the leaf size:
 * x = across (side), y = the leaf normal, z = along the leaf direction (0 = attachment, 1 = tip).
 * `normals` are outward unit normals (smooth; a flat-shaded material makes them faceted).
 */
interface SolidTemplate {
  positions: Vec3[];
  normals: Vec3[];
  triangles: [number, number, number][];
}

const GOLDEN = (1 + Math.sqrt(5)) / 2;

/** Low-poly foliage ball: an icosahedron of diameter 1, from the attachment point out along the leaf. */
function clumpTemplate(): SolidTemplate {
  const raw: Vec3[] = [
    [-1, GOLDEN, 0], [1, GOLDEN, 0], [-1, -GOLDEN, 0], [1, -GOLDEN, 0],
    [0, -1, GOLDEN], [0, 1, GOLDEN], [0, -1, -GOLDEN], [0, 1, -GOLDEN],
    [GOLDEN, 0, -1], [GOLDEN, 0, 1], [-GOLDEN, 0, -1], [-GOLDEN, 0, 1],
  ];
  const normals = raw.map((v) => normalize(v));
  const centre: Vec3 = [0, 0, 0.5];
  const triangles: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { positions: normals.map((n) => add(centre, scale(n, 0.5))), normals, triangles };
}

/** Needle tuft: a slim five-sided spindle from the attachment point (z = 0) to the tip (z = 1). */
const NEEDLE_SIDES = 5;
const NEEDLE_RADIUS = 0.28;
const NEEDLE_WAIST = 0.25;
function needleTemplate(): SolidTemplate {
  const positions: Vec3[] = [[0, 0, 0], [0, 0, 1]];
  const normals: Vec3[] = [[0, 0, -1], [0, 0, 1]];
  const triangles: [number, number, number][] = [];
  for (let s = 0; s < NEEDLE_SIDES; s++) {
    const angle = (s / NEEDLE_SIDES) * Math.PI * 2;
    const radial: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
    positions.push([radial[0] * NEEDLE_RADIUS, radial[1] * NEEDLE_RADIUS, NEEDLE_WAIST]);
    normals.push(radial);
    const a = 2 + s;
    const b = 2 + ((s + 1) % NEEDLE_SIDES);
    triangles.push([a, b, 1], [b, a, 0]);
  }
  return { positions, normals, triangles };
}

const TEMPLATES: Record<Exclude<LeafShape, 'card'>, SolidTemplate> = {
  clump: orient(clumpTemplate()),
  needle: orient(needleTemplate()),
};

/** Fixes each triangle's winding so its front face points along its vertex normals (CCW = front). */
function orient(template: SolidTemplate): SolidTemplate {
  const { positions: p, normals: n } = template;
  const triangles = template.triangles.map(([a, b, c]): [number, number, number] => {
    const face = cross(sub(p[b]!, p[a]!), sub(p[c]!, p[a]!));
    return dot(face, add(add(n[a]!, n[b]!), n[c]!)) >= 0 ? [a, b, c] : [a, c, b];
  });
  return { ...template, triangles };
}

/**
 * Leaf geometry for the solid shapes ('clump', 'needle'): one small closed mesh per leaf,
 * placed in the leaf's frame (across, normal, direction) and scaled by its size. Like cards,
 * every vertex carries the leaf's tint as its colour and the leaf's part attributes.
 */
export function solidLeafGeometry(
  leaves: SkeletonLeaf[],
  shape: Exclude<LeafShape, 'card'>,
  level: number,
  seed: number,
  variation: Pick<VariationDefinition, 'season'> = { season: 0 },
  growth: GrowthWindow[] = [],
): GeometryBuffers {
  const template = TEMPLATES[shape];
  const n = template.positions.length;
  const positions = new Float32Array(leaves.length * n * 3);
  const normals = new Float32Array(leaves.length * n * 3);
  const uvs = new Float32Array(leaves.length * n * 2);
  const colors = new Float32Array(leaves.length * n * 3);
  const indices = new Uint32Array(leaves.length * template.triangles.length * 3);
  const attributes = createAttributes(leaves.length * n);
  leaves.forEach((leaf, l) => {
    const side = cross(leaf.normal, leaf.direction); // (side, normal, direction) is right-handed, so winding is kept
    const toWorld = ([x, y, z]: Vec3): Vec3 =>
      add(add(scale(side, x), scale(leaf.normal, y)), scale(leaf.direction, z));
    const part = {
      level,
      attach: leaf.attach,
      random: partRandom(seed, leaf.id),
      origin: leaf.position,
      season: leafSeasonAttribute(seed, variation, leaf.id),
      growth: growth[l] ?? { start: 0, end: 0 },
    };
    for (let c = 0; c < n; c++) {
      const v = l * n + c;
      const local = template.positions[c]!;
      positions.set(add(leaf.position, scale(toWorld(local), leaf.size)), v * 3);
      normals.set(normalize(toWorld(template.normals[c]!)), v * 3);
      const along = Math.min(Math.max(local[2], 0), 1);
      uvs.set([local[0] + 0.5, along], v * 2);
      colors.set(leaf.tint, v * 3);
      writePart(attributes, v, part, along);
    }
    template.triangles.forEach((triangle, t) => {
      indices.set(triangle.map((i) => l * n + i), (l * template.triangles.length + t) * 3);
    });
  });
  return { positions, normals, uvs, colors, indices, attributes };
}
