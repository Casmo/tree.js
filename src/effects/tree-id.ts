import { NearestFilter, NoColorSpace, RedIntegerFormat, UnsignedIntType, Vector2, type BufferAttribute, type MRTNode, type Node, type Object3D, type PassNode, type Renderer, type Texture } from 'three/webgpu';
import { mrt, select, uniform } from 'three/tsl';
import { instanceSlot } from '../forest/nodes';
import type { Forest, ForestTree, ForestVariant } from '../forest';
import type { Tree } from '../tree';
import { treePartOf } from './mask';

/** Name of the Tree ID output in a pass's MRT (`scenePass.getTextureNode(TREE_ID)`), see {@link treeIdMRT}. */
export const TREE_ID = 'treeId';

// The module-wide Tree ID registry (ADR 0009). Holds no strong references to trees. IDs are handed
// out on first use: by treeIdOf() or by the first draw with the Tree ID channel.
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
 * The current Tree ID of a Tree or a Forest tree, or `undefined` for a Forest tree that was removed.
 * IDs are handed out lazily, on first use: by this function or by the first draw with the Tree ID
 * channel, whichever comes first. So asking for a Tree's ID before it is drawn reserves it then
 * (and for a Forest tree the block of its Variant's current meshes). A Forest tree's ID is
 * frame-relative (see {@link treeFromId}).
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
 * Variant's mesh, instanced or drawing a Detail Level (the shader adds the tree's slot), 0 for
 * anything else.
 */
function drawnId(object: Object3D | null): number {
  for (let o = object; o; o = o.parent) {
    if ((o as Partial<Tree>).isTree) return idOfTree(o as Tree);
    const forest = o.parent as Partial<Forest> | null;
    if (forest?.isForest) {
      const variant = forest.variants!.find((v) => v.meshes.includes(o as never) || v.levels?.meshes.includes(o as never));
      if (variant) return blockOfVariant(variant).base;
    }
  }
  return 0;
}

/** The parts of three's WebGL2 fallback backend (`renderer.backend`) the Tree ID relies on; not public API. */
interface WebGLBackendInternals {
  isWebGLBackend?: boolean;
  gl?: WebGL2RenderingContext;
  has(object: object): boolean;
  get(object: object): { textureGPU?: WebGLTexture; glInternalFormat?: number };
}

/** The WebGL2 context when `renderer` runs on three's WebGL2 fallback, `undefined` on WebGPU. */
function webglOf(renderer: Renderer): { backend: WebGLBackendInternals; gl: WebGL2RenderingContext } | undefined {
  const backend = renderer.backend as unknown as WebGLBackendInternals;
  return backend.isWebGLBackend === true && backend.gl ? { backend, gl: backend.gl } : undefined;
}

/** Per Tree ID texture: a framebuffer with just that texture attached, to clear it on its own. */
const clearTargets = new WeakMap<Texture, { framebuffer: WebGLFramebuffer; attached: WebGLTexture | null }>();

/**
 * WebGL2 only (a no-op on WebGPU, which clears integer targets correctly): clears the Tree ID
 * texture to 0. three's WebGL2 fallback clears every colour attachment of a render target with
 * `clearBufferfv`, which is invalid for an integer target: the GL ignores it (logging one
 * `GL_INVALID_OPERATION` warning per frame in the console, from three's own clear, that we cannot
 * avoid without three changing its clear) and the IDs of the last frame would stay wherever nothing
 * is drawn now. So this clears the texture with `clearBufferuiv` through a framebuffer of its own,
 * restoring the GL bindings and state it touches, before the scene pass renders (see
 * {@link treeIdTexture}).
 *
 * Depends on three internals: `renderer.backend.gl` (the WebGL2 context) and
 * `renderer.backend.get(texture)` (`textureGPU`, `glInternalFormat`). A texture three has not
 * allocated yet is skipped: new GL storage starts at 0.
 */
