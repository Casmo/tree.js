import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Source,
  SRGBColorSpace,
  type Texture,
} from 'three/webgpu';
import { GLTFExporter, type GLTFExporterPlugin, type GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
import { DEFAULT_LEAF_MASSES, type InnerGlowDefinition, type MaterialFeatures, type TranslucencyDefinition, type TreeDefinition } from '../definition';
import { crownDistance, crownNormal, type CrownVolume, type GeometryBuffers } from '../generator';
import { clampGrowth, growPositions, treeScale } from '../growth';
import { groundTintAmount } from '../materials/ground-tint';
import { BARK_REPEAT } from '../materials/maps';
import { pow } from '../math';
import { paintsLeafMasses } from '../materials';
import { BEND, bendToMass, GAP_DARK, LEAF_SHADOW, leafMassPoint, paintLeafColor, SPRAY_STRENGTH, SUNLIT, WARM, WRAP, wrapLight } from '../materials/painted';
import { isFlatShading } from '../materials/shading';
import { crownEdgeGlowAt, INNER_GLOW_PERIOD, LEAF_GAIN, PULSE_LOW, STEADY_PULSE, VEIN_GAIN } from '../materials/enchanted';
import { accentOf, STRIPE_EDGE, STRIPE_TURNS, STRIPE_WIDTH, STRIPES } from '../materials/whimsical';
import { definitionForSeed, evaluateSeason, fruitSeason, hexToLinear, leafSeason, partSeasonAt, wrapSeason } from '../season';
import { srgbToLinear } from '../season/profile';
import type { Tree } from '../tree';

/**
 * Baked Tree: one tree frozen at a Seed, Growth and Season as plain static geometry with
 * standard PBR materials (`MeshStandardMaterial`, no node materials), for glTF export and other tools.
 * Growth and Season are evaluated on the CPU with the same models the shaders run (`growPositions`,
 * `leafSeason`, `fruitSeason`); Wind is left out (a Baked Tree stands still).
 *
 * Material Features (ADR 0008) are baked into standard glTF channels: Crown Normals blended into the normals,
 * Structural Occlusion as a `_occlusion` attribute (glTF `_OCCLUSION`, strength already applied; optionally also in the vertex
 * colours), Leaf Translucency as `KHR_materials_diffuse_transmission` (written by `exportBakedTree`),
 * and the settings with the Crown Volume in `userData.treejs` of the leaf and bark materials (glTF
 * `extras`). With no Material Feature set, the result is exactly as without them.
 *
 * Painterly (`shading: 'painted'`, ADR 0014) is baked as an approximation: standard glTF cannot carry the
 * live shading (wrap lighting, the crown gradient moved by direct light). Painted Leaf Masses get their lighting
 * normals (bent towards their mass), the crown gradient painted into the vertex colours (lit from above), a brightness spray map and
 * `_MASS_NORMAL` / `_PAINT`; the look's settings go in `treejs.painted` (see {@link PaintedExtras}).
 *
 * The Fantasy Styles (#142): an Enchanted tree's Inner Glow is baked as a steady emissive (no Wind clock to
 * pulse with: the pulse's mean), leaves in their own colour with the card as the emissive texture, bark in the
 * Season leaf colour through a vein texture from the bark map's alpha, with `KHR_materials_emissive_strength`
 * where it is brighter than 1; the settings go in `treejs.innerGlow` (see {@link InnerGlowExtras}). Whimsical's
 * candy stripes are baked into a bark map (its toon lighting and rim light are not carried).
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
  /**
   * Every triangle twice, once each way round (same vertices and normals), for a single-sided material: flat
   * cards whose both sides show the same normal, which a double-sided material cannot (engines flip it on the back).
   */
  twoSided?: boolean;
  /** More attributes to keep as they are (exported as glTF custom attributes, name upper-cased). */
  custom?: Record<string, { array: Float32Array; itemSize: number }>;
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
  if (buffers.twoSided) {
    for (let t = 0, n = kept.length; t < n; t += 3) kept.push(kept[t]!, kept[t + 2]!, kept[t + 1]!);
  }

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
  for (const [name, { array, itemSize }] of Object.entries(buffers.custom ?? {})) geometry.setAttribute(name, new BufferAttribute(pick(array, itemSize), itemSize));
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
    // Same as the bark colorNode: mix(base * 0.75, base, sqrt(clamp(uv.y))), then the Ground Tint. Whimsical:
    // the striped colour is the map's, so the shade (and the tint) only.
    colors = new Float32Array(wood.positions.length);
    const bark = groundTint && !stripesBark(definition) ? hexToLinear(color) : [1, 1, 1];
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
  amount: number | undefined,
  sprayValue: number,
): { geometry: BufferGeometry | null; meanColor: [number, number, number]; meanGlow: [number, number, number] } {
  const count = leaves.positions.length / 3;
  const aSeason = leaves.attributes.aSeason!.array;
  const shown = new Uint8Array(count);
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const state = leafSeason(definition.season, season, partSeasonAt(aSeason, v));
    shown[v] = state.visible ? 1 : 0;
    for (let c = 0; c < 3; c++) colors[v * 3 + c] = state.color[c]! * (leaves.colors?.[v * 3 + c] ?? 1);
  }
  const masses = paintedMasses(definition, leaves);
  if (masses) masses.paint(colors, sprayValue);
  const meanColor = meanShownColor(colors, shown);
  const positions = growPositions(leaves, growth);
  const meanGlow = meanEdgeGlow(colors, shown, positions, growth, crown);
  const crownNormals = amount ? bakedCrownNormals(leaves, positions, growth, crown, amount, definition.leaves.shape === 'card') : undefined;
  const geometry = compact(
    {
      positions,
      normals: masses?.normals ?? (crownNormals ? orient(leaves.normals, crownNormals.flipped) : leaves.normals),
      uvs: leaves.uvs,
      ...occlusion.of(leaves, colors),
      visible: (v) => shown[v] === 1,
      crownNormals,
      custom: masses?.custom,
      twoSided: masses !== null,
    },
    leaves.indices,
    isFlatShading(definition.materials.shading),
  );
  return { geometry, meanColor, meanGlow };
}

