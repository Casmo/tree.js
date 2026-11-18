import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three/webgpu';
import { GLTFExporter, type GLTFExporterPlugin, type GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
import type { TranslucencyDefinition, TreeDefinition } from '../definition';
import { crownNormal, type CrownVolume, type GeometryBuffers } from '../generator';
import { clampGrowth, growPositions, treeScale } from '../growth';
import { groundTintAmount } from '../materials/ground-tint';
import { BARK_REPEAT } from '../materials/maps';
import { isFlatShading } from '../materials/shading';
import { fruitSeason, hexToLinear, leafSeason, partSeasonAt, wrapSeason } from '../season';
import type { Tree } from '../tree';

/**
 * Baked Tree: one tree frozen at a Seed, Growth and Season as plain static geometry with
 * standard PBR materials (`MeshStandardMaterial`, no node materials), for glTF export and other tools.
 * Growth and Season are evaluated on the CPU with the same models the shaders run (`growPositions`,
 * `leafSeason`, `fruitSeason`); Wind is left out (a Baked Tree stands still).
 *
 * Material Features (ADR 0008) are baked into standard glTF channels: Crown Normals blended into the normals,
 * Structural Occlusion as a `_occlusion` attribute (glTF `_OCCLUSION`; optionally also in the vertex
 * colours), Leaf Translucency as `KHR_materials_diffuse_transmission` (written by `exportBakedTree`),
 * and the raw settings with the Crown Volume in `userData.treejs` of the leaf and bark materials (glTF
 * `extras`). With no Material Feature set, the result is exactly as without them.
 */

/** Growth and Season to bake at; each defaults to the tree's current value. */
export interface BakeOptions {
  growth?: number;
  season?: number;
  /**
   * With Structural Occlusion (`materials.occlusion`): also multiply the occlusion into the vertex
   * colours (`COLOR_0`), for engines that only read vertex colours. It then darkens direct light too.
   * Default false: `COLOR_0` is as without the feature, and the occlusion is only in `_OCCLUSION`.
   */
  occlusionInVertexColors?: boolean;
}

/** A triangle with (almost) no area is a part that has not sprouted yet: it is dropped. */
const MIN_AREA2 = 1e-16;

interface BakedBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array | null;
  /** Structural Occlusion per vertex (0 = occluded, 1 = open), written as `_OCCLUSION`; null without it. */
  occlusion: Float32Array | null;
  /** Per vertex: whether it is shown at all. */
  visible: (v: number) => boolean;
  /** Crown Normals: the normals are blended towards these Crown Volume normals (per vertex) by `amount`. */
  crownNormals?: BakedCrownNormals;
}

