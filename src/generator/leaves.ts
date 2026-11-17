import type { TreeDefinition } from '../definition';
import type { Random } from '../random';
import { branchFrames, sampleBranch } from './frames';
import type { GeometryBuffers, SkeletonBranch, SkeletonLeaf, Vec3 } from './types';
import { add, cross, dot, normalize, perpendicular, scale } from './vec';

const DEG = Math.PI / 180;
/** Leaf card width as a fraction of its length. */
const LEAF_WIDTH = 0.5;

/**
 * Places leaves on the outermost branches (the trunk if there are no branch levels).
 * Each leaf draws from `random.fork(leafId)`, so leaves never shift the branches and
 * one leaf never shifts another. The colour tint shared by the whole tree comes from
 * `random.fork('tint')`.
 */
export function placeLeaves(definition: TreeDefinition, branches: SkeletonBranch[], random: Random): SkeletonLeaf[] {
  const { leaves } = definition;
  if (leaves.count === 0) return [];
  const outermost = definition.branches.length;
  const base = hexToSrgb(leaves.color);
  // Per-tree tint and per-leaf brightness each take half the colour range, so together they stay within it.
  const half = leaves.colorVariation / 2;
  const tintRandom = random.fork('tint');
  const tint = base.map(() => tintRandom.range(-half, half));

  const out: SkeletonLeaf[] = [];
  for (const branch of branches) {
    if (branch.level !== outermost) continue;
    const frames = branchFrames(branch);
    for (let i = 0; i < leaves.count; i++) {
      const id = `${branch.path}/${i}`;
      const r = random.fork(id);
      const t = leaves.start + ((1 - leaves.start) * (i + r.range(0.1, 0.9))) / leaves.count;
      const at = sampleBranch(branch, frames, t);
      const azimuth = r.range(0, Math.PI * 2);
      const tilt = r.range(35, 75) * DEG;
      const across = add(scale(at.normal, Math.cos(azimuth)), scale(at.binormal, Math.sin(azimuth)));
      const direction = normalize(add(scale(at.tangent, Math.cos(tilt)), scale(across, Math.sin(tilt))));
      // Card plane faces up as much as possible (sunlit side), with some random roll.
      const side0 = cross(direction, [0, 1, 0]);
      const side = dot(side0, side0) > 1e-6 ? normalize(side0) : perpendicular(direction);
      const roll = r.range(-0.4, 0.4);
      const up = cross(side, direction);
      const normal = normalize(add(scale(up, Math.cos(roll)), scale(side, Math.sin(roll))));
      const size = leaves.size * (1 + r.range(-leaves.sizeVariation, leaves.sizeVariation));
      const brightness = r.range(-half, half);
      const color = base.map((c, k) => Math.min(1, Math.max(0, c * (1 + tint[k]! + brightness)))) as Vec3;
      out.push({ id, branch: branch.path, index: i, position: at.position, direction, normal, size, color });
    }
  }
  return out;
}

/** One diamond-shaped card per leaf (4 vertices, 2 triangles), coloured per vertex. */
export function leafGeometry(leaves: SkeletonLeaf[]): GeometryBuffers {
  const positions = new Float32Array(leaves.length * 4 * 3);
  const normals = new Float32Array(leaves.length * 4 * 3);
  const uvs = new Float32Array(leaves.length * 4 * 2);
  const colors = new Float32Array(leaves.length * 4 * 3);
  const indices = new Uint32Array(leaves.length * 6);
  leaves.forEach((leaf, l) => {
    const side = cross(leaf.direction, leaf.normal); // right-handed: direction x normal points to the card's right
    const halfWidth = (leaf.size * LEAF_WIDTH) / 2;
    const mid = add(leaf.position, scale(leaf.direction, leaf.size * 0.4));
    const corners: Vec3[] = [
      leaf.position,
      add(mid, scale(side, halfWidth)),
      add(leaf.position, scale(leaf.direction, leaf.size)),
      add(mid, scale(side, -halfWidth)),
    ];
    const cornerUvs = [0.5, 0, 1, 0.4, 0.5, 1, 0, 0.4];
    const linear = leaf.color.map(srgbToLinear);
    for (let c = 0; c < 4; c++) {
      const v = l * 4 + c;
      positions.set(corners[c]!, v * 3);
      normals.set(leaf.normal, v * 3);
      uvs.set([cornerUvs[c * 2]!, cornerUvs[c * 2 + 1]!], v * 2);
      colors.set(linear, v * 3);
    }
    const v0 = l * 4;
    indices.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], l * 6);
  });
  return { positions, normals, uvs, colors, indices };
}

function hexToSrgb(hex: string): Vec3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
