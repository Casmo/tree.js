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
import { createShadedMaterial } from '../materials';
import { leafSeasonNode } from '../season';
import { objectWindDirection, treeSwayOffset, type WindResponse, type WindSource } from '../wind';
import { SEASON_SHIFT_SCALE } from './impostor-season';
import { instanceRotate, instanceState, levelTreePosition, levelVisible } from './nodes';
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
  /** The card pushed back from the viewer by its half size (`castShadowPositionNode`), so it does not shadow itself. */
  shadowPosition: Node<'vec3'>;
  /** Coverage of this fragment (0..1), blended over the frames. */
  coverage: Node<'float'>;
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
 * `sway`: a displacement (tree space) of a card point at its tree-space position (the Wind); the
 * pictures move with the card.
 */
export function impostorView(atlases: ImpostorAtlases, sway?: (point: Node<'vec3'>) => Node<'vec3'>): ImpostorView {
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
  const position = base.add(instanceRotate(sway ? treePoint.add(sway(treePoint)) : treePoint).mul(scale));
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
    shadowPosition,
    coverage,
    blend,
    value: (channel) => blended(channel).div(max(coverage, MIN_COVERAGE)),
  };
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
 * The material of a Variant's Impostor cards: the Definition's shading (smooth: the baked normals
 * carry the shape), the baked colour with each leaf texel in the Season Profile at the tree's Season
 * plus the leaf's own timing shift (colour, blossom; a dropped leaf shows the wood layer behind it,
 * or nothing), the baked normal turned with the tree, bark or leaf roughness, cut out by the coverage
 * and the Detail Level cross-fade (in the shadow pass too, so the shadow is tree-shaped). With
 * `wind`, the card bends with height as the tree sways, in the tree's own Wind phase.
 */
export function createImpostorMaterial(
  definition: TreeDefinition,
  atlases: ImpostorAtlases,
  wind?: { source: WindSource; response: WindResponse },
): MeshStandardNodeMaterial {
  const sway = wind
    ? (point: Node<'vec3'>) =>
        treeSwayOffset(wind.source, wind.response, point, {
          direction: instanceRotate(objectWindDirection(wind.source), true),
          phase: instanceState().windPhase,
        })
    : undefined;
  const view = impostorView(atlases, sway);
  const material = createShadedMaterial(definition.materials.shading);
  material.name = 'tree.js impostor';
  material.flatShading = false;
  // The card always faces the camera; both sides so the shadow pass (which flips FrontSide) keeps it.
  material.side = DoubleSide;
  material.positionNode = view.position;
  material.castShadowPositionNode = view.shadowPosition;

  // Per frame (frames blend wood and leaf texels, and leaves of different timing): each leaf texel at
  // its own Season. A dropped leaf gives way to the wood layer.
  const treeSeason = varying(instanceState().season) as Node<'float'>;
  const leafSeason = leafSeasonNode(definition.season);
  const maxShift = definition.variation.season;
  const frameStates = new Map<ImpostorFrame, { color: Node<'vec4'>; normal: Node<'vec4'> }>();
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
  return material;
}
