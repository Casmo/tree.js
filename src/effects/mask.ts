import { Vector4, type Camera, type Material, type MRTNode, type Node, type Object3D, type TextureNode } from 'three/webgpu';
import { mrt, uniform } from 'three/tsl';

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
  /**
   * Tree ID texture (`r32uint`, see `treeIdMRT`), e.g. `scenePass.getTextureNode(TREE_ID)`; only
   * needed by effects that tell trees apart. Read it with exact texel loads, never filtered.
   */
  treeId?: TextureNode;
  /**
   * Scene depth texture, e.g. `scenePass.getTextureNode('depth')`; only needed by effects that
   * compare distances (the outline's `betweenTrees`, and Inner Lines with `camera`).
   */
  depth?: TextureNode;
  /** The camera the scene pass renders with (its near and far turn `depth` into view Z). */
  camera?: Camera;
  /**
   * View-space normal texture, e.g. `scenePass.getTextureNode('normal')` (see `treeNormalMRT`, or
   * your own normal MRT); only needed by Inner Lines. Encoded as `normalEncoding` says.
   */
  normal?: TextureNode;
  /**
   * How `normal` stores the view normal: `'color'` (default) = `directionToColor(normalView)`, as in
   * an RGBA8 target; `'direction'` = the normal itself, as in a float target.
   */
  normalEncoding?: 'color' | 'direction';
}