/**
 * The mean of the shown leaves' colours (linear) × how much of the Inner Glow each shows at its place in the
 * Crown Volume (`crownEdgeGlowAt`, as the live leaf glow measures it on the grown tree).
 */
function meanEdgeGlow(colors: Float32Array, shown: Uint8Array, grown: Float32Array, growth: number, crown: CrownVolume): [number, number, number] {
  const scale = treeScale(growth);
  const sum: [number, number, number] = [0, 0, 0];
  let count = 0;
  shown.forEach((on, v) => {
    if (!on) return;
    const i = v * 3;
    const edge = crownEdgeGlowAt(crownDistance(crown, [grown[i]! / scale, grown[i + 1]! / scale, grown[i + 2]! / scale]));
    for (let c = 0; c < 3; c++) sum[c]! += colors[i + c]! * edge;
    count++;
  });
  return sum.map((c) => c / Math.max(count, 1)) as [number, number, number];
}

/**
 * Painted Leaf Masses (`shading: 'painted'`, `leaves.shape: 'mass'`), baked as the leaf material draws them
 * (`paintLeafMasses`) as far as standard glTF goes:
 * - `normals`: each card's normal bent towards its mass's (`aMass`) by `BEND`, as the material's normalNode.
 *   Live, both sides of a card are lit with it; so the cards are baked two-sided (each triangle also the other
 *   way round, with the same normals) for a single-sided material, as engines flip the normal of back faces.
 * - `paint`: the vertex colours painted onto the crown gradient (in place), as lit by a sun straight above
 *   ({@link PAINT_SUN}; live, direct light moves a leaf up the gradient towards the warm tips, which a standard
 *   material cannot do); the spray's paint value as `sprayValue` (see `bakedSprayMap`), its strokes go in the map.
 * - `custom`: `aMass` and `aPaint` as `_MASS_NORMAL` / `_PAINT`, for engines that rebuild the shading.
 * Null for other leaves.
 */
