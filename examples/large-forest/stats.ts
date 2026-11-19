// Pure numbers for the large-forest example's panel (unit-tested in test/large-forest-stats.test.ts).

/** Average and 95th-percentile (nearest rank) frame time of a run, in milliseconds. */
export interface FrameStats {
  frames: number;
  average: number;
  p95: number;
}

export function frameStats(times: readonly number[]): FrameStats {
  if (times.length === 0) throw new RangeError('frameStats needs at least one frame');
  const sorted = [...times].sort((a, b) => a - b);
  const average = sorted.reduce((sum, t) => sum + t, 0) / sorted.length;
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!;
  return { frames: sorted.length, average, p95 };
}

/** u32s per indexed indirect draw: indexCount, instanceCount, firstIndex, baseVertex, firstInstance. */
const ARGS_STRIDE = 5;

/**
 * Triangles drawn by indexed indirect draws, from their read-back arguments. three.js's
 * `renderer.info` does not count indirect draws, so the example adds these itself.
 */
export function drawnTriangles(args: Uint32Array): number {
  let triangles = 0;
  for (let i = 0; i + 1 < args.length; i += ARGS_STRIDE) triangles += (args[i]! / 3) * args[i + 1]!;
  return triangles;
}
