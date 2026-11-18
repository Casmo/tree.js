// Crown Shape helpers (ADR 0004): ready-made branch-level curves.
import type { Keyframe } from './types';

/** The cone's shortest branches, as a fraction of the level's declared length. */
const MIN_CONE = 0.1;

/**
 * The conifer cone as a Crown Shape length curve for a branch level starting at `start`: full length
 * at `start`, shrinking linearly to a tenth of it near the trunk tip, never below a tenth (the v2
 * generator's `max(0.1, (1 - t) / (1 - start))`). Written by the v2 -> v3 migration and used by every
 * Style's own conifer.
 */
export function coneCurve(start: number): Keyframe<number>[] {
  return [
    { t: start, value: 1 },
    // = 1 - MIN_CONE * (1 - start), written so round starts give round knees (0.18 -> 0.918).
    { t: 1 - MIN_CONE + MIN_CONE * start, value: MIN_CONE },
    { t: 1, value: MIN_CONE },
  ];
}