function paintedMasses(definition: TreeDefinition, leaves: GeometryBuffers) {
  const { aMass, aPaint } = leaves.attributes;
  if (!paintsLeafMasses(definition) || !aMass || !aPaint) return null;
  const count = leaves.positions.length / 3;
  const n = leaves.normals;
  const mass = aMass.array as Float32Array;
  const paint = aPaint.array as Float32Array;
  // The cards' lighting normals, as the material's normalNode.
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 3) normals.set(bendToMass(n.subarray(i, i + 3), mass.subarray(i, i + 3)), i);
  return {
    normals,
    custom: { [MASS_NORMAL]: { array: mass, itemSize: 3 }, [PAINT]: { array: paint, itemSize: 4 } },
    paint(colors: Float32Array, sprayValue: number) {
      for (let v = 0; v < count; v++) {
        // Lit by a sun straight above (PAINT_SUN, so N·L is the normal's y), through the wrap lighting: tops warm, undersides deep.
        const up = normals[v * 3 + 1]!;
        const painted = paintLeafColor(colors.subarray(v * 3, v * 3 + 3), leafMassPoint(paint, v), up, { value: sprayValue, lit: SUNLIT * wrapLight(up) });
        colors.set(painted, v * 3);
      }
    },
  };
}

/** The direction (up) of the sun the baked painted leaf colours are lit by. */
const PAINT_SUN: [number, number, number] = [0, 1, 0];

/** The geometry attributes GLTFExporter writes as `_MASS_NORMAL` and `_PAINT` (painted Leaf Masses). */
const MASS_NORMAL = '_mass_normal';
const PAINT = '_paint';

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
  const { data } = tree;
  // The tree's Definition with its Seed's Leaf Palette colours (as the tree draws it).
  const definition = definitionForSeed(tree.definition, tree.seed);
  const source = tree.wood.material as MeshStandardMaterial; // MeshStandardNodeMaterial: same props
  const growth = clampGrowth(options.growth ?? tree.growth);
  const season = wrapSeason(options.season ?? tree.season);
  const bark = definition.materials.bark;
  const flat = isFlatShading(definition.materials.shading);
  // The features as the tree shows them now (values tuned live included).
  const features = tree.materialFeatures;
  const occlusion = bakedOcclusion(features.occlusion?.strength ?? null, options.occlusionInVertexColors ?? false);
  const featureExtras = materialFeatureExtras(features, tree.data.crown, growth, options.occlusionInVertexColors ?? false);
  const painted = definition.materials.shading === 'painted';
  const masses = paintsLeafMasses(definition);
  // Painted Leaf Masses: the spray's grey is a paint value, baked into a brightness map around its mean.
  const spray = masses ? bakedSprayMap(tree.leaves.material.map, definition.materials.leaf.alphaTest) : null;
  // Inner Glow (enchanted shading only), with the strengths the tree shows now (tuned live included).
  const innerGlow = tree.innerGlow;
  const extrasFor = (part: 'bark' | 'leaves') => {
    const paintedExtras = painted ? paintedSettings(definition, part === 'leaves' && masses ? (spray?.value ?? 0.5) : null) : null;
    if (!featureExtras && !paintedExtras && !innerGlow) return null;
    return { ...featureExtras, ...(paintedExtras ? { painted: paintedExtras } : {}), ...(innerGlow ? { innerGlow: innerGlowExtras(innerGlow) } : {}) };
  };

  const group = new Group();
  group.name = definition.name || 'Tree';
  group.userData = { seed: tree.seed, growth, season };

  const woodGeometry = bakeWood(definition, data.wood, growth, occlusion);
  if (woodGeometry) {
    const stripes = stripesBark(definition) ? candyStripesMap(definition) : null;
    const material = new MeshStandardMaterial({
      name: 'bark',
      color: new Color(bark.groundTint || stripes ? 0xffffff : bark.color),
      roughness: bark.roughness,
      metalness: 0,
      vertexColors: woodGeometry.hasAttribute('color'),
      flatShading: flat,
      map: stripes ?? bakedMap(source.map, BARK_REPEAT),
      normalMap: bakedMap(source.normalMap, BARK_REPEAT),
    });
    // The veins glow in the Season leaf colour (unshifted, as the live bark), where the bark map's alpha marks them.
    const veins = innerGlow && innerGlow.veins > 0 ? veinMap(source.map) : null;
    if (veins) {
      const colour = evaluateSeason(definition.season, season).leafColor;
      setEmissive(material, colour.map((c) => c * innerGlow!.veins * VEIN_GAIN * STEADY_PULSE), veins);
    }
    const extras = extrasFor('bark');
    if (extras) material.userData = { treejs: extras };
    group.add(bakedMesh('wood', woodGeometry, material));
  }

  const { geometry: leafGeometry, meanColor, meanGlow } = bakeLeaves(
    definition,
    data.leaves,
    growth,
    season,
    occlusion,
    data.crown,
    features.crownNormals,
    spray?.value ?? 0.5,
  );
  if (leafGeometry) {
    const map = spray ? spray.map : bakedMap(tree.leaves.material.map);
    const material = new MeshStandardMaterial({
      name: 'leaves',
      color: 0xffffff,
      roughness: definition.materials.leaf.roughness,
      metalness: 0,
      vertexColors: true,
      flatShading: flat,
      side: masses ? FrontSide : DoubleSide, // painted Leaf Masses: both ways round in the geometry
      map,
      alphaTest: map ? definition.materials.leaf.alphaTest : 0,
    });
    // The leaves glow in their own colour (× the Seed's tint), strongest at the crown's edge, through the card.
    if (innerGlow && innerGlow.leaf > 0) setEmissive(material, meanGlow.map((c) => c * innerGlow.leaf * LEAF_GAIN * STEADY_PULSE), map);
    const extras = extrasFor('leaves');
    if (extras) material.userData = { treejs: extras };
    const { translucency } = features;
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
 * The painted look's settings (`treejs.painted` in the extras of the baked bark and leaf materials of a
 * `shading: 'painted'` tree, the painterly Style): what the live shading does that standard glTF cannot carry,
 * for engines that rebuild it in their own shaders. The Baked Tree itself is an approximation of it.
 */
