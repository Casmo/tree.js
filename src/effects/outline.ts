import { Color, type Camera, type ColorRepresentation, type Node, type Object3D, type Scene } from 'three/webgpu';
import { color as tslColor, mix, uniform, vec4 } from 'three/tsl';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import type { TreeEffectInput } from './mask';

/** Tree outline settings. */
export interface TreeOutlineOptions {
  /** Line colour (default a dark green-brown). */
  color?: ColorRepresentation;
  /** Line thickness (default 1.5). */
  thickness?: number;
  /** Opacity of the line, 0..1 (default 1). */
  strength?: number;
}

/** What the outline draws around: the trees to select, seen from the scene's camera. */
export interface TreeOutlineTarget {
  scene: Scene;
  camera: Camera;
  /**
   * The selected tree objects (Trees, Forests or their meshes). Mutable: add or remove trees in
   * place. Objects that are not tree parts are outlined too, but the line is only drawn on tree pixels.
   */
  selectedObjects: Object3D[];
}

/**
 * Tree Effect: an outline along the silhouettes of the selected trees (three.js `OutlineNode`),
 * drawn on the inside of the silhouette so only tree pixels change.
 */
export function treeOutline(input: TreeEffectInput, target: TreeOutlineTarget, options: TreeOutlineOptions = {}): Node<'vec4'> {
  const { color = '#1d2a14', thickness = 1.5, strength = 1 } = options;
  const node = outline(target.scene, target.camera, {
    selectedObjects: target.selectedObjects,
    edgeThickness: uniform(thickness),
    downSampleRatio: 1,
  });
  const edge = node.visibleEdge.mul(4).clamp(0, 1).mul(strength).mul(input.mask.r);
  return vec4(mix(input.color.rgb, tslColor(new Color(color)), edge), input.color.a);
}
