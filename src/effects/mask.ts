import {
  UnsignedByteType,
  Vector4,
  type Camera,
  type Material,
  type MRTNode,
  type Node,
  type Object3D,
  type PassNode,
  type Scene,
  type TextureNode,
} from 'three/webgpu';
import { mrt, output, pass, uniform } from 'three/tsl';

/** Name of the tree mask output in a pass's MRT (`scenePass.getTextureNode(TREE_MASK)`). */
export const TREE_MASK = 'treeMask';

/** The part of a tree a material draws. */
export type TreePart = 'bark' | 'leaves' | 'fruit';

/**
 * Which tree part a material draws: 'bark', 'leaves' or 'fruit' for tree.js materials (and their clones),
 * `null` for anything else. Tree Effects only change the pixels drawn by these materials.
 */
export function treePartOf(material: Material | null | undefined): TreePart | null {
  const part: unknown = material?.userData.treePart;
  return part === 'bark' || part === 'leaves' || part === 'fruit' ? part : null;
}

function isSelected(object: Object3D | null, selection: readonly Object3D[]): boolean {
  for (let o = object; o; o = o.parent) if (selection.includes(o)) return true;
  return false;
}

/**
 * TSL node: the tree mask value of the object being drawn, `vec4(tree, leaves, selected, 1)`:
 * r = 1 on tree pixels (bark, leaves and Fruit), g = 1 on leaf pixels, b = 1 on pixels of selected trees (the outline's
 * selection), 0 elsewhere. A per-object uniform decided from the drawn material
 * ({@link treePartOf}), so no tree material is changed and every other object writes 0.
 *
 * `selection`: the selected tree objects (Trees, Forests, any ancestor of tree meshes), read on
 * every draw, so it may be changed in place. `null` (default) selects every tree.
 */
export function createTreeMask(selection: readonly Object3D[] | null = null): Node<'vec4'> {
  return uniform(new Vector4(0, 0, 0, 1)).onObjectUpdate((frame, self) => {
    const part = treePartOf(frame.material);
    const selected = part !== null && (selection === null || isSelected(frame.object, selection));
    self.value.set(part ? 1 : 0, part === 'leaves' ? 1 : 0, selected ? 1 : 0, 1);
    return undefined;
  });
}

/**
 * The MRT output that renders the tree mask ({@link createTreeMask}) next to the colour. Merge it
 * into the MRT of your own scene pass: `scenePass.setMRT(mrt({ output, normal: normalView }).merge(treeMaskMRT()))`,
 * then read it with `scenePass.getTextureNode(TREE_MASK)`.
 */
export function treeMaskMRT(selection: readonly Object3D[] | null = null): MRTNode {
  const node = mrt({ [TREE_MASK]: createTreeMask(selection) });
  node.setClearColor(TREE_MASK, 0x000000, 0);
  return node;
}

/** What every Tree Effect reads: the scene colour and the tree mask (screen-space nodes). */
export interface TreeEffectInput {
  /** Scene colour (linear, before tone mapping), e.g. `scenePass.getTextureNode('output')`. */
  color: Node<'vec4'>;
  /** Tree mask texture (see {@link createTreeMask}), e.g. `scenePass.getTextureNode(TREE_MASK)`. */
  mask: TextureNode;
}

/** A scene pass that renders the colour and the tree mask, ready for the Tree Effects. */
export interface TreeEffectsPass extends TreeEffectInput {
  pass: PassNode;
}

/**
 * Creates `pass(scene, camera)` with MRT `{ output, treeMask }` and returns it with its colour and
 * mask texture nodes. `selection`: the trees to outline (default `null` = all trees), see
 * {@link createTreeMask}. If your pipeline already has a scene pass, merge {@link treeMaskMRT} into it instead.
 */
export function treeEffectsPass(scene: Scene, camera: Camera, selection: readonly Object3D[] | null = null): TreeEffectsPass {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output }).merge(treeMaskMRT(selection)));
  scenePass.getTexture(TREE_MASK).type = UnsignedByteType;
  return { pass: scenePass, color: scenePass.getTextureNode('output'), mask: scenePass.getTextureNode(TREE_MASK) };
}