export interface PaintedExtras {
  /** Wrap lighting: light reaches round the shaded side, `smoothstep(0, 1, (N·L + wrap) / (1 + wrap))`. */
  wrap: number;
  /** Direct light on bark and Fruit is multiplied by this (linear rgb): a little warmer. */
  warm: [number, number, number];
  /** Painted Leaf Masses (`leaves.shape: 'mass'`, leaf material only). */
  leafMasses?: {
    masses: number;
    massLayering: number;
    /** How far `NORMAL` is bent from the card's own towards its mass's (`_MASS_NORMAL`); already in `NORMAL`. */
    bend: number;
    /** How far direct light moves a leaf up the gradient (towards the warm tips); not in `COLOR_0`. */
    sunlit: number;
    /** How much of a received shadow the leaves show. */
    leafShadow: number;
    /** The spray's paint value (linear, a light stroke) `COLOR_0` was painted at; the map darkens the darker strokes. */
    paintValue: number;
    /** `COLOR_0` is painted as lit by a sun from this direction (straight above), `sunlit` included. */
    paintSun: [number, number, number];
  };
}

function paintedSettings(definition: TreeDefinition, paintValue: number | null): PaintedExtras {
  const { masses, massLayering } = definition.leaves;
  return {
    wrap: WRAP,
    warm: [...WARM],
    ...(paintValue === null
      ? {}
      : { leafMasses: { masses: masses ?? DEFAULT_LEAF_MASSES, massLayering: massLayering ?? 1, bend: BEND, sunlit: SUNLIT, leafShadow: LEAF_SHADOW, paintValue, paintSun: [...PAINT_SUN] } }),
  };
}

/**
 * The Inner Glow's settings (`treejs.innerGlow` in the extras of the baked bark and leaf materials of an Enchanted
 * tree): the strengths, and the pulse the live glow has, which the Baked Tree leaves out (it glows steadily at the
 * pulse's mean, `baked`), for engines that animate it themselves.
 */
export interface InnerGlowExtras extends InnerGlowDefinition {
  pulse: {
    /** Seconds per pulse. */
    period: number;
    /** The pulse swings the glow between `low` × its strength and the full strength. */
    low: number;
    /** The share of the full strength the emissive is baked at. */
    baked: number;
  };
}

