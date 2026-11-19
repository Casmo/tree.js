import type { Camera, ContextNode, PassNode, Scene } from 'three/webgpu';
import { builtinAOContext, mrt, normalView, pass, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type GTAONode from 'three/addons/tsl/display/GTAONode.js';

/** Ambient occlusion (GTAO) settings (all optional; every one is a uniform or a per-frame value). */
export interface SceneAOOptions {
  /** How far around a pixel occluders are searched, in metres (default 1). */
  radius?: number;
  /** How strong the occlusion is (default 1; lower = lighter). */
  scale?: number;
  /** How thick occluders are assumed to be, in metres (default 1). */
  thickness?: number;
  /** How fast the occlusion falls off with distance (default 1). */
  distanceExponent?: number;
  /** How much occluders far from the pixel count (default 1). */
  distanceFallOff?: number;
  /** Samples per pixel (default 16; more = smoother and slower). */
  samples?: number;
  /** The AO buffer's size relative to the canvas (default 1; e.g. 0.5 for half resolution). */
  resolutionScale?: number;
}

/** What {@link sceneAO} returns: put the pre-pass and AO in your pipeline through the lighting context. */
export interface SceneAO {
  /** The depth + view-normal pre-pass (the scene drawn once more, before the scene pass). */
  prePass: PassNode;
  /** The GTAO node (its result: `node.getTextureNode()`). */
  node: GTAONode;
  /**
   * A built-in AO lighting context: set it as your scene pass's `contextNode`, so the AO only
   * darkens ambient (indirect) light, not direct sunlight.
   */
  context: ContextNode<unknown>;
}

/**
 * Scene Effect: ground-contact ambient occlusion (GTAO). Returns a depth + view-normal pre-pass,
 * GTAO on it and a lighting context; in your own pipeline set `scenePass.contextNode = context`.
 * The scene is drawn twice while AO is on.
 */
export function sceneAO(scene: Scene, camera: Camera, options: SceneAOOptions = {}): SceneAO {
  const { prePass, node, context } = liveSceneAO(scene, camera, options);
  return { prePass, node, context };
}

/** {@link sceneAO} with `update()` (numbers only) and `dispose()` (the pre-pass and the AO target). */
export function liveSceneAO(scene: Scene, camera: Camera, options: SceneAOOptions) {
  const prePass = pass(scene, camera);
  prePass.setMRT(mrt({ output: normalView }));
  const node = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
  const update = (o: SceneAOOptions): void => {
    node.radius.value = o.radius ?? 1;
    node.scale.value = o.scale ?? 1;
    node.thickness.value = o.thickness ?? 1;
    node.distanceExponent.value = o.distanceExponent ?? 1;
    node.distanceFallOff.value = o.distanceFallOff ?? 1;
    node.samples.value = o.samples ?? 16;
    node.resolutionScale = o.resolutionScale ?? 1;
  };
  update(options);
  const context = builtinAOContext(node.getTextureNode().sample(screenUV).r);
  return {
    prePass,
    node,
    context,
    update,
    dispose(): void {
      node.dispose();
      prePass.dispose();
    },
  };
}
