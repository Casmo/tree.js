import { describe, expect, it } from 'vitest';
import { drawnTriangles, frameStats } from '../examples/large-forest/stats';

describe('large-forest frame stats', () => {
  it('averages the frame times and takes the 95th percentile by nearest rank', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    expect(frameStats(times)).toEqual({ frames: 100, average: 50.5, p95: 95 });
  });

  it('does not depend on the order of the frames', () => {
    expect(frameStats([9, 1, 5, 3, 7])).toEqual(frameStats([1, 3, 5, 7, 9]));
    expect(frameStats([9, 1, 5, 3, 7]).p95).toBe(9);
  });

  it('reports a single frame as both average and p95', () => {
    expect(frameStats([4])).toEqual({ frames: 1, average: 4, p95: 4 });
  });

  it('refuses an empty run', () => {
    expect(() => frameStats([])).toThrow(RangeError);
  });
});

describe('large-forest drawn triangles', () => {
  it('sums index count / 3 x instance count over indexed indirect draws (5 u32 each)', () => {
    // two draws: 300 indices x 4 instances, 60 indices x 0 instances (an empty level still issues its draw)
    const args = new Uint32Array([300, 4, 0, 0, 0, 60, 0, 0, 0, 0]);
    expect(drawnTriangles(args)).toBe(400);
  });

  it('counts nothing for draws that have no mesh (index count 0)', () => {
    expect(drawnTriangles(new Uint32Array([0, 7, 0, 0, 0]))).toBe(0);
  });
});