function innerGlowExtras(glow: InnerGlowDefinition): InnerGlowExtras {
  return { ...glow, pulse: { period: INNER_GLOW_PERIOD, low: PULSE_LOW, baked: STEADY_PULSE } };
}

/**
 * Sets a baked material's emissive to `rgb` (linear, may be brighter than 1: then the colour is scaled down to
 * at most 1 and the rest goes in `emissiveIntensity`, written as `KHR_materials_emissive_strength`), through `map`.
 */
function setEmissive(material: MeshStandardMaterial, rgb: number[], map: Texture | null): void {
  const peak = Math.max(...rgb);
  if (!(peak > 0)) return;
  const scale = Math.max(peak, 1);
  material.emissive.setRGB(rgb[0]! / scale, rgb[1]! / scale, rgb[2]! / scale);
  material.emissiveIntensity = scale;
  material.emissiveMap = map;
}

/**
 * The Inner Glow's vein mask as a texture glTF can use as emissive (which reads no alpha): the bark map's
 * alpha as grey, tiled as the bark map. Null without a readable bark map (live: no bark map, no vein glow).
 */
function veinMap(texture: Texture | null | undefined): Texture | null {
  const pixels = texture?.image ? readPixels(texture.image as TexImage) : null;
  if (!texture || !pixels) return null;
  const { data, width, height } = pixels;
  const out = new Uint8ClampedArray(new ArrayBuffer(data.length));
  for (let i = 0; i < data.length; i += 4) {
    out.fill(data[i + 3]!, i, i + 3);
    out[i + 3] = 255;
  }
  const map = texture.clone();
  map.source = new Source(writePixels(out, width, height, texture.image as TexImage));
  map.repeat.set(...BARK_REPEAT);
  map.needsUpdate = true;
  return map;
}

/** Whether the bark is drawn with Whimsical's candy stripes (baked into a map). */
const stripesBark = (definition: TreeDefinition) => definition.materials.shading === 'whimsical';

/** Texels across the candy stripe map (one tile: the stripes repeat in whole periods across uv 0..1). */
const STRIPE_MAP_SIZE = 64;

/**
 * Whimsical's candy stripes as a bark map (sRGB, repeating): the bark colour with stripes in the tree's accent
 * colour, laid out over uv exactly as `candyStripes` draws them (`uv.x` round the branch, `uv.y` along it).
 */
function candyStripesMap(definition: TreeDefinition): DataTexture {
  const base = hexToLinear(definition.materials.bark.color);
  const accent = hexToLinear(accentOf(definition) as `#${string}`);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const n = STRIPE_MAP_SIZE;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const along = ((u + v * STRIPE_TURNS) * STRIPES) % 1;
      const stripe = smooth(0, STRIPE_EDGE, along) * (1 - smooth(STRIPE_WIDTH, STRIPE_WIDTH + STRIPE_EDGE, along));
      const i = (y * n + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(linearToSrgb(base[c]! + (accent[c]! - base[c]!) * stripe) * 255);
      data[i + 3] = 255;
    }
  }
  const map = new DataTexture(data, n, n);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.needsUpdate = true;
  return map;
}

/**
 * How much darker (per unit of linear paint value) the baked spray map gets below the painted value: roughly how
 * fast the painted gradient darkens as the spray moves a leaf down it (`SPRAY_STRENGTH`, in the middle of the ramp).
 */
const SPRAY_CONTRAST = 1.2;
/** The paint value `COLOR_0` is painted at: this quantile of the spray's covered texels (the light strokes). */
const SPRAY_TOP = 0.75;

/**
 * The spray texture of painted Leaf Masses for a standard material. Live, its grey is a paint value that moves a
 * leaf along the crown gradient and its alpha the cut-out; a standard material would multiply the grey in and
 * darken everything. So `COLOR_0` is painted at the light end of the spray's values (`value`, {@link SPRAY_TOP}),
 * and the copy keeps the alpha and holds the darker strokes as a brightness (`1 + SPRAY_CONTRAST * (paint value -
 * value)`, at most 1), with the gaps between the painted leaves a little darker, as live. `value` is 0.5 (as the
 * shader without a texture) when there is no image, or no canvas to read it with; then the map is the plain copy.
 */
