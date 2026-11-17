import { createAttributes, writePart, type PartInfo } from './attributes';
import { branchFrames, pathLength } from './frames';
import type { GeometryBuffers, SkeletonBranch, Vec3 } from './types';
import type { PartSway } from './wind';
import { add, normalize, scale } from './vec';

/**
 * Sweeps a ring of `sides` vertices along a branch's points, using parallel-transport
 * frames so branches in any direction get even rings, and caps the tip.
 */
export function sweepBranch(
  branch: SkeletonBranch,
  sides: number,
  random: number,
  season: Vec3 = [0, 0, 0],
  sway?: PartSway,
): GeometryBuffers {
  const pts = branch.points;
  const frames = branchFrames(branch);
  const rings = pts.length;
  const ringSize = sides + 1; // duplicated seam vertex for UVs
  const vertexCount = rings * ringSize + 1; // + tip cap centre
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const attributes = createAttributes(vertexCount);
  const part: PartInfo = { level: branch.level, attach: branch.attach, random, origin: pts[0]!.position, season, sway };

  // Radius change per unit length tilts the normals of a tapered branch towards its tip.
  const slope = (pts[0]!.radius - pts[rings - 1]!.radius) / Math.max(pathLength(branch), 1e-6);

  let v = 0;
  for (let r = 0; r < rings; r++) {
    const { position, radius } = pts[r]!;
    const { tangent, normal, binormal } = frames[r]!;
    for (let s = 0; s <= sides; s++) {
      const angle = ((s % sides) / sides) * Math.PI * 2;
      const radial = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      positions.set(add(position, scale(radial, radius)), v * 3);
      normals.set(normalize(add(radial, scale(tangent, slope))), v * 3);
      uvs.set([s / sides, r / (rings - 1)], v * 2);
      writePart(attributes, v, part, r / (rings - 1));
      v++;
    }
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * ringSize + s;
      const b = a + 1;
      const c = a + ringSize;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Tip cap: fan around a centre vertex.
  const tip = v;
  positions.set(pts[rings - 1]!.position, tip * 3);
  normals.set(frames[rings - 1]!.tangent, tip * 3);
  uvs.set([0.5, 1], tip * 2);
  writePart(attributes, tip, part, 1);
  const lastRing = (rings - 1) * ringSize;
  for (let s = 0; s < sides; s++) indices.push(lastRing + s, lastRing + s + 1, tip);

  return { positions, normals, uvs, indices: Uint32Array.from(indices), attributes };
}

/** Concatenates geometry buffers into one (indices are offset). */
export function mergeBuffers(parts: GeometryBuffers[]): GeometryBuffers {
  const vertexCount = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);
  const out: GeometryBuffers = {
    positions: new Float32Array(vertexCount * 3),
    normals: new Float32Array(vertexCount * 3),
    uvs: new Float32Array(vertexCount * 2),
    indices: new Uint32Array(indexCount),
    attributes: createAttributes(vertexCount),
  };
  let v = 0;
  let i = 0;
  for (const part of parts) {
    out.positions.set(part.positions, v * 3);
    out.normals.set(part.normals, v * 3);
    out.uvs.set(part.uvs, v * 2);
    for (const [name, attribute] of Object.entries(out.attributes)) {
      attribute.array.set(part.attributes[name]!.array, v * attribute.itemSize);
    }
    for (let k = 0; k < part.indices.length; k++) out.indices[i + k] = part.indices[k]! + v;
    v += part.positions.length / 3;
    i += part.indices.length;
  }
  return out;
}