function clearTreeIdTextureOnWebGL(renderer: Renderer, texture: Texture): void {
  const webgl = webglOf(renderer);
  if (!webgl || !webgl.backend.has(texture)) return;
  const { gl } = webgl;
  const { textureGPU, glInternalFormat } = webgl.backend.get(texture);
  if (!textureGPU || glInternalFormat !== gl.R32UI) return;

  let target = clearTargets.get(texture);
  if (!target) {
    const framebuffer = gl.createFramebuffer();
    target = { framebuffer, attached: null };
    clearTargets.set(texture, target);
    texture.addEventListener('dispose', () => {
      gl.deleteFramebuffer(framebuffer);
      clearTargets.delete(texture);
    });
  }
  const previous = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const scissor = gl.isEnabled(gl.SCISSOR_TEST);
  const mask = gl.getParameter(gl.COLOR_WRITEMASK) as [boolean, boolean, boolean, boolean];
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
  // three makes a new GL texture when the target is resized: attach the current one.
  if (target.attached !== textureGPU) {
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureGPU, 0);
    target.attached = textureGPU;
  }
  if (scissor) gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
  gl.colorMask(...mask);
  if (scissor) gl.enable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous);
}

const clearing = new WeakSet<PassNode>();

/**
 * Makes the scene pass clear its Tree ID texture (on WebGL2, see {@link clearTreeIdTextureOnWebGL})
 * right before it renders, every frame, also when nothing is drawn.
 */
function clearTreeIdsBeforeEachRender(scenePass: PassNode, texture: Texture): void {
  if (clearing.has(scenePass)) return;
  clearing.add(scenePass);
  const render = scenePass.updateBefore.bind(scenePass);
  scenePass.updateBefore = (frame) => {
    if (frame.renderer) clearTreeIdTextureOnWebGL(frame.renderer, texture);
    return render(frame);
  };
}

/**
 * TSL node: the Tree ID of the tree being drawn (`uint`), 0 for anything that is not a tree. A Tree
 * writes one ID for all its parts (wood, leaves, Fruit); a Forest tree writes its Variant's block
 * base + its slot, at every Detail Level (the instance index on the instanced meshes, the slot from
 * the level list on a Detail Level mesh). A per-object uniform decided from the drawn object, so no material is
 * changed. It ignores the outline's `selection`: every tree gets its ID.
 */
function createTreeId(): Node<'uint'> {
  const base = uniform(0, 'uint').onObjectUpdate((frame, node) => {
    node.value = treePartOf(frame.material) === null ? 0 : drawnId(frame.object);
    return undefined;
  });
  return select(base.equal(0), base, base.add(instanceSlot())) as Node<'uint'>;
}

/**
 * The MRT output that renders each tree's Tree ID ({@link createTreeId}) next to the colour, opt-in
 * next to {@link treeMaskMRT}. Merge it into the MRT of your own scene pass and always call
 * {@link treeIdTexture} on that pass afterwards:
 * `scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()).merge(treeIdMRT())); treeIdTexture(scenePass);`.
 * Note that this turns MSAA off on that scene pass (an integer target cannot be multisampled, see
 * {@link treeIdTexture}). Read IDs back with {@link readTreeId}, or in a shader with exact texel
 * loads (never filtered).
 */
export function treeIdMRT(): MRTNode {
  const node = mrt({ [TREE_ID]: createTreeId() });
  node.setClearColor(TREE_ID, 0x000000, 0);
  return node;
}

/**
 * Makes the Tree ID target of a scene pass ({@link treeIdMRT} merged into its MRT) one 32-bit
 * unsigned integer per pixel (`r32uint`, read without filtering) and returns its texture. Call it
 * once after `setMRT`, before the first render.
 *
 * **MSAA is turned off on this scene pass**: an integer target cannot be multisampled, and all the
 * targets of a pass share one sample count, so this sets `scenePass.options.samples = 0`, also with
 * an `antialias: true` renderer (the colour then has aliased edges unless you add FXAA/SMAA after
 * the pass). That is a hard constraint of WebGPU and WebGL2, not a choice of tree.js.
 *
 * On the WebGL2 fallback it also makes the pass clear the Tree ID target to 0 right before every
 * render (three cannot clear integer targets there), so a pixel where nothing is drawn reads 0.
 */
export function treeIdTexture(scenePass: PassNode): Texture {
  scenePass.options.samples = 0;
  const texture = scenePass.getTexture(TREE_ID);
  texture.format = RedIntegerFormat;
  texture.type = UnsignedIntType;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  clearTreeIdsBeforeEachRender(scenePass, texture);
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
  const flipY = webglOf(renderer) !== undefined;
  const data = await renderer.readRenderTargetPixelsAsync(target, px, flipY ? target.height - 1 - py : py, 1, 1, index);
  return Number(data[0] ?? 0);
}