function bakedSprayMap(texture: Texture | null | undefined, alphaTest: number): { map: Texture | null; value: number } {
  const pixels = texture?.image ? readPixels(texture.image as TexImage) : null;
  if (!texture || !pixels) return { map: bakedMap(texture), value: 0.5 };
  const { data, width, height } = pixels;
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! / 255 >= alphaTest) values.push(srgbToLinear(data[i]! / 255));
  values.sort((x, y) => x - y);
  const value = values.length ? values[Math.min(Math.floor(values.length * SPRAY_TOP), values.length - 1)]! : 0.5;
  const out = new Uint8ClampedArray(new ArrayBuffer(data.length));
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    const brightness = Math.min(Math.max(1 + SPRAY_CONTRAST * (srgbToLinear(data[i]! / 255) - value), 0), 1) * (1 - (1 - GAP_DARK) * (1 - a) * SPRAY_STRENGTH);
    out.fill(Math.round(linearToSrgb(brightness) * 255), i, i + 3);
    out[i + 3] = data[i + 3]!;
  }
  const map = texture.clone();
  map.source = new Source(writePixels(out, width, height, texture.image as TexImage)); // its own image: the clone shares the Source
  map.needsUpdate = true;
  return { map, value };
}

type TexImage = { width: number; height: number; data?: ArrayLike<number> } & Partial<CanvasImageSource>;

/** RGBA bytes of a texture image: raw data (a DataTexture's) as it is, others drawn into a canvas; null without a canvas. */
function readPixels(image: TexImage): { data: ArrayLike<number>; width: number; height: number } | null {
  const { width, height } = image;
  if (!width || !height) return null;
  if (image.data) return image.data.length === width * height * 4 ? { data: image.data, width, height } : null;
  const context = canvas2d(width, height);
  if (!context) return null;
  context.drawImage(image as CanvasImageSource, 0, 0);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** The pixels as an image of the same kind: raw data for raw data, a canvas otherwise. */
function writePixels(data: Uint8ClampedArray, width: number, height: number, like: TexImage): unknown {
  if (like.data) return { data: new Uint8Array(data.buffer), width, height };
  const context = canvas2d(width, height)!;
  context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return context.canvas;
}

function canvas2d(width: number, height: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (typeof document === 'undefined') return null;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Linear -> sRGB transfer curve, per channel (as three.js `LinearToSRGB`). */
function linearToSrgb(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055;
}

/**
 * The `treejs` object in the extras of the baked leaf and bark materials: the Material Feature
 * settings and the Crown Volume, for engines that rebuild the effects in their own shaders. The Crown
 * Volume is in the Baked Tree's space (scaled by its Growth, like the geometry). Null when the tree has
 * no Material Feature, so its glTF is as without them.
 */
export interface MaterialFeatureExtras {
  /** Crown Normals amount; the baked `NORMAL` already has them blended in. */
  crownNormals?: number;
  /** Leaf Translucency settings (also written as `KHR_materials_diffuse_transmission`). */
  translucency?: TranslucencyDefinition;
  occlusion?: {
    /** The Structural Occlusion strength the tree had. */
    strength: number;
    /**
     * Always true: the baked `_OCCLUSION` is final, `mix(1, aOcclusion, strength)`, with the strength
     * already applied. Use it as AO as it is; do not apply `strength` again.
     */
    strengthApplied: true;
    /** Whether `COLOR_0` is also multiplied by `_OCCLUSION` (`occlusionInVertexColors`). */
    inVertexColors: boolean;
  };
  crown: CrownVolume;
}

function materialFeatureExtras(
  features: MaterialFeatures,
  crown: CrownVolume,
  growth: number,
  occlusionInVertexColors: boolean,
): MaterialFeatureExtras | null {
  const { crownNormals, translucency, occlusion } = features;
  if (!crownNormals && !translucency && !occlusion) return null;
  const scale = treeScale(growth);
  const { center, radii } = crown;
  return {
    ...(crownNormals ? { crownNormals } : {}),
    ...(translucency ? { translucency: { ...translucency } } : {}),
    ...(occlusion ? { occlusion: { strength: occlusion.strength, strengthApplied: true, inVertexColors: occlusionInVertexColors } } : {}),
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
    material.emissiveMap?.dispose();
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
