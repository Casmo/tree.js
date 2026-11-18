import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers } from '../generator';
import { clampGrowth, growPositions } from '../growth';
import { BARK_REPEAT } from '../materials/maps';
import { isFlatShading } from '../materials/shading';
import { leafSeason, partSeasonAt, wrapSeason } from '../season';
import type { Tree } from '../tree';

/**
 * Baked Tree: one tree frozen at a Seed, Growth and Season as plain static geometry with
 * standard PBR materials (`MeshStandardMaterial`, no node materials, no custom attributes), for
 * glTF export and other tools. Growth and Season are evaluated on the CPU with the same models the
 * shaders run (`growPositions`, `leafSeason`); Wind is left out (a Baked Tree stands still).
 */

/** Growth and Season to bake at; each defaults to the tree's current value. */
export interface BakeOptions {
  growth?: number;
  season?: number;
}

/** A triangle with (almost) no area is a part that has not sprouted yet: it is dropped. */
const MIN_AREA2 = 1e-16;

interface BakedBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array | null;
  /** Per vertex: whether it is shown at all. */
  visible: (v: number) => boolean;
}

/**
 * Keeps the triangles whose three vertices are visible and that have an area, and only the
 * vertices those triangles use. Returns null when nothing is left (glTF forbids empty meshes).
 */
function compact(buffers: BakedBuffers, indices: Uint32Array, flat: boolean): BufferGeometry | null {
  const { positions } = buffers;
  const kept: number[] = [];
  const remap = new Int32Array(positions.length / 3).fill(-1);
  let count = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    if (!buffers.visible(a) || !buffers.visible(b) || !buffers.visible(c)) continue;
    if (area2(positions, a, b, c) < MIN_AREA2) continue;
    for (const v of [a, b, c]) {
      if (remap[v] === -1) remap[v] = count++;
      kept.push(remap[v]!);
    }
  }
  if (kept.length === 0) return null;

  const pick = (source: Float32Array, size: number) => {
    const out = new Float32Array(count * size);
    remap.forEach((to, from) => {
      if (to >= 0) out.set(source.subarray(from * size, from * size + size), to * size);
    });
    return out;
  };
  let geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pick(positions, 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(pick(buffers.normals, 3), 3));
  geometry.setAttribute('uv', new BufferAttribute(pick(buffers.uvs, 2), 2));
  if (buffers.colors) geometry.setAttribute('color', new BufferAttribute(pick(buffers.colors, 3), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(kept), 1));
  if (flat) {
    // glTF has no flat-shading switch: split the vertices and give each face its own normal.
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function area2(p: Float32Array, a: number, b: number, c: number): number {
  const u = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
  const w = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
  const x = u[1]! * w[2]! - u[2]! * w[1]!;
  const y = u[2]! * w[0]! - u[0]! * w[2]!;
  const z = u[0]! * w[1]! - u[1]! * w[0]!;
  return x * x + y * y + z * z;
}

/** Wood: grown positions; the bark's base-to-tip darkening (smooth shading) as vertex colours. */
function bakeWood(definition: TreeDefinition, wood: GeometryBuffers, growth: number): BufferGeometry | null {
  const flat = isFlatShading(definition.materials.shading);
  let colors: Float32Array | null = null;
  if (!flat) {
    // Same as the bark colorNode: mix(base * 0.75, base, sqrt(clamp(uv.y))).
    colors = new Float32Array(wood.positions.length);
    for (let v = 0; v < colors.length / 3; v++) {
      const shade = 0.75 + 0.25 * Math.sqrt(Math.min(Math.max(wood.uvs[v * 2 + 1]!, 0), 1));
      colors.fill(shade, v * 3, v * 3 + 3);
    }
  }
  return compact(
    { positions: growPositions(wood, growth), normals: wood.normals, uvs: wood.uvs, colors, visible: () => true },
    wood.indices,
    flat,
  );
}

/** Leaves: grown positions; fallen leaves dropped; Season (or blossom) colour × the Seed's tint as vertex colours. */
function bakeLeaves(definition: TreeDefinition, leaves: GeometryBuffers, growth: number, season: number): BufferGeometry | null {
  const count = leaves.positions.length / 3;
  const aSeason = leaves.attributes.aSeason!.array;
  const shown = new Uint8Array(count);
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const state = leafSeason(definition.season, season, partSeasonAt(aSeason, v));
    shown[v] = state.visible ? 1 : 0;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] = state.color[c]! * (leaves.colors?.[v * 3 + c] ?? 1);
  }
  return compact(
    { positions: growPositions(leaves, growth), normals: leaves.normals, uvs: leaves.uvs, colors, visible: (v) => shown[v] === 1 },
    leaves.indices,
    isFlatShading(definition.materials.shading),
  );
}

