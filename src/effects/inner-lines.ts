import { Color, type Camera, type ColorRepresentation, type MRTNode, type Node } from 'three/webgpu';
import {
  abs,
  dot,
  float,
  max,
  mix,
  mrt,
  normalView,
  orthographicDepthToViewZ,
  packNormalToRGB,
  perspectiveDepthToViewZ,
  smoothstep,
  textureSize,
  uniform,
  unpackRGBToNormal,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';

/** Name of the view normal output in a pass's MRT (`scenePass.getTextureNode('normal')`), see {@link treeNormalMRT}. */
export const TREE_NORMAL = 'normal';

/**
 * The MRT output that renders view normals in the `'color'` encoding (`packNormalToRGB(normalView)`,
 * the same as `directionToColor`) to a target named `normal`, for Inner Lines. Merge it into the MRT
 * of your own scene pass and make the target RGBA8:
 * `scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()).merge(treeNormalMRT())); scenePass.getTexture('normal').type = UnsignedByteType;`.
 * If your pipeline already renders normals (GTAO, SSR), pass that texture as the `normal` input instead.
 */
export function treeNormalMRT(): MRTNode {
  return mrt({ [TREE_NORMAL]: packNormalToRGB(normalView) });
}

/** Inner Lines settings. */
export interface InnerLinesOptions {
  /** Line colour (default a dark green-brown). */
  color?: ColorRepresentation;
  /** How far apart (in pixels) the compared pixels are, which sets the line width (default 1). */
  thickness?: number;
  /** Opacity of the lines, 0..1 (default 1). */
  strength?: number;
  /** A line where the normals of neighbouring pixels differ by more than this, as 1 − dot (default 0.4). */
  normalThreshold?: number;
  /** A line where neighbouring pixels step away by more than this, as relative depth |Δz| / z (default 0.02). */
  depthThreshold?: number;
}

// Four sample directions around a pixel.
const DIRECTIONS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Tree Effect: ink lines inside the trees where the surface folds (normal edges) or steps away
 * from the viewer (depth edges), such as around each leaf clump. Only drawn on tree pixels (of
 * every tree, regardless of the outline's `selection`), and only from neighbours that are tree
 * pixels too: the silhouette is left to the outline. Needs the `depth`, `camera` and `normal` inputs
 * (`treeEffectsPass(scene, camera, null, { normal: true })` has them) and throws without them.
 */
export function innerLines(input: TreeEffectInput, options: InnerLinesOptions = {}): Node<'vec4'> {
  return liveInnerLines(input, options).node;
}

function required<T>(value: T | undefined, name: string, hint: string): T {
  if (value === undefined) throw new Error(`innerLines needs the \`${name}\` input: ${hint}`);
  return value;
}

/** {@link innerLines} with its settings as uniforms; the normal encoding is fixed when built. */
export function liveInnerLines(input: TreeEffectInput, options: InnerLinesOptions = {}): LiveTreeEffect<InnerLinesOptions> {
  const normal = required(input.normal, 'normal', "view normals, e.g. treeNormalMRT() or your own normal MRT (with `normalEncoding`)");
  const depth = required(input.depth, 'depth', "the scene pass's depth, scenePass.getTextureNode('depth')");
  const camera = required(input.camera, 'camera', 'the camera the scene pass renders with');

  const color = uniform(new Color());
  const thickness = uniform(0);
  const strength = uniform(0);
  const normalLow = uniform(0);
  const normalHigh = uniform(0);
  const depthLow = uniform(0);
  const depthHigh = uniform(0);
  const update = (o: InnerLinesOptions): void => {
    const n = o.normalThreshold ?? 0.4;
    const d = o.depthThreshold ?? 0.02;
    color.value.set(o.color ?? '#1d2a14');
    thickness.value = o.thickness ?? 1;
    strength.value = o.strength ?? 1;
    // A soft step around each threshold, so lines fade in rather than flicker.
    normalLow.value = n * 0.75;
    normalHigh.value = n * 1.25;
    depthLow.value = d * 0.5;
    depthHigh.value = d * 1.5;
  };
  update(options);

  const near = uniform(0).onRenderUpdate((_, self) => {
    self.value = (camera as Camera & { near: number }).near;
    return undefined;
  });
  const far = uniform(0).onRenderUpdate((_, self) => {
    self.value = (camera as Camera & { far: number }).far;
    return undefined;
  });
  const ortho = (camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
  const viewZ = (at: Node<'vec2'>): Node<'float'> => {
    const d = depth.sample(at).r;
    return (ortho ? orthographicDepthToViewZ(d, near, far) : perspectiveDepthToViewZ(d, near, far)) as Node<'float'>;
  };
  const direction = input.normalEncoding === 'direction';
  const normalAt = (at: Node<'vec2'>): Node<'vec3'> => {
    const n = normal.sample(at).rgb;
    return (direction ? n : unpackRGBToNormal(n)).normalize() as Node<'vec3'>;
  };

  const { mask } = input;
  const step = vec2(thickness).div(vec2(textureSize(mask) as unknown as Node<'ivec2'>));
  const centre = uv();
  const n0 = normalAt(centre);
  const z0 = viewZ(centre);
  let edge: Node<'float'> = float(0);
  for (const [x, y] of DIRECTIONS) {
    const at = centre.add(step.mul(vec2(x, y)));
    const normalEdge = smoothstep(normalLow, normalHigh, float(1).sub(dot(n0, normalAt(at))));
    const depthEdge = smoothstep(depthLow, depthHigh, abs(viewZ(at).sub(z0)).div(abs(z0)));
    // Only neighbours that are tree pixels count: the silhouette is the outline's.
    edge = max(edge, max(normalEdge, depthEdge).mul(mask.sample(at).r));
  }
  const line = edge.mul(mask.sample(centre).r).mul(strength);
  return { node: vec4(mix(input.color.rgb, color, line), input.color.a), update };
}
