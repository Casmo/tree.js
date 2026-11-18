import { NearestFilter, NoColorSpace, RedIntegerFormat, UnsignedIntType, Vector2, type BufferAttribute, type MRTNode, type Node, type Object3D, type PassNode, type Renderer, type Texture } from 'three/webgpu';
import { instanceIndex, mrt, select, uniform } from 'three/tsl';
import type { Forest, ForestTree, ForestVariant } from '../forest';
import type { Tree } from '../tree';
import { treePartOf } from './mask';

/** Name of the Tree ID output in a pass's MRT (`scenePass.getTextureNode(TREE_ID)`), see {@link treeIdMRT}. */
export const TREE_ID = 'treeId';

// The module-wide Tree ID registry (ADR 0009). Holds no strong references to trees.
const MAX_ID = 0xffffffff;
let nextId = 1;
const treeIds = new WeakMap<Tree, number>();
const treesById = new Map<number, WeakRef<Tree>>();
const forgetTree = new FinalizationRegistry<number>((id) => treesById.delete(id));

/**
 * The IDs of one allocation of a Forest Variant's instanced meshes: `base + slot` for each slot
 * up to its capacity. A Variant that grows gets new meshes, and with them a new block.
 */
interface Block {
  base: number;
  capacity: number;
  variant: WeakRef<ForestVariant>;
  /** The instance matrix buffer the Variant's meshes shared when the block was reserved. */
  matrices: WeakRef<BufferAttribute>;
}
const blockOf = new WeakMap<BufferAttribute, Block>();
/** Every live block, by ascending `base`. */
const blocks: Block[] = [];
const forgetBlock = new FinalizationRegistry<Block>((block) => blocks.splice(blocks.indexOf(block), 1));

function reserve(count: number): number {
  if (nextId + count - 1 > MAX_ID) throw new RangeError('Tree IDs exhausted: more than 4294967295 handed out in this session');
  const base = nextId;
  nextId += count;
  return base;
}

function idOfTree(tree: Tree): number {
  let id = treeIds.get(tree);
  if (id === undefined) {
    id = reserve(1);
    treeIds.set(tree, id);
    treesById.set(id, new WeakRef(tree));
    forgetTree.register(tree, id);
  }
  return id;
}

/** Whether the Variant still draws with the meshes the block was reserved for. */
function isCurrent(block: Block, variant: ForestVariant): boolean {
  return variant.wood.instanceMatrix === block.matrices.deref() && variant.wood.parent !== null;
}

function blockOfVariant(variant: ForestVariant): Block {
  const matrices = variant.wood.instanceMatrix;
  let block = blockOf.get(matrices);
  if (!block) {
    block = { base: reserve(variant.capacity), capacity: variant.capacity, variant: new WeakRef(variant), matrices: new WeakRef(matrices) };
    blockOf.set(matrices, block);
    blocks.push(block);
    forgetBlock.register(matrices, block);
  }
  return block;
}

function blockAt(id: number): Block | undefined {
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid]!;
    if (id < block.base) hi = mid - 1;
    else if (id >= block.base + block.capacity) lo = mid + 1;
    else return block;
  }
  return undefined;
}

/**
 * The current Tree ID of a Tree or a Forest tree (handing one out if it has none yet), or
 * `undefined` for a Forest tree that was removed. A Forest tree's ID is frame-relative (see
 * {@link treeFromId}).
 */
export function treeIdOf(tree: Tree | ForestTree): number | undefined {
  if ('isTree' in tree) return idOfTree(tree);
  const variant = tree.owner;
  if (!variant || tree.slot < 0 || variant.wood.parent === null) return undefined;
  return blockOfVariant(variant).base + tree.slot;
}

/**
 * The Tree or Forest tree with this Tree ID, resolved against the current trees, or `undefined`
 * for 0 (not a tree), an unknown ID or a tree that is gone.
 */
export function treeFromId(id: number): Tree | ForestTree | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const tree = treesById.get(id)?.deref();
  if (tree) return tree;
  const block = blockAt(id);
  const variant = block?.variant.deref();
  if (!block || !variant || !isCurrent(block, variant)) return undefined;
  return variant.trees[id - block.base];
}

/**
 * The ID the drawn object writes: a Tree's ID for each of its parts, the block base of a Forest
 * Variant's mesh (the shader adds the instance index), 0 for anything else.
 */
function drawnId(object: Object3D | null): number {
  for (let o = object; o; o = o.parent) {
    if ((o as Partial<Tree>).isTree) return idOfTree(o as Tree);
    const forest = o.parent as Partial<Forest> | null;
    if (forest?.isForest) {
      const variant = forest.variants!.find((v) => v.meshes.includes(o as never));
      if (variant) return blockOfVariant(variant).base;
    }
  }
  return 0;
}

