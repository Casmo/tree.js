import type { GeometryBuffers, SkeletonBranch } from './types';

/**
 * Sweeps a ring of `sides` vertices along a branch's points (rings in the XZ plane,
 * fine for near-vertical branches; ticket #4 adds proper frames) and caps the tip.
 */
export function sweepBranch(branch: SkeletonBranch, sides: number): GeometryBuffers {
  const pts = branch.points;
  const rings = pts.length;
  const ringSize = sides + 1; // duplicated seam vertex for UVs
  const vertexCount = rings * ringSize + 1; // + tip cap centre
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  const first = pts[0]!;
  const last = pts[rings - 1]!;
  const height = Math.max(last.position[1] - first.position[1], 1e-6);
  const slope = (first.radius - last.radius) / height;
  const nLen = Math.hypot(1, slope);

  let v = 0;
  for (let r = 0; r < rings; r++) {
    const { position, radius } = pts[r]!;
    for (let s = 0; s <= sides; s++) {
      const angle = ((s % sides) / sides) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.set([position[0] + cos * radius, position[1], position[2] + sin * radius], v * 3);
      normals.set([cos / nLen, slope / nLen, sin / nLen], v * 3);
      uvs.set([s / sides, r / (rings - 1)], v * 2);
      v++;
    }
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * ringSize + s;
      const b = a + 1;
      const c = a + ringSize;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Tip cap: fan around a centre vertex.
  const tip = v;
  positions.set(last.position, tip * 3);
  normals.set([0, 1, 0], tip * 3);
  uvs.set([0.5, 1], tip * 2);
  const lastRing = (rings - 1) * ringSize;
  for (let s = 0; s < sides; s++) indices.push(lastRing + s, tip, lastRing + s + 1);

  return { positions, normals, uvs, indices: Uint32Array.from(indices) };
}
