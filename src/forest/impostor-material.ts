// The Impostor's draw side (ADR 0010): one card per tree turned to the camera, showing the baked
// frames nearest the view, lit through the baked normals. The TSL twins of octahedral.ts live here.
import { DoubleSide, type MeshStandardNodeMaterial, type Node, type Texture } from 'three/webgpu';
import {
  abs,
  and,
  cameraPosition,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  cross,
  dot,
  float,
  floor,
  max,
  min,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  select,
  texture,
  transformNormalToView,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { CrownVolume } from '../generator';
import { createShadedMaterial, paintsLeafMasses } from '../materials';
import { innerGlowPulse, leafGlowNode, veinGlowNode, type InnerGlowUniforms } from '../materials/enchanted';
import { paintGradient, PaintedNodeMaterial, softenLeafShadows, type LeafMassPaint } from '../materials/painted';
import { crownAt } from '../materials/crown-nodes';
import { applyLeafTranslucencyTerm } from '../materials/leaf-translucency-model';
import type { MaterialFeatureNodes } from '../materials/material-features';
import type { ShaderHookTarget } from '../materials/shader-hooks';
import { setTreeLeafMask } from '../effects/mask';
import { leafSeasonNode, seasonLeafColorNode } from '../season';
import { objectWindDirection, treeSwayOffset, type WindResponse, type WindSource } from '../wind';
import { SEASON_SHIFT_SCALE } from './impostor-season';
import { setWindMotion } from '../wind/motion';
import { instanceBurstFrame, instanceRotate, instanceState, levelTreePosition, levelVisible } from './nodes';
import type { Vec3 } from './octahedral';

/** Coverage (blended over the frames) from which an Impostor texel is drawn. */
const ALPHA_CUT = 0.5;
/** The smallest coverage values are divided by. */
const MIN_COVERAGE = 1e-4;

/** Where a Variant's frames are: the tree's centre and the half size of each frame (tree space, Growth 1). */
export interface ImpostorBounds {
  center: Vec3;
  /** Half the width of a frame's picture and of the card (the tree's bounding radius plus a margin). */
  half: number;
}

/** A Variant's baked atlases, one texture per channel (by name, see `ImpostorChannel`), frames × frames frames each. */
export interface ImpostorAtlases {
  frames: number;
  bounds: ImpostorBounds;
  textures: Readonly<Record<string, Texture>>;
}

/** Column `i` of a mat4 node. */
function column(matrix: unknown, i: number): Node<'vec4'> {
  return (matrix as { element(i: number): Node<'vec4'> }).element(i);
}

/** TSL twin of `octahedralEncode`. */
function encode(d: Node<'vec3'>): Node<'vec2'> {
  const y = max(d.y, 0);
  const s = abs(d.x).add(y).add(abs(d.z));
  const px = d.x.div(s);
  const pz = d.z.div(s);
  return vec2(px.add(pz).add(1), px.sub(pz).add(1)).mul(0.5);
}

/** TSL twin of `octahedralDecode`. */
function decode(uv: Node<'vec2'>): Node<'vec3'> {
  const a = uv.x.mul(2).sub(1);
  const b = uv.y.mul(2).sub(1);
  const px = a.add(b).mul(0.5);
  const pz = a.sub(b).mul(0.5);
  return vec3(px, float(1).sub(abs(px)).sub(abs(pz)), pz).normalize();
}

/** TSL twin of `frameBasis` (right and up; forward is the input). */
function basis(forward: Node<'vec3'>): { right: Node<'vec3'>; up: Node<'vec3'> } {
  const reference = select(abs(forward.y).greaterThan(0.999), vec3(0, 0, -1), vec3(0, 1, 0));
  const right = cross(reference, forward).normalize();
  return { right, up: cross(forward, right) };
}

/** TSL twin of `frameUv`. */
function frameUv(point: Node<'vec3'>, view: Node<'vec3'>, forward: Node<'vec3'>, half: number): Node<'vec2'> {
  const t = dot(point, forward).div(max(dot(view, forward), 1e-3));
  const hit = point.sub(view.mul(t));
  const { right, up } = basis(forward);
  return vec2(dot(hit, right), dot(hit, up)).div(2 * half).add(0.5);
}

/** The (i, j) offsets of the four blended frames, in `blendFrames` order. */
const OFFSETS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

/** One of the (up to) four frames blended at a fragment. */
export interface ImpostorFrame {
  /** A channel's atlas texel in this frame, as baked (premultiplied by coverage; 0 outside the frame's picture). */
  sample(channel: string): Node<'vec4'>;
}

/**
 * The card of an Impostor tree and what it shows (built for a Detail Level mesh: the tree comes from
 * the level list). Everything here is per tree and per camera, so shadow passes see the card and
 * the frames turned to the light.
 */
export interface ImpostorView {
  /** The card's vertex in forest space (`positionNode`). */
  position: Node<'vec3'>;
  /** The Wind displacement of the card's vertex in forest space (null without Wind). */
  sway: Node<'vec3'> | null;
  /** The card pushed back from the viewer by its half size (`castShadowPositionNode`), so it does not shadow itself. */
  shadowPosition: Node<'vec3'>;
  /** Coverage of this fragment (0..1), blended over the frames. */
  coverage: Node<'float'>;
  /**
   * With `sway`: where the card's vertex was at Wind time `previous` relative to `position` (forest
   * space), for Wind-aware velocity (ADR 0011).
   */
  windShift?: (previous: Node<'float'>) => Node<'vec3'>;
  /**
   * Blends `perFrame` over the frames by their weights. Decode per frame what does not blend
   * linearly (a colour that depends on the leaf flag, Season ranks); `perFrame` gets premultiplied
   * samples and should return a premultiplied value.
   */
  blend(perFrame: (frame: ImpostorFrame) => Node<'vec4'>): Node<'vec4'>;
  /** A channel blended over the frames, divided by the coverage (for values that blend linearly). */
  value(channel: string): Node<'vec4'>;
}

/**
 * Builds the card and the frame blend. In the vertex stage: the direction to the camera (or, for
 * an orthographic camera such as a sun's shadow camera, its forward axis) in tree space, the card
 * across it, the four nearest frames and where each pictured the card's vertex (`frameUv`). In the
 * fragment stage: the atlases sampled in those frames and blended bilinearly.
 *
 * `sway`: a displacement (tree space) of a card point at its tree-space position (the Wind) at Wind
 * time `time` (default the Wind's clock); the pictures move with the card.
 */
export function impostorView(atlases: ImpostorAtlases, sway?: (point: Node<'vec3'>, time?: Node<'float'>) => Node<'vec3'>): ImpostorView {
  const { frames, bounds } = atlases;
  const { half } = bounds;
  const center = vec3(...bounds.center);
  const { scale } = instanceState();
  const base = levelTreePosition();
  const centerForest = base.add(instanceRotate(center).mul(scale));

  // The direction to the viewer, in forest (= the card's object) space, then in tree space.
  const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const axis = modelWorldMatrixInverse.mul(vec4(column(cameraWorldMatrix, 2).xyz, 0)).xyz;
  const orthographic = column(cameraProjectionMatrix, 3).w.greaterThan(0.5);
  const viewForest = select(orthographic, axis, eye.sub(centerForest)).normalize();
  const view = instanceRotate(viewForest, true).normalize();

  // The card, across the view (corners of positionGeometry at ±1).
  const card = basis(view);
  const point = card.right.mul(positionGeometry.x).add(card.up.mul(positionGeometry.y)).mul(half);
  const treePoint = center.add(point);
  const swayed = sway?.(treePoint);
  const position = base.add(instanceRotate(swayed ? treePoint.add(swayed) : treePoint).mul(scale));
  const swayForest = swayed ? instanceRotate(swayed).mul(scale) : null;
  const shadowPosition = position.sub(viewForest.mul(half).mul(scale));

  // The frames around the view (`blendFrames`) and where each one pictured this vertex.
  const g = encode(view).mul(frames).sub(0.5).clamp(0, frames - 1);
  const cell = min(floor(g), Math.max(frames - 2, 0));
  const blendVarying = varying(vec4(cell, g.sub(cell)));
  const frameOf = (k: number) => min(blendVarying.xy.add(vec2(...OFFSETS[k]!)), frames - 1);
  const vertexFrame = (k: number) => min(cell.add(vec2(...OFFSETS[k]!)), frames - 1);
  const local = OFFSETS.map((_, k) => frameUv(point, view, decode(vertexFrame(k).add(0.5).div(frames)), half));
  const locals = [varying(vec4(local[0]!, local[1]!)), varying(vec4(local[2]!, local[3]!))];
  const fx = blendVarying.z;
  const fy = blendVarying.w;
  const weights = [float(1).sub(fx).mul(float(1).sub(fy)), fx.mul(float(1).sub(fy)), float(1).sub(fx).mul(fy), fx.mul(fy)];

  const frameSamplers: ImpostorFrame[] = OFFSETS.map((_, k) => {
    const uv = k % 2 === 0 ? locals[k >> 1]!.xy : locals[k >> 1]!.zw;
    // Only inside the frame: the neighbouring frames' pictures are other directions.
    const inside = and(uv.greaterThanEqual(vec2(0)).all(), uv.lessThanEqual(vec2(1)).all());
    const atlasUv = frameOf(k).add(uv.clamp(0, 1)).div(frames);
    // three samples a render target top row first (v = 0 is the bake camera's top, y = 1).
    const flipped = vec2(atlasUv.x, float(1).sub(atlasUv.y));
    const samples = new Map<string, Node<'vec4'>>();
    return {
      sample(channel) {
        let value = samples.get(channel);
        if (!value) {
          const atlas = atlases.textures[channel];
          if (!atlas) throw new Error(`No Impostor atlas "${channel}"`);
          value = select(inside, texture(atlas, flipped), vec4(0));
          samples.set(channel, value);
        }
        return value;
      },
    };
  });
  const blend = (perFrame: (frame: ImpostorFrame) => Node<'vec4'>): Node<'vec4'> =>
    frameSamplers.reduce<Node<'vec4'>>((sum, frame, k) => sum.add(perFrame(frame).mul(weights[k]!)), vec4(0));
  const values = new Map<string, Node<'vec4'>>();
  const blended = (channel: string): Node<'vec4'> => {
    let value = values.get(channel);
    if (!value) {
      value = blend((frame) => frame.sample(channel));
      values.set(channel, value);
    }
    return value;
  };
  const coverage = blended(COLOR_CHANNEL).a;
  return {
    position,
    sway: swayForest,
    shadowPosition,
    coverage,
    ...(sway && swayed ? { windShift: (previous: Node<'float'>) => instanceRotate(sway(treePoint, previous).sub(swayed)).mul(scale) } : {}),
    blend,
    value: (channel) => blended(channel).div(max(coverage, MIN_COVERAGE)),
  };
}

/**
 * The paint atlas (only baked for painted Leaf Masses, `paintsLeafMasses`): r = the leaf's place on the crown
 * gradient before light (`LeafMassPaint.shade`, encoded), g = its mass's random number, b = its gap
 * darkening, a = 1 on painted leaves, 0 on wood. The card paints its leaf texels at draw time from these and
 * the Season colour.
 */
export const PAINT_CHANNEL = 'paint';

/** The paint atlas texel the bake writes for a Leaf Mass fragment (shade -1..1 into 0..1). */
export function paintTexel(paint: LeafMassPaint): Node<'vec4'> {
  return vec4(paint.shade.mul(0.5).add(0.5).clamp(0, 1), paint.mass, paint.gap, 1);
}

/** The colour atlas: the MRT `output` (rgb = colour, a = coverage). */
export const COLOR_CHANNEL = 'output';
/** The normal atlas: rgb = tree-space normal (encoded 0..1), a = 1 on leaves, 0 on wood. */
export const NORMAL_CHANNEL = 'normal';
/** The Season atlas (`encodeSeasonTexel`): r = leaf timing shift, g = coverage rank, b = blossom rank, a = 1 on leaves. */
export const SEASON_CHANNEL = 'season';
/** The wood layer's colour atlas: the wood alone (rgb = colour, a = coverage), shown where leaves have dropped. */
export const WOOD_COLOR_CHANNEL = 'woodOutput';
/** The wood layer's normal atlas (as `NORMAL_CHANNEL`, a = 0). */
export const WOOD_NORMAL_CHANNEL = 'woodNormal';

/**
 * The Inner Glow atlas (only baked for a tree with an Inner Glow, enchanted shading): r = how much of its
 * glow a leaf shows where it sits in the Crown Volume (`crownEdgeGlow`; 0 on wood), g = the bark's vein
 * mask (0 on leaves). The card glows from these, its drawn colour and the Season leaf colour.
 */
export const GLOW_CHANNEL = 'glow';
/** The wood layer's Inner Glow atlas (as `GLOW_CHANNEL`, wood only). */
export const WOOD_GLOW_CHANNEL = 'woodGlow';

/** The glow atlas texel the bake writes: the leaf's crown edge glow and the bark's vein mask. */
export function glowTexel(edge: Node<'float'>, veins: Node<'float'>): Node<'vec4'> {
  return vec4(edge, veins, 0, 1);
}

/**
 * The Material Feature atlas (only baked when a Material Feature is on, ADR 0008): rgb = the pictured
 * point in tree space (Growth 1, encoded over the frame's box, see `featureTexel`), from which the card
 * measures the Crown Volume (Crown Normals, Leaf Translucency); a = the raw Structural Occlusion
 * (`aOcclusion`, 0 when that feature is off).
 */
export const FEATURES_CHANNEL = 'features';

/** The Material Feature atlas texel the bake writes for a tree-space `point` and raw `occlusion`. */
export function featureTexel(point: Node<'vec3'>, occlusion: Node<'float'>, bounds: ImpostorBounds): Node<'vec4'> {
  return vec4(point.sub(vec3(...bounds.center)).div(2 * bounds.half).add(0.5), occlusion);
}

/** Inverse of `featureTexel` for the point (a texel already divided by the coverage). */
function featurePoint(texel: Node<'vec4'>, bounds: ImpostorBounds): Node<'vec3'> {
  return texel.xyz.sub(0.5).mul(2 * bounds.half).add(vec3(...bounds.center));
}

/** The Material Features an Impostor applies: the Forest's live values and the Variant's Crown Volume. */
export interface ImpostorFeatures {
  nodes: MaterialFeatureNodes;
  crown: CrownVolume;
}

/** Whether any Material Feature is on (then the Impostor bakes and reads `FEATURES_CHANNEL`). */
export function hasImpostorFeatures(features: ImpostorFeatures | null | undefined): features is ImpostorFeatures {
  const nodes = features?.nodes;
  return !!nodes && (nodes.crownNormals !== null || nodes.translucency !== null || nodes.occlusion !== null);
}

/**
 * The material of a Variant's Impostor cards: the Definition's shading (smooth: the baked normals
 * carry the shape), the baked colour with each leaf texel in the Season Profile at the tree's Season
 * plus the leaf's own timing shift (colour, blossom; a dropped leaf shows the wood layer behind it,
 * or nothing), the baked normal turned with the tree, bark or leaf roughness, cut out by the coverage
 * and the Detail Level cross-fade (in the shadow pass too, so the shadow is tree-shaped). With
 * `wind`, the card bends with height as the tree sways, in the tree's own Wind phase. With `glow` (the
 * Variant's Inner Glow strengths) the card glows as the tree does, from the glow atlases.
 */
export function createImpostorMaterial(
  definition: TreeDefinition,
  atlases: ImpostorAtlases,
  features: ImpostorFeatures | null = null,
  wind?: { source: WindSource; response: WindResponse },
  glow: InnerGlowUniforms | null = null,
): MeshStandardNodeMaterial {
  const burst = wind && instanceBurstFrame();
  const sway = wind
    ? (point: Node<'vec3'>, time?: Node<'float'>) =>
        treeSwayOffset(wind.source, wind.response, point, {
          direction: instanceRotate(objectWindDirection(wind.source), true),
          phase: instanceState().windPhase,
          time,
          burst,
        })
    : undefined;
  const view = impostorView(atlases, sway);
  const material = createShadedMaterial(definition.materials.shading);
  material.name = 'tree.js impostor';
  material.flatShading = false;
  // The card always faces the camera; both sides so the shadow pass (which flips FrontSide) keeps it.
  material.side = DoubleSide;
  material.positionNode = view.position;
  // Wind-aware velocity (ADR 0011): the card's sway, bursts included, at the previous Wind time.
  if (wind && view.windShift) setWindMotion(view.position, { source: wind.source, shift: view.windShift });
  material.castShadowPositionNode = view.shadowPosition;

  // Per frame (frames blend wood and leaf texels, and leaves of different timing): each leaf texel at
  // its own Season. A dropped leaf gives way to the wood layer.
  const treeSeason = varying(instanceState().season) as Node<'float'>;
  const leafSeason = leafSeasonNode(definition.season);
  const maxShift = definition.variation.season;
  const glows = glow !== null && GLOW_CHANNEL in atlases.textures;
  const frameStates = new Map<ImpostorFrame, { color: Node<'vec4'>; normal: Node<'vec4'>; glow: Node<'vec4'> | null }>();
  const frameState = (frame: ImpostorFrame) => {
    let state = frameStates.get(frame);
    if (!state) {
      const texel = frame.sample(COLOR_CHANNEL);
      const normal = frame.sample(NORMAL_CHANNEL);
      const flag = normal.a.div(max(texel.a, MIN_COVERAGE)).clamp(0, 1);
      const season = frame.sample(SEASON_CHANNEL);
      const leaves = max(season.a, MIN_COVERAGE);
      // No leaf is shifted beyond the Definition's Season variation: that bounds the 8-bit error of
      // texels with little leaf in them (the shift is premultiplied by the leaf share).
      const shift = season.r.div(leaves).sub(0.5).div(SEASON_SHIFT_SCALE).clamp(-maxShift, maxShift);
      const part = vec3(shift, season.g.div(leaves).clamp(0, 1), season.b.div(leaves).clamp(0, 1));
      const leaf = leafSeason(treeSeason, part);
      // How much of the texel is leaves that are not shown now: that share is the wood layer's.
      const dropped = flag.mul(select(leaf.shown, float(0), float(1))).toVar();
      const shown = vec4(texel.rgb.mul(mix(vec3(1), leaf.color, flag)), texel.a);
      state = {
        color: mix(shown, frame.sample(WOOD_COLOR_CHANNEL), dropped),
        normal: mix(normal, frame.sample(WOOD_NORMAL_CHANNEL), dropped),
        glow: glows ? mix(frame.sample(GLOW_CHANNEL), frame.sample(WOOD_GLOW_CHANNEL), dropped) : null,
      };
      frameStates.set(frame, state);
    }
    return state;
  };
  const color = view.blend((frame) => frameState(frame).color);
  const normal = view.blend((frame) => frameState(frame).normal);
  const coverage = color.a;
  const covered = max(coverage, MIN_COVERAGE);
  material.colorNode = color.rgb.div(covered);
  const leaf = normal.a.div(covered).clamp(0, 1);
  const treeNormal = normal.rgb.div(covered).mul(2).sub(1).normalize();
  material.normalNode = transformNormalToView(instanceRotate(treeNormal)).normalize();
  material.roughnessNode = mix(float(definition.materials.bark.roughness), float(definition.materials.leaf.roughness), leaf);
  material.metalness = 0;
  material.maskNode = and(coverage.greaterThan(ALPHA_CUT), levelVisible());
  // Painted Leaf Masses: leaf texels painted on the crown gradient as on the tree (wood warmed as bark is).
  if (material instanceof PaintedNodeMaterial && paintsLeafMasses(definition)) paintImpostor(material, view, leaf);
  // Material Features: on a dropped leaf's texel the wood shows, and `leaf` (from the wood layer's flag) turns the leaf-only ones off there.
  if (hasImpostorFeatures(features)) applyImpostorFeatures(material, view, atlases.bounds, leaf, features);
  // Inner Glow: as on the tree, leaves in their own (drawn) colour, strongest at the crown's edge, and bark
  // veins in the Season leaf colour, pulsing in each tree's own Wind phase with the Variant's strengths.
  if (glows) {
    const texel = view.blend((frame) => frameState(frame).glow!).div(covered);
    const pulse = innerGlowPulse(wind ? wind.source.uniforms.time : float(0), varying(instanceState().windPhase) as Node<'float'>);
    const leafGlow = leafGlowNode(glow, texel.r);
    const veinGlow = veinGlowNode(glow, seasonLeafColorNode(definition.season, treeSeason) as Node<'vec3'>, texel.g);
    material.emissiveNode = leafGlow.add(veinGlow).mul(pulse);
  }
  // Tree Effects: tree pixels, leaves where the (Season-aware) leaf flag says so (wood elsewhere).
  material.userData.treePart = 'leaves';
  setTreeLeafMask(material, leaf);
  hookTargets.set(material, {
    material,
    // No Fruit on an Impostor: its bark and leaf texels, by the (Season-aware) leaf flag.
    parts: ['bark', 'leaves'],
    partWeight: (part) => (part === 'leaves' ? leaf : float(1).sub(leaf)),
    vertexColors: false,
    season: treeSeason,
    growth: varying(instanceState().growth) as Node<'float'>,
    treePosition: varying(modelWorldMatrix.mul(vec4(levelTreePosition(), 1)).xyz) as Node<'vec3'>,
    sway: view.sway,
  });
  return material;
}

/**
 * Paints an Impostor of painted Leaf Masses: its leaf texels (`leaf`, the Season-aware leaf flag) on the
 * crown gradient from the baked paint atlas and the drawn Season colour, lit through the baked lighting normal (bent towards the mass),
 * with received shadows softened as on the tree's leaves.
 */
function paintImpostor(material: PaintedNodeMaterial, view: ImpostorView, leaf: Node<'float'>): void {
  const texel = view.blend((frame) => frame.sample(PAINT_CHANNEL));
  const painted = max(texel.a, MIN_COVERAGE);
  const paint = { shade: texel.r.div(painted).mul(2).sub(1), mass: texel.g.div(painted), gap: texel.b.div(painted) };
  material.paint = (base, lit) => paintGradient(base, lit, paint);
  material.paintAmount = leaf;
  softenLeafShadows(material, leaf);
}

const hookTargets = new WeakMap<MeshStandardNodeMaterial, ShaderHookTarget>();

/**
 * What Tree Shader Hooks shade on an Impostor card (ADR 0012): its baked colour, leaf flag and normal at
 * draw time, so hooks follow live settings without a rebake.
 */
export function impostorHookTarget(material: MeshStandardNodeMaterial): ShaderHookTarget {
  const target = hookTargets.get(material);
  if (!target) throw new Error('Not an Impostor material');
  return target;
}

/**
 * Material Features on an Impostor card, as on the tree's own materials (same uniforms, so live tuning
 * needs no rebake): the Crown Volume is measured at the point each texel pictured. Crown Normals and
 * Leaf Translucency act on leaf texels only (by the baked leaf flag); Structural Occlusion on all.
 */
function applyImpostorFeatures(
  material: MeshStandardNodeMaterial,
  view: ImpostorView,
  bounds: ImpostorBounds,
  leaf: Node<'float'>,
  features: ImpostorFeatures,
): void {
  const { nodes } = features;
  const texel = view.value(FEATURES_CHANNEL);
  const crown = crownAt(features.crown, featurePoint(texel, bounds));
  if (nodes.crownNormals) {
    const own = material.normalNode as Node<'vec3'>;
    const crownView = transformNormalToView(instanceRotate(crown.normal)).normalize();
    const blend = mix(own, crownView, nodes.crownNormals.mul(leaf));
    material.normalNode = select(blend.length().greaterThan(1e-4), blend.normalize(), crownView);
  }
  if (nodes.translucency) {
    const { strength, edge, ambient } = nodes.translucency;
    applyLeafTranslucencyTerm(material, { strength: strength.mul(leaf), ambient: ambient.mul(leaf), edge, thinness: crown.distance.clamp(0, 1) });
  }
  if (nodes.occlusion) material.aoNode = mix(float(1), texel.w, nodes.occlusion);
}
