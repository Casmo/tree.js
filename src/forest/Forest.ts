import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type MeshStandardNodeMaterial,
} from 'three/webgpu';
import { positionGeometry } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import { generateTree, trunkHeight, type GeometryBuffers, type TreeData } from '../generator';
import { createBarkMaterial, createFruitMaterial, createLeafMaterial } from '../materials';
import { applyStructuralOcclusion, setOcclusionStrength, type OcclusionStrengthUniform } from '../materials/occlusion';
import { assertWebGPURenderer } from '../renderer';
import { applySeasonToLeafMaterial, createFruitSeasonNodes, createSeasonNodes } from '../season';
import { checkedSeason } from '../season/check';
import { clampGrowth } from '../growth';
import { textureReady, type TextureOptions } from '../textures';
import { sceneWind, Wind, WindBinding, WindResponse, type WindSource } from '../wind';
import { INSTANCE_ATTRIBUTES, INSTANCE_STRIDE, forestPosition, instanceState } from './nodes';
import {
  delayedGrowth,
  forestTreeKey,
  forestTreeTraits,
  placementPosition,
  shiftedSeason,
  variantSeed,
  type ForestPlacement,
  type ForestTreeTraits,
} from './placement';

/** Options of {@link createForest}. */
export interface ForestOptions {
  /** How many Variants (distinct trees, each drawn instanced) the forest is made of. Default 4. */
  variants?: number;
  /** The forest seed: picks the Variants and every tree's Variant and offsets. Default 0. */
  seed?: number;
  /** Growth every tree starts at, 0..1. Default 1 (fully grown). */
  growth?: number;
  /** Season every tree starts at, 0..1. Default 0. */
  season?: number;
  /** The Wind the forest sways with. Default: the scene-wide `sceneWind`. */
  wind?: Wind;
  /** Where the Definition's textures load from (as `createTree(..., { textures })`). */
  textures?: TextureOptions;
}

/** What the GPU draws one tree with (after its offsets). */
export interface ForestInstanceState {
  growth: number;
  season: number;
  windPhase: number;
}

const MIN_CAPACITY = 16;
// Room for Wind sway in the instance bounding spheres (fraction of the trunk height).
const WIND_BOUNDS = 0.35;

/**
 * One tree of a {@link Forest}. Its Variant and offsets come from the forest seed and its key
 * only. `growth` and `season` are what the app sets on this tree; the tree draws them with its
 * offsets applied (see {@link Forest.instanceState}).
 */
export class ForestTree implements ForestTreeTraits {
  /** The tree's id as a string, or `@x,y,z` (position in mm) when it was placed without an id. */
  readonly key: string;
  readonly placement: Readonly<ForestPlacement>;
  readonly variant: number;
  readonly growthDelay: number;
  readonly seasonShift: number;
  readonly windPhase: number;
  /** @internal Slot in the Variant's instance buffers. */
  slot = -1;
  private growthValue: number;
  private seasonValue: number;

  /** @internal Use {@link Forest.addTree}. */
  constructor(
    key: string,
    placement: ForestPlacement,
    traits: ForestTreeTraits,
    state: { growth: number; season: number },
    private readonly onChange: (tree: ForestTree) => void,
  ) {
    this.key = key;
    this.placement = placement;
    this.variant = traits.variant;
    this.growthDelay = traits.growthDelay;
    this.seasonShift = traits.seasonShift;
    this.windPhase = traits.windPhase;
    this.growthValue = clampGrowth(state.growth);
    this.seasonValue = checkedSeason(state.season);
  }

  /** Growth set on this tree, 0..1 (clamped). Only rewrites this tree's instance data. */
  get growth(): number {
    return this.growthValue;
  }

  set growth(value: number) {
    this.growthValue = clampGrowth(value);
    this.onChange(this);
  }

  /** Season set on this tree, 0..1 (wraps around the year). Only rewrites this tree's instance data. */
  get season(): number {
    return this.seasonValue;
  }

  set season(value: number) {
    this.seasonValue = checkedSeason(value);
    this.onChange(this);
  }
}

