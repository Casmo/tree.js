import { UnsignedByteType, Vector4, type Camera, type Material, type MRTNode, type Node, type PassNode, type Scene } from 'three/webgpu';
import { mrt, output, pass, uniform } from 'three/tsl';

/** Name of the tree mask output in a pass's MRT (`scenePass.getTextureNode(TREE_MASK)`). */
export const TREE_MASK = 'treeMask';

/** The part of a tree a material draws. */
export type TreePart = 'bark' | 'leaves';

/**
 * Which tree part a material draws: 'bark' or 'leaves' for tree.js materials (and their clones),
 * `null` for anything else. Tree Effects only change the pixels drawn by these materials.
 */
export function treePartOf(material: Material | null | undefined): TreePart | null {
  const part: unknown = material?.userData.treePart;
  return part === 'bark' || part === 'leaves' ? part : null;
}

/**
 * TSL node: the tree mask value of the object being drawn, `vec4(tree, leaves, 0, 1)`: r = 1 on
 * tree pixels, g = 1 on leaf pixels, 0 elsewhere. A per-object uniform (decided from the drawn
 * material with {@link treePartOf}), so no tree material is changed and any scene object that is
 * not a tree writes 0. Use it as an MRT output, see {@link treeMaskMRT}.
 */
export const treeMask: Node<'vec4'> = uniform(new Vector4(0, 0, 0, 1)).onObjectUpdate((frame, self) => {
  const part = treePartOf(frame.material);
  self.value.set(part ? 1 : 0, part === 'leaves' ? 1 : 0, 0, 1);
  return undefined;
});

/**
 * The MRT output that renders the tree mask next to the colour. Merge it into the MRT of your own
 * scene pass: `scenePass.setMRT(mrt({ output, normal: normalView }).merge(treeMaskMRT()))`, then read
 * it with `scenePass.getTextureNode(TREE_MASK)`.
 */
export function treeMaskMRT(): MRTNode {
  const node = mrt({ [TREE_MASK]: treeMask });
  node.setClearColor(TREE_MASK, 0x000000, 0);
  return node;
}

/** What every Tree Effect reads: the scene colour and the tree mask (both screen-space nodes). */
export interface TreeEffectInput {
  /** Scene colour (linear, before tone mapping), e.g. `scenePass.getTextureNode('output')`. */
  color: Node<'vec4'>;
  /** Tree mask: r = tree, g = leaves (see {@link treeMask}), e.g. `scenePass.getTextureNode(TREE_MASK)`. */
  mask: Node<'vec4'>;
}

/** A scene pass that renders the colour and the tree mask, ready for the Tree Effects. */
export interface TreeEffectsPass extends TreeEffectInput {
  pass: PassNode;
}

/**
 * Creates `pass(scene, camera)` with MRT `{ output, treeMask }` and returns it with its colour and
 * mask texture nodes. If your pipeline already has a scene pass, merge {@link treeMaskMRT} into it instead.
 */
export function treeEffectsPass(scene: Scene, camera: Camera): TreeEffectsPass {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()));
  scenePass.getTexture(TREE_MASK).type = UnsignedByteType;
  return { pass: scenePass, color: scenePass.getTextureNode('output'), mask: scenePass.getTextureNode(TREE_MASK) };
}