interface BakedCrownNormals {
  normals: Float32Array;
  amount: number;
  /** Per vertex: its card is turned to face the crown's outside (winding reversed, `normals` already flipped). */
  flipped: Uint8Array;
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
    for (const v of buffers.crownNormals?.flipped[a] ? [a, c, b] : [a, b, c]) {
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
  if (buffers.occlusion) geometry.setAttribute(OCCLUSION, new BufferAttribute(pick(buffers.occlusion, 1), 1));
  if (buffers.crownNormals) geometry.setAttribute(CROWN_NORMAL, new BufferAttribute(pick(buffers.crownNormals.normals, 3), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(kept), 1));
  if (flat) {
    // glTF has no flat-shading switch: split the vertices and give each face its own normal.
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  }
  if (buffers.crownNormals) {
    // After the split, so under flat shading the facet normals are blended and the facets stay visible below 1.
    blendNormals(geometry, buffers.crownNormals.amount);
    geometry.deleteAttribute(CROWN_NORMAL);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The geometry attribute GLTFExporter writes as the `_OCCLUSION` vertex attribute. */
const OCCLUSION = '_occlusion';
/** Scratch attribute: the Crown Volume normal per vertex, removed once the normals are blended. */
const CROWN_NORMAL = 'crownNormal';

/** `normalize(mix(normal, crown normal, amount))`, as the leaf material's normalNode; the crown's where they cancel out. */
function blendNormals(geometry: BufferGeometry, amount: number): void {
  const normal = geometry.getAttribute('normal');
  const crown = geometry.getAttribute(CROWN_NORMAL);
  for (let v = 0; v < normal.count; v++) {
    const c = [crown.getX(v), crown.getY(v), crown.getZ(v)];
    let x = normal.getX(v) + (c[0]! - normal.getX(v)) * amount;
    let y = normal.getY(v) + (c[1]! - normal.getY(v)) * amount;
    let z = normal.getZ(v) + (c[2]! - normal.getZ(v)) * amount;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 1e-4) [x, y, z] = [x / length, y / length, z / length];
    else [x, y, z] = c as [number, number, number];
    normal.setXYZ(v, x, y, z);
  }
}

function area2(p: Float32Array, a: number, b: number, c: number): number {
  const u = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
  const w = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
  const x = u[1]! * w[2]! - u[2]! * w[1]!;
  const y = u[2]! * w[0]! - u[0]! * w[2]!;
  const z = u[0]! * w[1]! - u[1]! * w[0]!;
  return x * x + y * y + z * z;
}

/**
 * Wood: grown positions; the bark's base-to-tip darkening (smooth shading) as vertex colours.
 * With a Ground Tint the vertex colours carry the whole bark colour (the material is white), tinted
 * near the ground on the grown positions, like the bark colorNode.
 */
function bakeWood(definition: TreeDefinition, wood: GeometryBuffers, growth: number, occlusion: BakedOcclusion): BufferGeometry | null {
  const flat = isFlatShading(definition.materials.shading);
  const { color, groundTint } = definition.materials.bark;
  const positions = growPositions(wood, growth);
  let colors: Float32Array | null = null;
  if (!flat || groundTint) {
    // Same as the bark colorNode: mix(base * 0.75, base, sqrt(clamp(uv.y))), then the Ground Tint.
    colors = new Float32Array(wood.positions.length);
    const bark = groundTint ? hexToLinear(color) : [1, 1, 1];
    const tint = groundTint ? hexToLinear(groundTint.color) : [1, 1, 1];
    for (let v = 0; v < colors.length / 3; v++) {
      const shade = flat ? 1 : 0.75 + 0.25 * Math.sqrt(Math.min(Math.max(wood.uvs[v * 2 + 1]!, 0), 1));
      const amount = groundTint ? groundTintAmount(groundTint, positions[v * 3 + 1]!) : 0;
      for (let c = 0; c < 3; c++) colors[v * 3 + c] = bark[c]! * shade * (1 - amount) + tint[c]! * amount;
    }
  }
  return compact({ positions, normals: wood.normals, uvs: wood.uvs, ...occlusion.of(wood, colors), visible: () => true }, wood.indices, flat);
}

/**
 * Leaves: grown positions; fallen leaves dropped; Season (or blossom) colour × the Seed's tint as vertex
 * colours. Also returns the mean colour of the shown leaves (linear, before any occlusion), the colour
 * Leaf Translucency glows in.
 */
function bakeLeaves(
  definition: TreeDefinition,
  leaves: GeometryBuffers,
  growth: number,
  season: number,
  occlusion: BakedOcclusion,
  crown: CrownVolume,
): { geometry: BufferGeometry | null; meanColor: [number, number, number] } {
  const count = leaves.positions.length / 3;
  const aSeason = leaves.attributes.aSeason!.array;
  const shown = new Uint8Array(count);
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const state = leafSeason(definition.season, season, partSeasonAt(aSeason, v));
    shown[v] = state.visible ? 1 : 0;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] = state.color[c]! * (leaves.colors?.[v * 3 + c] ?? 1);
  }
  const meanColor = meanShownColor(colors, shown);
  const positions = growPositions(leaves, growth);
  const amount = definition.materials.leaf.crownNormals;
  const crownNormals = amount ? bakedCrownNormals(leaves, positions, growth, crown, amount, definition.leaves.shape === 'card') : undefined;
  const geometry = compact(
    {
      positions,
      normals: crownNormals ? orient(leaves.normals, crownNormals.flipped) : leaves.normals,
      uvs: leaves.uvs,
      ...occlusion.of(leaves, colors),
      visible: (v) => shown[v] === 1,
      crownNormals,
    },
    leaves.indices,
    isFlatShading(definition.materials.shading),
  );
  return { geometry, meanColor };
}

/** Mean of the colours of the shown vertices (each channel at most 1); black when none is shown. */
function meanShownColor(colors: Float32Array, shown: Uint8Array): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  let count = 0;
  shown.forEach((on, v) => {
    if (!on) return;
    for (let c = 0; c < 3; c++) sum[c]! += colors[v * 3 + c]!;
    count++;
  });
  return sum.map((c) => Math.min(c / Math.max(count, 1), 1)) as [number, number, number];
}

/**
 * Crown Normals for the leaves: the Crown Volume's normal at each grown vertex (the Volume scaled by
 * the Growth scale, as in the material), and which leaf cards to turn around. A card (`leaves.shape`
 * 'card') is flat and double-sided with one normal for both sides: turning it (normal and winding
 * together) changes nothing else, but makes its front face the crown's outside, so in engines that flip
 * the normal of back faces the blended normal of every card points out. Decided per card at its attachment
 * point (`aOrigin`, shared by its vertices). Solid leaf shapes are closed: their front faces are already
 * their outside, and they keep their winding.
 */