/** A loaded texture for the baked material (a copy, so the tree's shared texture is untouched); null without image data. */
function bakedMap(texture: Texture | null | undefined, repeat?: readonly [number, number]): Texture | null {
  if (!texture?.image) return null;
  const copy = texture.clone();
  if (repeat) copy.repeat.set(...repeat);
  return copy;
}

/**
 * Freezes a tree at a Growth and Season (default: the tree's own) into a static `Group` of
 * meshes `wood` and `leaves` (a mesh with nothing to show is left out) with standard PBR
 * materials: no node materials, no Growth/Season/Wind attributes, no animation. The result is
 * independent of `tree`; call `disposeBakedTree` when done with it.
 */
export function bakeTree(tree: Tree, options: BakeOptions = {}): Group {
  const { definition, data } = tree;
  const source = tree.wood.material as MeshStandardMaterial; // MeshStandardNodeMaterial: same props
  const growth = clampGrowth(options.growth ?? tree.growth);
  const season = wrapSeason(options.season ?? tree.season);
  const bark = definition.materials.bark;
  const flat = isFlatShading(definition.materials.shading);

  const group = new Group();
  group.name = definition.name || 'Tree';
  group.userData = { seed: tree.seed, growth, season };

  const woodGeometry = bakeWood(definition, data.wood, growth);
  if (woodGeometry) {
    const material = new MeshStandardMaterial({
      name: 'bark',
      color: new Color(bark.color),
      roughness: bark.roughness,
      metalness: 0,
      vertexColors: woodGeometry.hasAttribute('color'),
      flatShading: flat,
      map: bakedMap(source.map, BARK_REPEAT),
      normalMap: bakedMap(source.normalMap, BARK_REPEAT),
    });
    group.add(bakedMesh('wood', woodGeometry, material));
  }

  const leafGeometry = bakeLeaves(definition, data.leaves, growth, season);
  if (leafGeometry) {
    const map = bakedMap(tree.leaves.material.map);
    const material = new MeshStandardMaterial({
      name: 'leaves',
      color: 0xffffff,
      roughness: definition.materials.leaf.roughness,
      metalness: 0,
      vertexColors: true,
      flatShading: flat,
      side: DoubleSide,
      map,
      alphaTest: map ? definition.materials.leaf.alphaTest : 0,
    });
    group.add(bakedMesh('leaves', leafGeometry, material));
  }
  return group;
}

function bakedMesh(name: string, geometry: BufferGeometry, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Frees the geometries, materials and texture copies of a baked tree. */
export function disposeBakedTree(baked: Group): void {
  baked.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const material = object.material as MeshStandardMaterial;
    material.map?.dispose();
    material.normalMap?.dispose();
    material.dispose();
  });
}

export interface ExportBakedTreeOptions extends BakeOptions {
  /** `.glb` (ArrayBuffer, default) or `.gltf` JSON with embedded buffers. */
  binary?: boolean;
}

/**
 * Bakes a tree (see {@link bakeTree}) and writes it as glTF 2.0: a `.glb` ArrayBuffer by default,
 * or the `.gltf` JSON object with `binary: false`. Waits for the tree's textures first. In Node,
 * three's GLTFExporter needs a `FileReader` global.
 */
export function exportBakedTree(tree: Tree, options?: ExportBakedTreeOptions & { binary?: true }): Promise<ArrayBuffer>;
export function exportBakedTree(tree: Tree, options: ExportBakedTreeOptions & { binary: false }): Promise<Record<string, unknown>>;
export function exportBakedTree(tree: Tree, options?: ExportBakedTreeOptions): Promise<ArrayBuffer | Record<string, unknown>>;
export async function exportBakedTree(
  tree: Tree,
  options: ExportBakedTreeOptions = {},
): Promise<ArrayBuffer | Record<string, unknown>> {
  await tree.ready;
  const baked = bakeTree(tree, options);
  try {
    const result = await new GLTFExporter().parseAsync(baked, { binary: options.binary ?? true });
    return result as ArrayBuffer | Record<string, unknown>;
  } finally {
    disposeBakedTree(baked);
  }
}
