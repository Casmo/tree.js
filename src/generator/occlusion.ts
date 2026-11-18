import { crownDistance, type CrownVolume } from './crown';
import type { GeometryBuffers } from './types';

/**
 * Structural Occlusion (GLOSSARY): how open each vertex is to the sky, from the tree's own shape.
 * 0 = fully occluded, 1 = open. A deterministic mix (a product) of two terms, both measured on the fully
 * grown tree with every leaf on it (so it is the same in every Season and at every Growth):
 *
 * - crown depth: how deep the vertex sits inside the Crown Volume (`1 - crownDistance`, 0 at the shell);
 * - leaf cover above: the leaf area above the vertex, from a coarse voxel grid of leaf area, summed
 *   upwards (as a leaf area index) and turned into openness, which falls from 1 towards FLOOR as it grows.
 *
 * No randomness and no ray tracing; only + - * / and sqrt, so the same numbers on every machine.
 * The Definition's `strength` is not used here: the material mixes it in (`aoNode`).
 */

/** Grid cells along the largest extent of the leaves. */
const CELLS = 12;
/** Empty cells around the leaves, so the grid's edge (and the horizontal blur's spill) reads as open sky. */
const PAD = 2;
/** How fast the cover above darkens: openness `FLOOR + (1 - FLOOR) / (1 + COVER × leaf area per ground area above)`. */
const COVER = 0.3;
/** The openness under an endless canopy: light still bounces in from the sides and the ground. */
const FLOOR = 0.3;
/** How much darker the very centre of the Crown Volume is than its shell (before the cover above). */
const DEPTH = 0.4;

/**
 * Adds `aOcclusion` (1 float per vertex) to each of `parts` (wood, leaves, Fruit). A tree without leaves
 * has no crown to hide under: every vertex is open (1).
 */
export function bakeOcclusion(parts: readonly GeometryBuffers[], leaves: GeometryBuffers, crown: CrownVolume): void {
  const cover = leaves.indices.length > 0 ? coverAbove(leaves) : null;
  for (const part of parts) {
    const p = part.positions;
    const array = new Float32Array(p.length / 3);
    if (cover) {
      const point: [number, number, number] = [0, 0, 0];
      for (let v = 0; v < array.length; v++) {
        point[0] = p[v * 3]!;
        point[1] = p[v * 3 + 1]!;
        point[2] = p[v * 3 + 2]!;
        const depth = Math.max(0, 1 - crownDistance(crown, point));
        array[v] = (1 - DEPTH * depth) * (FLOOR + (1 - FLOOR) / (1 + COVER * cover(point)));
      }
    } else {
      array.fill(1);
    }
    part.attributes.aOcclusion = { array, itemSize: 1 };
  }
}

/**
 * The leaf area above a point per unit of ground area (a leaf area index, 0 above the crown), as a
 * function. Leaf triangles are binned by centroid into a grid of cubes, blurred a little sideways (the
 * sky is a hemisphere, not a point overhead), summed from the top down and sampled trilinearly.
 */
function coverAbove(leaves: GeometryBuffers): (p: readonly number[]) => number {
  const p = leaves.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let o = 0; o < p.length; o += 3) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[o + i]!);
      max[i] = Math.max(max[i]!, p[o + i]!);
    }
  }
  const size = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!, 1e-6) / CELLS;
  const origin = min.map((m) => m - PAD * size);
  const [nx, ny, nz] = [0, 1, 2].map((i) => Math.ceil((max[i]! - min[i]!) / size) + 1 + 2 * PAD) as [number, number, number];
  const at = (x: number, y: number, z: number) => (y * nz + z) * nx + x;
  const cell = (value: number, i: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((value - origin[i]!) / size)));

  // Leaf area per cell, in units of a cell's ground area (so a sum over a column is a leaf area index).
  let area = new Float64Array(nx * ny * nz);
  const idx = leaves.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const w = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const cx = u[1]! * w[2]! - u[2]! * w[1]!;
    const cy = u[2]! * w[0]! - u[0]! * w[2]!;
    const cz = u[0]! * w[1]! - u[1]! * w[0]!;
    const triangle = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    const centre = [0, 1, 2].map((i) => (p[a + i]! + p[b + i]! + p[c + i]!) / 3);
    area[at(cell(centre[0]!, 0, nx), cell(centre[1]!, 1, ny), cell(centre[2]!, 2, nz))]! += triangle / (size * size);
  }
  // Blur sideways (1 2 1 along x, then along z).
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const blurred = new Float64Array(area.length);
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const here = area[at(x, y, z)]!;
          const before = x - dx >= 0 && z - dz >= 0 ? area[at(x - dx, y, z - dz)]! : 0;
          const after = x + dx < nx && z + dz < nz ? area[at(x + dx, y, z + dz)]! : 0;
          blurred[at(x, y, z)] = (before + 2 * here + after) / 4;
        }
      }
    }
    area = blurred;
  }
  // Cover at each cell centre: everything above it plus half of its own cell.
  const above = new Float64Array(area.length);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let sum = 0;
      for (let y = ny - 1; y >= 0; y--) {
        const own = area[at(x, y, z)]!;
        above[at(x, y, z)] = sum + own / 2;
        sum += own;
      }
    }
  }
  // Trilinear between cell centres; clamped at the grid's edges (below the grid: the whole column above).
  return (q) => {
    const f = [0, 1, 2].map((i) => (q[i]! - origin[i]!) / size - 0.5);
    const n = [nx, ny, nz];
    const lo: number[] = [];
    const t: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g = Math.min(n[i]! - 1, Math.max(0, f[i]!));
      lo[i] = Math.min(n[i]! - 2, Math.floor(g));
      t[i] = g - lo[i]!;
    }
    let value = 0;
    for (let k = 0; k < 8; k++) {
      const x = lo[0]! + (k & 1);
      const y = lo[1]! + ((k >> 1) & 1);
      const z = lo[2]! + ((k >> 2) & 1);
      const weight = (k & 1 ? t[0]! : 1 - t[0]!) * ((k >> 1) & 1 ? t[1]! : 1 - t[1]!) * ((k >> 2) & 1 ? t[2]! : 1 - t[2]!);
      value += weight * above[at(x, y, z)]!;
    }
    return value;
  };
}