/**
 * three's WebGL2 fallback clears every MRT attachment with `clearBufferfv`, which is invalid for an
 * integer target: the Tree IDs of the last frame would stay where nothing is drawn now. So, on WebGL,
 * the first draw of each render clears the Tree ID attachment to 0 itself (after three's clear, before
 * anything is drawn). WebGPU clears it correctly.
 */
function clearForWebGL(renderer: Renderer): void {
  const backend = renderer.backend as unknown as { isWebGLBackend?: boolean; gl?: WebGL2RenderingContext };
  const gl = backend.isWebGLBackend ? backend.gl : undefined;
  const textures = renderer.getRenderTarget()?.textures;
  if (!gl || !textures) return;
  const index = textures.findIndex((t) => t.name === TREE_ID && t.format === RedIntegerFormat);
  if (index >= 0) gl.clearBufferuiv(gl.COLOR, index, [0, 0, 0, 0]);
}

/**
 * TSL node: the Tree ID of the tree being drawn (`uint`), 0 for anything that is not a tree. A Tree
 * writes one ID for all its parts (wood, leaves, Fruit); a Forest tree writes its Variant's block
 * base + its instance index. A per-object uniform decided from the drawn object, so no material is
 * changed. It ignores the outline's `selection`: every tree gets its ID.
 */
function createTreeId(): Node<'uint'> {
  let clearedRender = -1;
  const base = uniform(0, 'uint').onObjectUpdate((frame, self) => {
    if (frame.renderId !== clearedRender) {
      clearedRender = frame.renderId;
      if (frame.renderer) clearForWebGL(frame.renderer);
    }
    self.value = treePartOf(frame.material) === null ? 0 : drawnId(frame.object);
    return undefined;
  });
  return select(base.equal(0), base, base.add(instanceIndex)) as Node<'uint'>;
}

/**
 * The MRT output that renders each tree's Tree ID ({@link createTreeId}) next to the colour, opt-in
 * next to {@link treeMaskMRT}. Merge it into the MRT of your own scene pass and set its texture
 * format with {@link treeIdTexture}:
 * `scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()).merge(treeIdMRT())); treeIdTexture(scenePass);`.
 * Read IDs back with {@link readTreeId}, or in a shader with exact texel loads (never filtered).
 */
export function treeIdMRT(): MRTNode {
  const node = mrt({ [TREE_ID]: createTreeId() });
  node.setClearColor(TREE_ID, 0x000000, 0);
  return node;
}

/**
 * Makes the Tree ID target of a scene pass ({@link treeIdMRT} merged into its MRT) one 32-bit
 * unsigned integer per pixel (`r32uint`, read without filtering) and returns its texture. Call it
 * once after `setMRT`, before the first render. An integer target cannot be multisampled, so the
 * pass then renders without MSAA (`samples: 0`), also with an `antialias: true` renderer.
 */
export function treeIdTexture(scenePass: PassNode): Texture {
  scenePass.options.samples = 0;
  const texture = scenePass.getTexture(TREE_ID);
  texture.format = RedIntegerFormat;
  texture.type = UnsignedIntType;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  return texture;
}

/**
 * Reads the Tree ID under a point of the canvas from the last render of `scenePass` (with
 * {@link treeIdMRT} in its MRT): `x`, `y` in CSS pixels from the canvas's top left corner, as in
 * `event.offsetX/offsetY`. Resolves to 0 off the canvas or where no tree is drawn. Resolve the ID
 * with {@link treeFromId} right away: IDs are frame-relative.
 */
export async function readTreeId(renderer: Renderer, scenePass: PassNode, x: number, y: number): Promise<number> {
  const texture = scenePass.getTexture(TREE_ID);
  const target = scenePass.renderTarget;
  const index = target.textures.indexOf(texture);
  if (index < 0) throw new Error('readTreeId: the scene pass has no Tree ID target; merge treeIdMRT() into its MRT');
  const css = renderer.getSize(new Vector2());
  const px = Math.floor((x * target.width) / css.x);
  const py = Math.floor((y * target.height) / css.y);
  if (!(px >= 0 && py >= 0 && px < target.width && py < target.height)) return 0;
  // WebGL reads with the origin at the bottom left, WebGPU at the top left.
  const webgl = (renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true;
  const data = await renderer.readRenderTargetPixelsAsync(target, px, webgl ? target.height - 1 - py : py, 1, 1, index);
  return Number(data[0] ?? 0);
}
