import { UnsignedByteType, type Camera, type Object3D, type PassNode, type Scene } from 'three/webgpu';
import { mrt, output, pass } from 'three/tsl';
import { TREE_MASK, treeMaskMRT, type TreeEffectInput } from './mask';
import { TREE_ID, treeIdMRT, treeIdTexture } from './tree-id';

/**
 * The opt-in extra channels of a scene pass, next to the colour and the tree mask (which are always
 * there). Each one adds an MRT target, so leave them off unless an effect (or picking) needs them.
 */
export interface TreeEffectsChannels {
  /** The Tree ID target (`treeIdMRT`), for effects that tell trees apart and for picking. */
  treeId?: boolean;
}

/** A scene pass that renders the colour, the tree mask and the chosen channels, ready for the Tree Effects. */
export interface TreeEffectsPass extends TreeEffectInput {
  pass: PassNode;
}

/**
 * Creates `pass(scene, camera)` with MRT `{ output, treeMask }` (plus the opt-in `channels`, e.g.
 * `{ treeId: true }`) and returns it with the texture nodes of every target (and the depth) as the effects' inputs.
 * `selection`: the trees to outline (default `null` = all trees), see `createTreeMask`. If your
 * pipeline already has a scene pass, merge `treeMaskMRT` (and `treeIdMRT`) into it instead.
 */
export function treeEffectsPass(
  scene: Scene,
  camera: Camera,
  selection: readonly Object3D[] | null = null,
  channels: TreeEffectsChannels = {},
): TreeEffectsPass {
  const scenePass = pass(scene, camera);
  let outputs = mrt({ output }).merge(treeMaskMRT(selection));
  if (channels.treeId) outputs = outputs.merge(treeIdMRT());
  scenePass.setMRT(outputs);
  scenePass.getTexture(TREE_MASK).type = UnsignedByteType;
  const input: TreeEffectsPass = {
    pass: scenePass,
    color: scenePass.getTextureNode('output'),
    mask: scenePass.getTextureNode(TREE_MASK),
    depth: scenePass.getTextureNode('depth'),
  };
  if (channels.treeId) {
    treeIdTexture(scenePass);
    input.treeId = scenePass.getTextureNode(TREE_ID);
  }
  return input;
}