/** Packs generator buffers into one interleaved vertex buffer, so a Variant takes a single vertex buffer slot. */
function interleavedGeometry(buffers: GeometryBuffers, boundsMargin: number): BufferGeometry {
  const parts: [string, Float32Array, number][] = [
    ['position', buffers.positions, 3],
    ['normal', buffers.normals, 3],
    ['uv', buffers.uvs, 2],
  ];
  if (buffers.colors) parts.push(['color', buffers.colors, 3]);
  for (const [name, { array, itemSize }] of Object.entries(buffers.attributes)) parts.push([name, array, itemSize]);

  const count = buffers.positions.length / 3;
  const stride = parts.reduce((sum, [, , size]) => sum + size, 0);
  const data = new Float32Array(count * stride);
  const interleaved = new InterleavedBuffer(data, stride);
  const geometry = new BufferGeometry();
  let offset = 0;
  for (const [name, array, size] of parts) {
    for (let v = 0; v < count; v++) {
      for (let c = 0; c < size; c++) data[v * stride + offset + c] = array[v * size + c]!;
    }
    geometry.setAttribute(name, new InterleavedBufferAttribute(interleaved, size, offset));
    offset += size;
  }
  geometry.setIndex(new BufferAttribute(buffers.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundingSphere!.radius += boundsMargin;
  geometry.boundingBox!.expandByScalar(boundsMargin);
  return geometry;
}

/** Copies a geometry's attributes into a new geometry (shares the vertex data). */
function shareGeometry(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.getIndex());
  geometry.boundingBox = source.boundingBox!.clone();
  geometry.boundingSphere = source.boundingSphere!.clone();
  return geometry;
}

/**
 * One Variant of a Forest: one Seed's tree, drawn once per tree that uses it with an instanced
 * wood mesh, an instanced leaf mesh and, when the Definition has Fruit, an instanced fruit mesh
 * (one draw call per material). All three share one instance matrix buffer.
 */
export class ForestVariant {
  readonly index: number;
  readonly seed: number;
  readonly data: TreeData;
  /** This Variant's response to the Wind (trunk height from its Seed; each tree has its own phase). */
  readonly windResponse: WindResponse;
  readonly barkMaterial: MeshStandardNodeMaterial;
  readonly leafMaterial: MeshStandardNodeMaterial;
  /** Fruit material, null when the Definition has no Fruit. */
  readonly fruitMaterial: MeshStandardNodeMaterial | null;
  /** The trees drawn as this Variant, in instance order. */
  readonly trees: ForestTree[] = [];
  private woodMesh!: InstancedMesh<BufferGeometry, MeshStandardNodeMaterial>;
  private leafMesh!: InstancedMesh<BufferGeometry, MeshStandardNodeMaterial>;
  private fruitMesh: InstancedMesh<BufferGeometry, MeshStandardNodeMaterial> | null = null;
  private instanceData!: InstancedInterleavedBuffer;
  private readonly woodSource: BufferGeometry;
  private readonly leafSource: BufferGeometry;
  private readonly fruitSource: BufferGeometry | null;

  constructor(
    private readonly forest: Forest,
    definition: TreeDefinition,
    index: number,
    seed: number,
    wind: WindSource,
    capacity: number,
    textures?: TextureOptions,
  ) {
    this.index = index;
    this.seed = seed;
    this.data = generateTree(definition, seed);
    const height = trunkHeight(this.data.skeleton);
    this.windResponse = new WindResponse(definition.wind, { height, phase: 0 });

    const position = forestPosition(wind, this.windResponse);
    this.barkMaterial = createBarkMaterial(definition, textures, instanceState().growth);
    this.barkMaterial.positionNode = position;
    this.leafMaterial = createLeafMaterial(definition, textures);
    this.leafMaterial.positionNode = position;
    applySeasonToLeafMaterial(this.leafMaterial, createSeasonNodes(definition.season, instanceState().season));

    this.woodSource = interleavedGeometry(this.data.wood, height * WIND_BOUNDS);
    this.leafSource = interleavedGeometry(this.data.leaves, height * WIND_BOUNDS);

    if (this.data.fruit.indices.length > 0) {
      // As on a Tree: Season scales each Fruit about its attachment point, then Growth and Wind.
      const fruitSeason = createFruitSeasonNodes(definition.season, instanceState().season, positionGeometry);
      this.fruitMaterial = createFruitMaterial(definition);
      this.fruitMaterial.colorNode = fruitSeason.color;
      this.fruitMaterial.positionNode = forestPosition(wind, this.windResponse, fruitSeason.position);
      this.fruitSource = interleavedGeometry(this.data.fruit, height * WIND_BOUNDS);
    } else {
      this.fruitMaterial = null;
      this.fruitSource = null;
    }
    this.allocate(capacity);
  }

  /** Instanced mesh of trunks and branches. Replaced (not resized) when the Variant outgrows its capacity. */
  get wood(): InstancedMesh<BufferGeometry, MeshStandardNodeMaterial> {
    return this.woodMesh;
  }

  /** Instanced mesh of the leaves. Replaced along with {@link wood}. */
  get leaves(): InstancedMesh<BufferGeometry, MeshStandardNodeMaterial> {
    return this.leafMesh;
  }

  /** Instanced mesh of the Fruit (null when the Definition has no Fruit). Replaced along with {@link wood}. */
  get fruit(): InstancedMesh<BufferGeometry, MeshStandardNodeMaterial> | null {
    return this.fruitMesh;
  }

  /** The Variant's meshes: wood, leaves and (with Fruit) fruit. */
  get meshes(): InstancedMesh<BufferGeometry, MeshStandardNodeMaterial>[] {
    return this.fruitMesh ? [this.woodMesh, this.leafMesh, this.fruitMesh] : [this.woodMesh, this.leafMesh];
  }

  get capacity(): number {
    return this.instanceData.count;
  }

  /** @internal */
  add(tree: ForestTree): void {
    if (this.trees.length === this.capacity) this.allocate(this.capacity * 2);
    tree.slot = this.trees.length;
    this.trees.push(tree);
    this.write(tree);
    this.setCount();
  }

  /** @internal Swap-removes a tree: the last tree takes its slot. */
  remove(tree: ForestTree): void {
    const last = this.trees.pop()!;
    if (last !== tree) {
      last.slot = tree.slot;
      this.trees[last.slot] = last;
      this.write(last);
    }
    tree.slot = -1;
    this.setCount();
  }

  /** @internal Writes one tree's transform and state into its instance slot. */
  write(tree: ForestTree): void {
    const i = tree.slot;
    const { placement } = tree;
    const position = new Vector3(...placementPosition(placement));
    const rotation = placement.rotation ?? 0;
    const quaternion = new Quaternion().setFromEuler(
      typeof rotation === 'number' ? new Euler(0, rotation, 0) : new Euler(rotation[0], rotation[1], rotation[2]),
    );
    const scale = placement.scale ?? 1;
    this.woodMesh.setMatrixAt(i, new Matrix4().compose(position, quaternion, new Vector3(scale, scale, scale)));
    this.woodMesh.instanceMatrix.needsUpdate = true;

    const array = this.instanceData.array as Float32Array;
    array.set(
      [
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
        scale,
        delayedGrowth(tree.growth, tree.growthDelay),
        shiftedSeason(tree.season, tree.seasonShift),
        tree.windPhase,
      ],
      i * INSTANCE_STRIDE,
    );
    this.instanceData.needsUpdate = true;
    for (const mesh of this.meshes) mesh.boundingSphere = mesh.boundingBox = null;
  }

  /** @internal */
  state(tree: ForestTree): ForestInstanceState {
    const o = tree.slot * INSTANCE_STRIDE;
    const array = this.instanceData.array as Float32Array;
    return { growth: array[o + 5]!, season: array[o + 6]!, windPhase: array[o + 7]! };
  }

  /** @internal Frees the GPU resources. */
  dispose(): void {
    this.disposeMeshes();
    this.woodSource.dispose();
    this.leafSource.dispose();
    this.fruitSource?.dispose();
    this.barkMaterial.dispose();
    this.leafMaterial.dispose();
    this.fruitMaterial?.dispose();
  }

  private setCount(): void {
    for (const mesh of this.meshes) mesh.count = this.trees.length;
  }

  /**
   * (Re)builds the instanced meshes with room for `capacity` trees. An InstancedMesh cannot grow,
   * so a full Variant gets new meshes (same materials and vertex data) of twice the size.
   */
  private allocate(capacity: number): void {
    const instanceData = new InstancedInterleavedBuffer(new Float32Array(capacity * INSTANCE_STRIDE), INSTANCE_STRIDE, 1);
    instanceData.setUsage(DynamicDrawUsage);
    const matrices = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    matrices.setUsage(DynamicDrawUsage);
    if (this.woodMesh) {
      instanceData.array.set(this.instanceData.array);
      matrices.array.set(this.woodMesh.instanceMatrix.array);
      this.disposeMeshes();
    }
    this.instanceData = instanceData;

    const mesh = (name: string, source: BufferGeometry, material: MeshStandardNodeMaterial) => {
      const geometry = shareGeometry(source);
      for (const [attribute, offset] of Object.entries(INSTANCE_ATTRIBUTES)) {
        geometry.setAttribute(attribute, new InterleavedBufferAttribute(instanceData, 4, offset));
      }
      const instanced = new InstancedMesh(geometry, material, capacity);
      instanced.instanceMatrix = matrices; // wood, leaves and fruit share one matrix buffer
      instanced.name = `${name} ${this.index}`;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.onBeforeRender = (renderer) => assertWebGPURenderer(renderer);
      return instanced;
    };
    this.woodMesh = mesh('forest wood', this.woodSource, this.barkMaterial);
    this.leafMesh = mesh('forest leaves', this.leafSource, this.leafMaterial);
    if (this.fruitSource && this.fruitMaterial) this.fruitMesh = mesh('forest fruit', this.fruitSource, this.fruitMaterial);
    this.setCount();
    this.forest.add(...this.meshes);
  }

  private disposeMeshes(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}

/**
 * Many trees of one Tree Definition, drawn from a few shared Variants (one instanced mesh per
 * Variant and material). Each tree's Variant and its small Growth/Season offsets come from a
 * hash of the forest seed and the tree's id (or position), never from its index, so adding or
 * removing trees never changes the others. Growth and Season can be set per tree or for all.
 */
export class Forest extends Group {
  readonly isForest = true;
  readonly definition: TreeDefinition;
  /** The forest seed. */
  readonly seed: number;
  readonly variants: readonly ForestVariant[];
  /** Resolves once every texture has loaded (at once without textures); rejects if one fails. */
  readonly ready: Promise<void>;
  private readonly byKey = new Map<string, ForestTree>();
  private readonly windBinding: WindBinding;
  private growthValue: number;
  private seasonValue: number;
  private readonly occlusion: OcclusionStrengthUniform | null;

  constructor(definition: TreeDefinition, placements: readonly ForestPlacement[] = [], options: ForestOptions = {}) {
    super();
    const count = options.variants ?? 4;
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`Forest variants must be an integer >= 1, got ${count}`);
    this.name = 'Forest';
    this.definition = definition;
    this.seed = options.seed ?? 0;
    this.windBinding = new WindBinding(options.wind ?? sceneWind);
    this.growthValue = clampGrowth(options.growth ?? 1);
    this.seasonValue = checkedSeason(options.season ?? 0);

    const capacity = Math.max(MIN_CAPACITY, 2 ** Math.ceil(Math.log2(Math.max(1, (placements.length / count) * 1.25))));
    this.variants = Array.from(
      { length: count },
      (_, i) => new ForestVariant(this, definition, i, variantSeed(this.seed, i), this.windBinding, capacity, options.textures),
    );
    // Structural Occlusion: one strength for the whole forest; each Variant has its own baked `aOcclusion`.
    this.occlusion = applyStructuralOcclusion(
      definition,
      this.variants.flatMap((v) => [v.barkMaterial, v.leafMaterial, v.fruitMaterial]),
    );
    const textures = this.variants.flatMap((v) => [v.barkMaterial.map, v.barkMaterial.normalMap, v.leafMaterial.map]);
    this.ready = Promise.all(textures.filter((t) => t !== null).map(textureReady)).then(() => undefined);
    this.ready.catch(() => {}); // only reported to whoever awaits it
    for (const placement of placements) this.addTree(placement);
  }

  /**
   * The Wind every tree of this forest sways with. Assigning another Wind only rebinds uniforms:
   * no rebuild, no recompile.
   */
  get wind(): Wind {
    return this.windBinding.wind;
  }

  set wind(value: Wind) {
    this.windBinding.wind = value;
  }

  /** Every tree, in the order they were added. */
  get trees(): readonly ForestTree[] {
    return [...this.byKey.values()];
  }

  /** Number of trees. */
  get size(): number {
    return this.byKey.size;
  }

  /** The tree with this key (its id as a string, or `ForestTree.key`). */
  get(key: string | number): ForestTree | undefined {
    return this.byKey.get(String(key));
  }

  /**
   * Plants a tree. Throws if a tree with the same id (or, without ids, the same position) exists.
   * It starts at the forest's current Growth and Season.
   */
  addTree(placement: ForestPlacement): ForestTree {
    const key = forestTreeKey(placement);
    if (this.byKey.has(key)) {
      throw new Error(
        placement.id !== undefined
          ? `Forest already has a tree with id "${placement.id}"`
          : `Forest already has a tree at position ${key.slice(1)} (mm); give the trees an id to place them on the same spot`,
      );
    }
    const traits = forestTreeTraits(this.seed, key, this.variants.length, this.definition.variation);
    const frozen = {
      ...placement,
      position: placementPosition(placement),
      rotation: Array.isArray(placement.rotation) ? [...(placement.rotation as number[])] : placement.rotation,
    } as ForestPlacement;
    const tree = new ForestTree(key, Object.freeze(frozen), traits, { growth: this.growthValue, season: this.seasonValue }, (t) =>
      this.variants[t.variant]!.write(t),
    );
    this.byKey.set(key, tree);
    this.variants[tree.variant]!.add(tree);
    return tree;
  }

  /** Cuts a tree (by key or object). Returns false if it is not in this forest. Other trees keep their look. */
  removeTree(tree: ForestTree | string | number): boolean {
    const found = typeof tree === 'object' ? this.byKey.get(tree.key) : this.get(tree);
    if (!found || (typeof tree === 'object' && found !== tree)) return false;
    this.byKey.delete(found.key);
    this.variants[found.variant]!.remove(found);
    return true;
  }

  /** The tree drawn by instance `instanceId` of a Variant mesh, e.g. from a raycast intersection. */
  treeAt(intersection: { object: unknown; instanceId?: number }): ForestTree | undefined {
    const variant = this.variants.find((v) => v.meshes.includes(intersection.object as InstancedMesh<BufferGeometry, MeshStandardNodeMaterial>));
    return variant && intersection.instanceId !== undefined ? variant.trees[intersection.instanceId] : undefined;
  }

  /** What the GPU draws a tree with: its Growth and Season after its offsets, and its Wind phase. */
  instanceState(tree: ForestTree | string | number): ForestInstanceState {
    const found = typeof tree === 'object' ? tree : this.get(tree);
    if (!found || found.slot < 0) throw new Error(`No tree "${String(typeof tree === 'object' ? tree.key : tree)}" in this Forest`);
    return this.variants[found.variant]!.state(found);
  }

  /** Growth of the whole forest: setting it sets every tree's Growth (and that of trees planted later). */
  get growth(): number {
    return this.growthValue;
  }

  set growth(value: number) {
    this.growthValue = clampGrowth(value);
    for (const tree of this.byKey.values()) tree.growth = this.growthValue;
  }

  /** Season of the whole forest: setting it sets every tree's Season (and that of trees planted later). */
  get season(): number {
    return this.seasonValue;
  }

  set season(value: number) {
    this.seasonValue = checkedSeason(value);
    for (const tree of this.byKey.values()) tree.season = this.seasonValue;
  }

  /**
   * Structural Occlusion strength (0..1) of every tree, from the Definition's `materials.occlusion`; null
   * when it has none. Setting it (clamped to 0..1) only writes a uniform. Throws without Structural Occlusion.
   */
  get occlusionStrength(): number | null {
    return this.occlusion?.value ?? null;
  }

  set occlusionStrength(value: number) {
    setOcclusionStrength(this.occlusion, value);
  }

  /** Frees every Variant's geometries, materials and instance buffers, and removes the forest from its parent. */
  override dispose(): void {
    for (const variant of this.variants) variant.dispose();
    this.byKey.clear();
    this.removeFromParent();
    super.dispose();
  }
}
