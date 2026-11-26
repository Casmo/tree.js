import type { GeometryBuffers } from '../generator';

/**
 * The Growth model, one spec with two backends: `growPositions` (CPU, here) and `growthPosition`
 * (TSL, `./tsl.ts`). Keep them in step. Per vertex, at Growth `g`:
 *
 * 1. thicken: move the vertex towards its part's centre line, keeping `thickness(g)` of its radius
 *    (`aGrowth.z`, along the vertex normal);
 * 2. sprout: scale the part about its base point (`aOrigin`) by `partProgress(g, start, end)`
 *    (`aGrowth.xy`), so a part grows out of a point on its (already grown) parent;
 * 3. size: scale the whole tree about its base (local origin) by `treeScale(g)`.
 *
 * Leaves (the buffers that carry `aTwigGrowth` and `aTwigOrigin`, ADR 0019) don't wait for their twig;
 * they ride on it. Instead of step 2 a leaf is
 *
 * 2a. unfolded about its own attachment point (`aOrigin`) by its size, `leafProgress(g, start, end)`
 *     (its own window, `aGrowth.xy`) times its twig's `partProgress` (the twig's window, `aTwigGrowth`);
 * 2b. carried with its twig's sprout: scaled about the twig's base point (`aTwigOrigin`) by that same
 *     twig progress, so its attachment point stays on the grown twig.
 *
 * Every step is written as `x - offset * (1 - factor)`, so at Growth 1 the positions are exactly
 * the generated ones: a tree at Growth 1 is a normal static tree.
 */

/** Size of the whole tree at Growth 0 (sapling), relative to fully grown. */
export const SAPLING_SCALE = 0.2;
/** Branch thickness at Growth 0, relative to the size-scaled thickness when fully grown. */
export const SAPLING_THICKNESS = 0.4;
/** Smallest window width, so parts with `start == end` (the trunk) are simply grown. */
export const MIN_WINDOW = 1e-5;

export const treeScale = (growth: number): number => SAPLING_SCALE + (1 - SAPLING_SCALE) * growth;
export const thickness = (growth: number): number => SAPLING_THICKNESS + (1 - SAPLING_THICKNESS) * growth;

/** How far one part has sprouted (0 = not yet, 1 = full size), eased; 1 from `end` on. */
export function partProgress(growth: number, start: number, end: number): number {
  const p = Math.min(Math.max((growth - end) / Math.max(end - start, MIN_WINDOW) + 1, 0), 1);
  return p * p * (3 - 2 * p);
}

/**
 * How far one leaf has unfolded by its own leaf curve (0 = not yet, 1 = full size): ease-out
 * `1 - (1 - p)^2` over its window, 1 from `end` on (a zero-width window pops in at `end`).
 */
export function leafProgress(growth: number, start: number, end: number): number {
  const p = Math.min(Math.max((growth - end) / Math.max(end - start, MIN_WINDOW) + 1, 0), 1);
  return 1 - (1 - p) * (1 - p);
}

/** Clamps a Growth value to 0..1 (NaN becomes 1, fully grown). */
export function clampGrowth(growth: number): number {
  return Number.isNaN(growth) ? 1 : Math.min(Math.max(growth, 0), 1);
}

/**
 * Vertex positions of generated geometry at a given Growth, on the CPU (for baking a tree and
 * for tests; at runtime the same model runs in TSL). Returns a new array.
 */
export function growPositions(buffers: GeometryBuffers, growth: number): Float32Array {
  const g = clampGrowth(growth);
  const { positions, normals } = buffers;
  const { aOrigin, aGrowth, aTwigGrowth, aTwigOrigin } = buffers.attributes;
  const out = new Float32Array(positions.length);
  const scale = treeScale(g);
  const thin = 1 - thickness(g);
  for (let v = 0; v < positions.length / 3; v++) {
    const [start, end, radius] = [aGrowth.array[v * 3]!, aGrowth.array[v * 3 + 1]!, aGrowth.array[v * 3 + 2]!];
    // A leaf rides on its twig: unfolds by its leaf curve times the twig's progress, carried by the twig.
    const twig = aTwigGrowth && aTwigOrigin ? partProgress(g, aTwigGrowth.array[v * 2]!, aTwigGrowth.array[v * 2 + 1]!) : 1;
    const shrink = 1 - (aTwigGrowth ? leafProgress(g, start, end) * twig : partProgress(g, start, end));
    for (let k = 0; k < 3; k++) {
      const i = v * 3 + k;
      const thick = positions[i]! - normals[i]! * radius * thin;
      const sprouted = thick - (thick - aOrigin.array[i]!) * shrink;
      const carried = aTwigOrigin ? sprouted - (sprouted - aTwigOrigin.array[i]!) * (1 - twig) : sprouted;
      out[i] = carried - carried * (1 - scale);
    }
  }
  return out;
}
