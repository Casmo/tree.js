import type { PartSeason } from '../season/profile';
import { cos, sin } from '../math';
import { createAttributes, writePart, type PartInfo } from './attributes';
import { branchFrames, pathLength, type Frame } from './frames';
import type { GeometryBuffers, GrowthWindow, SkeletonBranch, Vec3 } from './types';
import { BASE_SINK, FLARE_WIDTH, FLARE_ZONE } from './trunk';
import type { PartSway } from './wind';
import { add, length, lerp, normalize, scale, sub } from './vec';

/** How a Stem is swept (ADR 0007): its base ring sinks below the ground, and widens by its Root Flare. */
export interface StemSweep {
  /** `trunk.flare` (0..1); 0 = no flare and no extra rings. */
  flare: number;
  /** Extra rings in the flare zone (`trunk.flareSections`). */
  sections: number;
}

/** One ring of a sweep: where it sits, its radius and frame, `along` (0..1, for UVs and aAlong) and the radius slope for its normals. */
interface Ring extends Frame {
  position: Vec3;
  radius: number;
  along: number;
  slope: number;
}

/**
 * Sweeps a ring of `sides` vertices along a branch's points, using parallel-transport
 * frames so branches in any direction get even rings, and caps the tip. A Stem (`stem` given)
 * sinks its base ring below the ground and widens by its Root Flare; its skeleton is never changed.
 */
export function sweepBranch(
  branch: SkeletonBranch,
  sides: number,
  random: number,
  season: PartSeason = { shift: 0, coverageRank: 0, blossomRank: 0 },
  growth: GrowthWindow = { start: 0, end: 0 },
  sway?: PartSway,
  stem?: StemSweep,
): GeometryBuffers {
  const pts = branch.points;
  const rings = stem && stem.flare > 0 ? flaredRings(branch, stem) : plainRings(branch);
  const ringSize = sides + 1; // duplicated seam vertex for UVs
  const vertexCount = rings.length * ringSize + 1; // + tip cap centre
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const attributes = createAttributes(vertexCount);
  const part: PartInfo = { level: branch.level, attach: branch.attach, random, origin: pts[0]!.position, season, growth, sway };

  let v = 0;
  rings.forEach(({ position, radius, tangent, normal, binormal, along, slope }, r) => {
    for (let s = 0; s <= sides; s++) {
      const angle = ((s % sides) / sides) * Math.PI * 2;
      const radial = add(scale(normal, cos(angle)), scale(binormal, sin(angle)));
      const vertex = add(position, scale(radial, radius));
      if (stem && r === 0) vertex[1] -= BASE_SINK * pts[0]!.radius;
      positions.set(vertex, v * 3);
      normals.set(normalize(add(radial, scale(tangent, slope))), v * 3);
      uvs.set([s / sides, along], v * 2);
      writePart(attributes, v, part, along, radius);
      v++;
    }
  });
  for (let r = 0; r < rings.length - 1; r++) {
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
  positions.set(pts[pts.length - 1]!.position, tip * 3);
  normals.set(rings[rings.length - 1]!.tangent, tip * 3);
  uvs.set([0.5, 1], tip * 2);
  writePart(attributes, tip, part, 1);
  const lastRing = (rings.length - 1) * ringSize;
  for (let s = 0; s < sides; s++) indices.push(lastRing + s, lastRing + s + 1, tip);

  return { positions, normals, uvs, indices: Uint32Array.from(indices), attributes };
}

/** A ring at every skeleton point. Radius change per unit length tilts the normals of a tapered branch towards its tip. */
function plainRings(branch: SkeletonBranch): Ring[] {
  const pts = branch.points;
  const frames = branchFrames(branch);
  const slope = (pts[0]!.radius - pts[pts.length - 1]!.radius) / Math.max(pathLength(branch), 1e-6);
  return pts.map(({ position, radius }, r) => ({ position, radius, ...frames[r]!, along: r / (pts.length - 1), slope }));
}

/**
 * A Stem's rings with its Root Flare: `sections` extra rings in the bottom {@link FLARE_ZONE} of its
 * length, closer together towards the base, and every ring in that zone widened by a multiplier that
 * eases from 1 at the top of the zone to 1 + {@link FLARE_WIDTH} × flare at the base (quadratic, so
 * the flare leaves the trunk without a crease). Normals follow the flared surface.
 */
function flaredRings(branch: SkeletonBranch, { flare, sections }: StemSweep): Ring[] {
  const pts = branch.points;
  const total = Math.max(pathLength(branch), 1e-6);
  const zone = FLARE_ZONE * total;
  const slope = (pts[0]!.radius - pts[pts.length - 1]!.radius) / total;

  // The skeleton points plus the extra rings, each with its distance from the base.
  const extra = Array.from({ length: sections }, (_, k) => zone * ((k + 1) / sections) * ((k + 1) / sections));
  const points: { position: Vec3; radius: number; along: number; distance: number }[] = [];
  let walked = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    points.push({ ...a, along: i / (pts.length - 1), distance: walked });
    if (i === pts.length - 1) break;
    const b = pts[i + 1]!;
    const segment = length(sub(b.position, a.position));
    const gap = 1e-6 * total; // an extra ring on (or next to) a skeleton point is left out
    for (const d of extra) {
      if (d > walked + gap && d < walked + segment - gap) {
        const f = (d - walked) / segment;
        points.push({
          position: lerp(a.position, b.position, f),
          radius: a.radius + (b.radius - a.radius) * f,
          along: (i + f) / (pts.length - 1),
          distance: d,
        });
      }
    }
    walked += segment;
  }

  const frames = branchFrames({ ...branch, points });
  const width = FLARE_WIDTH * flare;
  return points.map(({ position, radius, along, distance }, r) => {
    const u = Math.max(1 - distance / zone, 0); // 1 at the base, 0 from the top of the zone up
    const multiplier = 1 + width * u * u;
    // d(radius × multiplier) / d(distance), negated: the trunk's taper plus the flare's own widening.
    return { position, radius: radius * multiplier, ...frames[r]!, along, slope: slope * multiplier + (radius * 2 * width * u) / zone };
  });
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