function bakedCrownNormals(
  leaves: GeometryBuffers,
  grown: Float32Array,
  growth: number,
  crown: CrownVolume,
  amount: number,
  cards: boolean,
): BakedCrownNormals {
  const count = grown.length / 3;
  const scale = treeScale(growth);
  const origin = leaves.attributes.aOrigin!.array;
  const n = leaves.normals;
  const normals = new Float32Array(count * 3);
  const flipped = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const i = v * 3;
    normals.set(crownNormal(crown, [grown[i]! / scale, grown[i + 1]! / scale, grown[i + 2]! / scale]), i);
    if (!cards) continue;
    const out = crownNormal(crown, [origin[i]!, origin[i + 1]!, origin[i + 2]!]);
    flipped[v] = n[i]! * out[0] + n[i + 1]! * out[1] + n[i + 2]! * out[2] < 0 ? 1 : 0;
  }
  return { normals, amount, flipped };
}

/** The normals with those of `flipped` vertices reversed. */
function orient(normals: Float32Array, flipped: Uint8Array): Float32Array {
  const out = normals.slice();
  flipped.forEach((flip, v) => {
    if (flip) for (let c = 0; c < 3; c++) out[v * 3 + c] = -out[v * 3 + c]!;
  });
  return out;
}

/**
 * Structural Occlusion as baked, for one part with its vertex colours (null: none): `occlusion` is
 * `mix(1, aOcclusion, strength)` per vertex (what the material's aoNode shows), null when the tree has
 * none. With `inColors` the colours come back multiplied by it (in place; a part without colours gets
 * the occlusion as grey ones), else unchanged.
 */
interface BakedOcclusion {
  of(part: GeometryBuffers, colors: Float32Array | null): { occlusion: Float32Array | null; colors: Float32Array | null };
}

function bakedOcclusion(strength: number | null, inColors: boolean): BakedOcclusion {
  return {
    of: (part, colors) => {
      const ao = part.attributes.aOcclusion?.array;
      if (strength === null || !ao) return { occlusion: null, colors };
      const occlusion = Float32Array.from(ao, (a) => 1 - strength * (1 - a));
      if (!inColors) return { occlusion, colors };
      return { occlusion, colors: darken(colors ?? new Float32Array(part.positions.length).fill(1), occlusion) };
    },
  };
}

/** Each vertex's colour times its occlusion (in place). */
function darken(colors: Float32Array, occlusion: Float32Array): Float32Array {
  for (let i = 0; i < colors.length; i++) colors[i]! *= occlusion[Math.floor(i / 3)]!;
  return colors;
}

/**
 * Fruit: each Fruit scaled about its attachment point by the Fruit amount (dropped when not
 * shown), then grown; the Fruit colour × the Seed's tint as vertex colours. Same order as the shader.
 */
