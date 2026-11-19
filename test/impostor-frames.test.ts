import { describe, expect, it } from 'vitest';
import { blendFrames, frameBasis, frameDirection, frameUv, octahedralDecode, octahedralEncode, type Vec3 } from '../src/forest/octahedral';

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const l = length(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('hemi-octahedral directions', () => {
  it('maps the upper hemisphere onto the unit square and back', () => {
    // Straight down from above is the centre; the horizon is the square's edge.
    expect(octahedralEncode([0, 1, 0])).toEqual([0.5, 0.5]);
    const [u, v] = octahedralEncode([1, 0, 0]);
    expect(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5))).toBeCloseTo(0.5);
    for (const d of [[0.3, 0.8, -0.2], [-0.9, 0.1, 0.4], [0.01, 0.2, 0.97], [-0.5, 0.5, -0.5]] as Vec3[]) {
      const [a, b] = octahedralEncode(d);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      const back = octahedralDecode(a, b);
      unit(d).forEach((c, i) => expect(back[i]).toBeCloseTo(c, 6));
    }
  });

  it('treats a view from below the horizon as one from the horizon', () => {
    expect(octahedralEncode([1, -0.5, 0])).toEqual(octahedralEncode([1, 0, 0]));
  });

  it('gives every frame of the grid a distinct unit direction in the upper hemisphere', () => {
    const frames = 5;
    const seen = new Set<string>();
    for (let j = 0; j < frames; j++) {
      for (let i = 0; i < frames; i++) {
        const d = frameDirection(i, j, frames);
        expect(length(d)).toBeCloseTo(1, 6);
        expect(d[1]).toBeGreaterThanOrEqual(0);
        seen.add(d.map((c) => c.toFixed(4)).join());
      }
    }
    expect(seen.size).toBe(frames * frames);
    // An odd grid has a frame straight above.
    frameDirection(2, 2, 5).forEach((c, i) => expect(c).toBeCloseTo([0, 1, 0][i]!, 6));
  });

  it('gives each frame a right-handed orthonormal basis facing its direction, also straight above', () => {
    for (const d of [frameDirection(0, 3, 7), frameDirection(3, 3, 7), unit([0.2, 0.3, -0.9])]) {
      const { right, up, forward } = frameBasis(d);
      expect(forward).toEqual(d);
      expect(length(right)).toBeCloseTo(1, 6);
      expect(length(up)).toBeCloseTo(1, 6);
      expect(dot(right, up)).toBeCloseTo(0, 6);
      expect(dot(right, forward)).toBeCloseTo(0, 6);
      // right × up = forward
      const cross: Vec3 = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
      cross.forEach((c, i) => expect(c).toBeCloseTo(forward[i]!, 6));
    }
    // From the side, up is (mostly) world up.
    expect(frameBasis([0, 0, 1]).up).toEqual([0, 1, 0]);
  });
});

describe('blendFrames', () => {
  it('draws a view along a frame direction with that frame alone', () => {
    const blend = blendFrames(frameDirection(4, 1, 7), 7);
    const used = blend.frames.filter((_, k) => blend.weights[k]! > 1e-6);
    expect(used).toEqual([[4, 1]]);
    expect(blend.weights.reduce((a, b) => a + b)).toBeCloseTo(1);
  });

  it('blends the four nearest frames, weighted by how close the view is', () => {
    // Half way between frames (2, 3) and (3, 3), a quarter of the way to (2, 4).
    const frames = 8;
    const view = octahedralDecode((2.5 + 0.5) / frames, (3.25 + 0.5) / frames);
    const { frames: picked, weights } = blendFrames(view, frames);
    expect(picked).toEqual([[2, 3], [3, 3], [2, 4], [3, 4]]);
    [0.375, 0.375, 0.125, 0.125].forEach((w, k) => expect(weights[k]).toBeCloseTo(w, 6));
  });

  it('stays on the grid at its edges, and with a single frame', () => {
    const edge = blendFrames([1, 0, 0], 6);
    for (const [i, j] of edge.frames) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(6);
    }
    expect(edge.weights.reduce((a, b) => a + b)).toBeCloseTo(1);
    const single = blendFrames(unit([0.3, 0.4, 0.5]), 1);
    expect(single.frames.every(([i, j]) => i === 0 && j === 0)).toBe(true);
    expect(single.weights.reduce((a, b) => a + b)).toBeCloseTo(1);
  });
});

describe('frameUv', () => {
  it('finds where a frame pictured the point seen through a card point', () => {
    const half = 2;
    const d = frameDirection(1, 2, 4);
    const { right, up } = frameBasis(d);
    // A tree point and the card point in front of it, seen exactly from the frame's direction.
    const p: Vec3 = [0.4, -0.7, 0.3];
    const card: Vec3 = [p[0] - d[0] * dot(p, d), p[1] - d[1] * dot(p, d), p[2] - d[2] * dot(p, d)];
    const [u, v] = frameUv(card, d, d, half);
    // The bake pictures p at (p·right, p·up) / (2 half) + 0.5 in the frame.
    expect(u).toBeCloseTo(dot(p, right) / (2 * half) + 0.5, 6);
    expect(v).toBeCloseTo(dot(p, up) / (2 * half) + 0.5, 6);
  });

  it('follows the line of sight into a neighbouring frame', () => {
    // Seen from a view between frames, a point on the frame's plane is found where that frame pictured it.
    const d = frameDirection(1, 1, 4);
    const view = unit([d[0] + 0.2, d[1], d[2] - 0.1]);
    const { right, up } = frameBasis(d);
    const p: Vec3 = [right[0] * 0.6 + up[0] * -0.3, right[1] * 0.6 + up[1] * -0.3, right[2] * 0.6 + up[2] * -0.3];
    const card: Vec3 = [p[0] - view[0] * dot(p, view), p[1] - view[1] * dot(p, view), p[2] - view[2] * dot(p, view)];
    const [u, v] = frameUv(card, view, d, 1);
    expect(u).toBeCloseTo(0.6 / 2 + 0.5, 6);
    expect(v).toBeCloseTo(-0.3 / 2 + 0.5, 6);
    expect(frameUv([0, 0, 0], view, d, 1)).toEqual([0.5, 0.5]);
  });
});
