// The directions an Impostor is pictured from (ADR 0010), as pure maths: the CPU source of truth
// that the bake (frame transforms) and the Impostor shader (TSL twins in impostor-material.ts) mirror.
// No three.js at runtime.
//
// Directions are hemi-octahedral: the upper hemisphere (y >= 0, tree space) folded onto the unit
// square, straight down from above in the centre and the horizon along the edges. The square is cut
// into frames × frames frames; frame (i, j) pictures the tree from the direction at the centre of its
// cell, ((i + 0.5) / frames, (j + 0.5) / frames). Frame (i, j) sits at column i, row j of the atlas.

export type Vec3 = readonly [number, number, number];

/** A frame's camera: it looks along -forward, with `right` and `up` across its picture (right × up = forward). */
export interface FrameBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/** The (up to) four frames a view blends, with their weights (they sum to 1). */
export interface FrameBlend {
  frames: [number, number][];
  weights: number[];
}

/** Below this |y|, a frame's up is world up; above it (seen from straight above) the frame's up is -z. */
const POLE = 0.999;

// `+ 0` turns -0 into 0, so equal directions compare equal.
const vec = (x: number, y: number, z: number): Vec3 => [x + 0, y + 0, z + 0];

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return vec(v[0] / l, v[1] / l, v[2] / l);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A view direction (from the tree towards the viewer) on the unit square; views from below count as from the horizon. */
export function octahedralEncode(direction: Vec3): [number, number] {
  const [x, y, z] = [direction[0], Math.max(direction[1], 0), direction[2]];
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const px = x / s;
  const pz = z / s;
  return [(px + pz + 1) / 2, (px - pz + 1) / 2];
}

/** The unit direction at a point of the unit square (inverse of `octahedralEncode`). */
export function octahedralDecode(u: number, v: number): Vec3 {
  const a = u * 2 - 1;
  const b = v * 2 - 1;
  const px = (a + b) / 2;
  const pz = (a - b) / 2;
  return normalize([px, 1 - Math.abs(px) - Math.abs(pz), pz]);
}

/** The direction frame (i, j) pictures the tree from. */
export function frameDirection(i: number, j: number, frames: number): Vec3 {
  return octahedralDecode((i + 0.5) / frames, (j + 0.5) / frames);
}

/** The camera basis of a frame looking at the tree from `forward`. */
export function frameBasis(forward: Vec3): FrameBasis {
  const reference: Vec3 = Math.abs(forward[1]) > POLE ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(reference, forward));
  return { right, up: cross(forward, right), forward: vec(...forward) };
}

/**
 * The four frames around a view direction and their bilinear weights, in the order (i, j), (i+1, j),
 * (i, j+1), (i+1, j+1). On the grid's edge (and with one frame) the frames are clamped to the grid.
 */
export function blendFrames(view: Vec3, frames: number): FrameBlend {
  const [u, v] = octahedralEncode(view);
  const cell = (t: number) => {
    const g = Math.min(Math.max(t * frames - 0.5, 0), frames - 1);
    const base = Math.min(Math.floor(g), Math.max(frames - 2, 0));
    return [base, g - base] as const;
  };
  const [i, fx] = cell(u);
  const [j, fy] = cell(v);
  const last = frames - 1;
  const at = (di: number, dj: number): [number, number] => [Math.min(i + di, last), Math.min(j + dj, last)];
  return {
    frames: [at(0, 0), at(1, 0), at(0, 1), at(1, 1)],
    weights: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
  };
}

/**
 * Where frame `forward` pictured what is seen through `point` of the card (tree space, relative to
 * the tree's centre) looking along `-view`: the line of sight meets the frame's plane (through the
 * centre, facing `forward`) and that spot is projected onto the frame. In 0..1 across the frame,
 * whose picture spans `2 · half` (the card's size).
 */
export function frameUv(point: Vec3, view: Vec3, forward: Vec3, half: number): [number, number] {
  const t = dot(point, forward) / Math.max(dot(view, forward), 1e-3);
  const hit = vec(point[0] - view[0] * t, point[1] - view[1] * t, point[2] - view[2] * t);
  const { right, up } = frameBasis(forward);
  return [dot(hit, right) / (2 * half) + 0.5, dot(hit, up) / (2 * half) + 0.5];
}