function bakeFruit(
  definition: TreeDefinition,
  fruit: GeometryBuffers,
  growth: number,
  season: number,
  occlusion: BakedOcclusion,
): BufferGeometry | null {
  const count = fruit.positions.length / 3;
  if (count === 0) return null;
  const aSeason = fruit.attributes.aSeason!.array;
  const aOrigin = fruit.attributes.aOrigin!.array;
  const shown = new Uint8Array(count);
  const colors = new Float32Array(count * 3);
  const scaled = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const state = fruitSeason(definition.season, season, partSeasonAt(aSeason, v));
    shown[v] = state.visible ? 1 : 0;
    for (let c = 0; c < 3; c++) {
      const i = v * 3 + c;
      colors[i] = state.color[c]! * (fruit.colors?.[i] ?? 1);
      scaled[i] = aOrigin[i]! + (fruit.positions[i]! - aOrigin[i]!) * state.scale;
    }
  }
  return compact(
    {
      positions: growPositions({ ...fruit, positions: scaled }, growth),
      normals: fruit.normals,
      uvs: fruit.uvs,
      ...occlusion.of(fruit, colors),
      visible: (v) => shown[v] === 1,
    },
    fruit.indices,
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
 * meshes `wood`, `leaves` and `fruit` (a mesh with nothing to show is left out) with standard PBR
 * materials: no node materials, no Growth/Season/Wind attributes, no animation. Material Features
 * are baked in (see the top of this module). The result is
 * independent of `tree`; call `disposeBakedTree` when done with it.
 */
export function bakeTree(tree: Tree, options: BakeOptions = {}): Group {
  const { definition, data } = tree;
  const source = tree.wood.material as MeshStandardMaterial; // MeshStandardNodeMaterial: same props
  const growth = clampGrowth(options.growth ?? tree.growth);
  const season = wrapSeason(options.season ?? tree.season);
  const bark = definition.materials.bark;
  const flat = isFlatShading(definition.materials.shading);
  const occlusion = bakedOcclusion(tree.occlusionStrength, options.occlusionInVertexColors ?? false);
  const extras = materialFeatureExtras(tree, growth);

  const group = new Group();
  group.name = definition.name || 'Tree';
  group.userData = { seed: tree.seed, growth, season };

  const woodGeometry = bakeWood(definition, data.wood, growth, occlusion);
  if (woodGeometry) {
    const material = new MeshStandardMaterial({
      name: 'bark',
      color: new Color(bark.groundTint ? 0xffffff : bark.color),
      roughness: bark.roughness,
      metalness: 0,
      vertexColors: woodGeometry.hasAttribute('color'),
      flatShading: flat,
      map: bakedMap(source.map, BARK_REPEAT),
      normalMap: bakedMap(source.normalMap, BARK_REPEAT),
    });
    if (extras) material.userData = { treejs: extras };
    group.add(bakedMesh('wood', woodGeometry, material));
  }

  const { geometry: leafGeometry, meanColor } = bakeLeaves(definition, data.leaves, growth, season, occlusion, data.crown);
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
    if (extras) material.userData = { treejs: extras };
    const { translucency } = definition.materials.leaf;
    // The transmission colour is the leaves' own colour (without the occlusion of `occlusionInVertexColors`).
    if (translucency) diffuseTransmission.set(material, { factor: translucency.strength, color: meanColor });
    group.add(bakedMesh('leaves', leafGeometry, material));
  }

  const fruitGeometry = bakeFruit(definition, data.fruit, growth, season, occlusion);
  if (fruitGeometry) {
    const material = new MeshStandardMaterial({
      name: 'fruit',
      color: 0xffffff,
      roughness: tree.fruit.material.roughness,
      metalness: 0,
      vertexColors: true,
      flatShading: flat,
    });
    group.add(bakedMesh('fruit', fruitGeometry, material));
  }
  return group;
}

/**
 * The `treejs` object in the extras of the baked leaf and bark materials: the raw Material Feature
 * settings and the Crown Volume, for engines that rebuild the effects in their own shaders. The Crown
 * Volume is in the Baked Tree's space (scaled by its Growth, like the geometry). Null when the tree has
 * no Material Feature, so its glTF is as without them.
 */
export interface MaterialFeatureExtras {
  crownNormals?: number;
  translucency?: TranslucencyDefinition;
  occlusion?: { strength: number };
  crown: CrownVolume;
}

function materialFeatureExtras(tree: Tree, growth: number): MaterialFeatureExtras | null {
  const { crownNormals, translucency } = tree.definition.materials.leaf;
  const strength = tree.occlusionStrength;
  if (!crownNormals && !translucency && strength === null) return null;
  const scale = treeScale(growth);
  const { center, radii } = tree.data.crown;
  return {
    ...(crownNormals ? { crownNormals } : {}),
    ...(translucency ? { translucency: { ...translucency } } : {}),
    ...(strength !== null ? { occlusion: { strength } } : {}),
    crown: { center: [center[0] * scale, center[1] * scale, center[2] * scale], radii: [radii[0] * scale, radii[1] * scale, radii[2] * scale] },
  };
}

/** Leaf Translucency of a baked leaf material, written as `KHR_materials_diffuse_transmission` on export. */
const diffuseTransmission = new WeakMap<Material, { factor: number; color: [number, number, number] }>();

/** GLTFExporter plugin: Leaf Translucency as `KHR_materials_diffuse_transmission` (factor = strength, colour = the leaf colour). */
class DiffuseTransmissionExtension implements GLTFExporterPlugin {
  readonly name = 'KHR_materials_diffuse_transmission';
  constructor(private readonly writer: GLTFWriter) {}

  async writeMaterialAsync(material: Material, materialDef: Record<string, unknown>): Promise<void> {
    const transmission = diffuseTransmission.get(material);
    if (!transmission) return;
    const extensions = (materialDef.extensions ??= {}) as Record<string, unknown>;
    extensions[this.name] = { diffuseTransmissionFactor: transmission.factor, diffuseTransmissionColorFactor: transmission.color };
    (this.writer as unknown as { extensionsUsed: Record<string, boolean> }).extensionsUsed[this.name] = true;
  }
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
    const exporter = new GLTFExporter().register((writer) => new DiffuseTransmissionExtension(writer));
    const result = await exporter.parseAsync(baked, { binary: options.binary ?? true });
    return result as ArrayBuffer | Record<string, unknown>;
  } finally {
    disposeBakedTree(baked);
  }
}
