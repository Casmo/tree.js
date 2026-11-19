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
  type Camera,
  type Mesh,
  type MeshStandardNodeMaterial,
  type Node,
  type Renderer,
  type Scene,
} from 'three/webgpu';
import { and, positionGeometry, uniform } from 'three/tsl';
import type { MaterialFeatures, TranslucencyDefinition, TreeDefinition } from '../definition';
import { generateLightTree, generateTree, trunkHeight, type GeometryBuffers, type TreeData } from '../generator';
import { createBarkMaterial, createFruitMaterial, createLeafMaterial } from '../materials';
import { LiveMaterialFeatures, type MaterialFeatureTarget } from '../materials/material-features';
import { assertWebGPURenderer } from '../renderer';
import { applySeasonToLeafMaterial, createFruitSeasonNodes, createSeasonNodes } from '../season';
import { checkedSeason } from '../season/check';
import { clampGrowth } from '../growth';
import { textureReady, type TextureOptions } from '../textures';
import { sceneWind, Wind, WindBinding, WindResponse, type WindSource } from '../wind';
import { VariantImpostor } from './impostor';
import { LevelSelection, MAX_LEVEL_PARTS, VariantLevels, type DetailLevelUniforms, type LevelPart } from './levels';
import {
  checkDetailLevelDistances,
  DetailLevel,
  resolveForestLod,
  type DetailLevelDistances,
  type ForestLodOptions,
  type ForestLodSettings,
  type ForestLodUpdate,
} from './lod';
import { INSTANCE_ATTRIBUTES, INSTANCE_STRIDE, forestPosition, instanceRotate, instanceState, levelVisible } from './nodes';
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
  /**
   * Detail Levels (ADR 0010): draw far trees Light and as Impostors, with a cross-fade. `true` derives
   * the switch distances from the tallest Variant's trunk height. Missing or false: the forest draws
   * every tree in full, exactly as without this option. WebGPU only: on WebGPURenderer's WebGL2
   * fallback it is ignored (one console warning). Switching it on or off needs a new Forest.
   */
  lod?: boolean | ForestLodOptions;
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
  /** @internal The Variant drawing this tree, null once it is removed. */
  owner: ForestVariant | null = null;
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
  private readonly definition: TreeDefinition;
  /** @internal The Detail Levels this Variant draws its trees with; null until they are drawn (lod set, on WebGPU). */
  levels: VariantLevels | null = null;
  /** Vertex data of the Light level (null until Detail Levels are drawn). */
  private lightSources: BufferGeometry[] = [];
  /** @internal The Impostor of this Variant (atlases and card material); null until Detail Levels are drawn. */
  impostor: VariantImpostor | null = null;

  constructor(
    private readonly forest: Forest,
    definition: TreeDefinition,
    index: number,
    seed: number,
    wind: WindSource,
    capacity: number,
    private readonly textures?: TextureOptions,
  ) {
    this.index = index;
    this.seed = seed;
    this.definition = definition;
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
    tree.owner = this;
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
    tree.owner = null;
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
    this.levels?.write(i, array.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE), [position.x, position.y, position.z]);
    for (const mesh of this.meshes) mesh.boundingSphere = mesh.boundingBox = null;
  }

  /** @internal */
  state(tree: ForestTree): ForestInstanceState {
    const o = tree.slot * INSTANCE_STRIDE;
    const array = this.instanceData.array as Float32Array;
    return { growth: array[o + 5]!, season: array[o + 6]!, windPhase: array[o + 7]! };
  }

  /**
   * @internal Starts drawing this Variant's trees by Detail Level (ADR 0010): a Full and a Light mesh
   * set, drawn indirectly from the level lists, with the Variant's own materials (which get the
   * cross-fade dither). The instanced meshes stay, hidden, for raycasting and Tree IDs.
   */
  enableDetailLevels(
    uniforms: DetailLevelUniforms,
    settings: Pick<ForestLodSettings, 'lightDefinition' | 'impostorAtlas'>,
    setupMesh: (mesh: Mesh) => void,
  ): void {
    if (this.levels) return;
    const levels = new VariantLevels(this.capacity, uniforms, setupMesh);
    const parts = (level: string, wood: BufferGeometry, leaves: BufferGeometry, fruit: BufferGeometry | null): LevelPart[] => {
      const list: LevelPart[] = [
        { name: `forest wood ${this.index} ${level}`, geometry: wood, material: this.barkMaterial },
        { name: `forest leaves ${this.index} ${level}`, geometry: leaves, material: this.leafMaterial },
      ];
      if (fruit && this.fruitMaterial && fruit.getIndex()!.count > 0) {
        list.push({ name: `forest fruit ${this.index} ${level}`, geometry: fruit, material: this.fruitMaterial });
      }
      return list;
    };
    levels.setLevel(DetailLevel.Full, parts('full', this.woodSource, this.leafSource, this.fruitSource));

    const light = generateLightTree(this.definition, this.seed, settings.lightDefinition ?? undefined);
    const margin = trunkHeight(this.data.skeleton) * WIND_BOUNDS;
    this.lightSources = [light.wood, light.leaves, light.fruit].map((buffers) => interleavedGeometry(buffers, margin));
    const [wood, leaves, fruit] = this.lightSources as [BufferGeometry, BufferGeometry, BufferGeometry];
    levels.setLevel(DetailLevel.Light, parts('light', wood, leaves, this.fruitSource ? fruit : null));

    // The Impostor card is set up now (its draw arguments too), but only drawn once baked (`farthest`).
    this.impostor = new VariantImpostor(
      this.definition,
      { wood: this.woodSource, leaves: this.leafSource },
      { wood: this.data.wood, leaves: this.data.leaves },
      settings.impostorAtlas,
      `forest impostor ${this.index}`,
      this.textures,
    );
    levels.setLevel(DetailLevel.Impostor, [this.impostor.part]);

    // Every level draws only its share of a tree in a cross-fade.
    for (const material of [this.barkMaterial, this.leafMaterial, this.fruitMaterial]) {
      if (!material) continue;
      material.maskNode = material.maskNode ? and(material.maskNode as Node<'bool'>, levelVisible()) : levelVisible();
      material.needsUpdate = true;
    }
    this.levels = levels;
    for (const tree of this.trees) this.write(tree);
    levels.count = this.trees.length;
    for (const mesh of this.meshes) mesh.visible = false;
    this.forest.add(...levels.meshes);
  }

  /** @internal Frees the GPU resources. */
  dispose(): void {
    // Detail Levels: the level meshes' geometry, the GPU buffers and compute pass, then the Light vertex data.
    this.levels?.dispose();
    this.levels = null;
    this.impostor?.dispose();
    this.impostor = null;
    for (const source of this.lightSources) source.dispose();
    this.lightSources = [];
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
    if (this.levels) this.levels.count = this.trees.length;
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
    this.levels?.resize(capacity);

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
      // Drawn by the Detail Level meshes instead once those are on (kept for raycasting and Tree IDs).
      instanced.visible = this.levels === null;
      instanced.onBeforeRender = (renderer, scene, camera) => {
        assertWebGPURenderer(renderer);
        this.forest.detectLodBackend(renderer, scene, camera);
      };
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
  private readonly features: LiveMaterialFeatures;
  /** Detail Level settings and their uniforms; null without lod. */
  private readonly lodState: { settings: ForestLodSettings; uniforms: DetailLevelUniforms; selection: LevelSelection } | null;
  /** Detail Levels are drawn: lod is set and the renderer is not on the WebGL2 fallback (unknown before the first render). */
  private lodBackend: 'unknown' | 'webgpu' | 'webgl' = 'unknown';
  private resolveLodReady: () => void = () => {};
  private disposed = false;
  /**
   * Resolves once every Impostor is baked (far trees draw Light until then); at once without lod, on
   * the first render on WebGPURenderer's WebGL2 fallback (where lod is ignored), and on dispose.
   */
  readonly lodReady: Promise<void>;

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
    // Material Features: one set of values for the whole forest; each Variant has its own Crown Volume and
    // baked `aOcclusion`. The Crown Volume is in tree space: its normal turns with the instance (uniform
    // scale: rotation only).
    this.features = new LiveMaterialFeatures(
      definition,
      this.variants.map((v): MaterialFeatureTarget => ({
        leaf: v.leafMaterial,
        materials: [v.barkMaterial, v.leafMaterial, v.fruitMaterial],
        crown: v.data.crown,
        growth: instanceState().growth,
        toObject: (normal) => instanceRotate(normal),
      })),
    );
    const textures = this.variants.flatMap((v) => [v.barkMaterial.map, v.barkMaterial.normalMap, v.leafMaterial.map]);
    this.ready = Promise.all(textures.filter((t) => t !== null).map(textureReady)).then(() => undefined);
    this.ready.catch(() => {}); // only reported to whoever awaits it

    const tallest = Math.max(...this.variants.map((v) => trunkHeight(v.data.skeleton)));
    const lod = resolveForestLod(options.lod, tallest);
    if (lod) {
      const uniforms: DetailLevelUniforms = {
        light: uniform(lod.light),
        impostor: uniform(lod.impostor),
        fade: uniform(lod.fade),
        camera: uniform(new Vector3()),
        forest: uniform(new Matrix4()),
        // Until the Impostors are baked, trees beyond the Impostor distance draw Light.
        farthest: uniform(DetailLevel.Light, 'uint'),
      };
      this.lodState = { settings: lod, uniforms, selection: new LevelSelection(uniforms) };
    } else {
      this.lodState = null;
    }
    this.lodReady = lod ? new Promise((resolve) => (this.resolveLodReady = resolve)) : Promise.resolve();

    for (const placement of placements) this.addTree(placement);
  }

  /**
   * The Detail Level settings (a copy), null without lod. Setting `light`, `impostor`, `fade` or
   * `camera` (the others kept) only writes uniforms: no rebuild, no recompile. Throws a RangeError for
   * invalid values (keeping the old ones), and on a forest without lod (switching it on needs a new Forest).
   */
  get lod(): ForestLodSettings | null {
    if (!this.lodState) return null;
    const { settings } = this.lodState;
    return { ...settings, impostorAtlas: { ...settings.impostorAtlas } };
  }

  set lod(value: ForestLodUpdate) {
    if (!this.lodState) throw new Error('This Forest has no Detail Levels: pass `lod` to createForest (switching them on needs a new Forest)');
    const { settings, uniforms } = this.lodState;
    const next: DetailLevelDistances = {
      light: value.light ?? settings.light,
      impostor: value.impostor ?? settings.impostor,
      fade: value.fade ?? settings.fade,
    };
    checkDetailLevelDistances(next);
    Object.assign(settings, next);
    if (value.camera !== undefined) settings.camera = value.camera;
    uniforms.light.value = next.light;
    uniforms.impostor.value = next.impostor;
    uniforms.fade.value = next.fade;
  }

  /** @internal The live Detail Level settings as uniforms (null without lod), for the GPU level selection. */
  get lodUniforms(): DetailLevelUniforms | null {
    return this.lodState?.uniforms ?? null;
  }

  /** @internal Whether Detail Levels are drawn: lod is set and the first render was on WebGPU (not the WebGL2 fallback). */
  get lodActive(): boolean {
    return this.lodState !== null && this.lodBackend === 'webgpu';
  }

  /**
   * @internal Called before each instanced mesh is drawn: on the first render of a lod Forest, finds the
   * backend. On WebGL2 the forest ignores lod (one console warning) and draws every tree in full. On
   * WebGPU that first frame still draws every tree in full; the Detail Level meshes take over right
   * after it (they cannot join a frame that is already being drawn), the Impostors are baked, and then
   * `lodReady` resolves.
   */
  detectLodBackend(renderer: unknown, scene?: Scene | null, camera?: Camera | null): void {
    if (!this.lodState) return;
    this.lodState.selection.observe(scene ?? null, camera ?? null);
    if (this.lodBackend !== 'unknown') return;
    const backend = (renderer as { backend?: { isWebGLBackend?: boolean } }).backend;
    if (backend?.isWebGLBackend === true) {
      this.lodBackend = 'webgl';
      console.warn(
        'tree.js: Forest Detail Levels (lod) need WebGPU; on WebGPURenderer\'s WebGL2 fallback this Forest ignores lod and draws every tree in full.',
      );
      this.resolveLodReady();
    } else {
      this.lodBackend = 'webgpu';
      queueMicrotask(() => {
        if (this.disposed) return this.resolveLodReady();
        this.enableDetailLevels();
        void this.bakeImpostors(renderer as Renderer);
      });
    }
  }

  /** Builds every Variant's Detail Level meshes and buffers (WebGPU, lod set). */
  private enableDetailLevels(): void {
    const { settings, uniforms } = this.lodState!;
    for (const variant of this.variants) {
      variant.enableDetailLevels(uniforms, settings, (mesh) => {
        mesh.onBeforeRender = (renderer, scene, camera) => {
          assertWebGPURenderer(renderer);
          this.selectDetailLevels(renderer as unknown as Renderer, scene, camera);
        };
      });
    }
  }

  /**
   * Bakes every Variant's Impostor with the app's renderer (after the textures have loaded), then lets
   * far trees draw as Impostors and resolves `lodReady`. Until then they draw Light. If the bake
   * fails, they keep drawing Light (one console error) and `lodReady` still resolves.
   */
  private async bakeImpostors(renderer: Renderer): Promise<void> {
    try {
      await this.ready.catch(() => {}); // a texture that failed to load bakes as without it
      if (this.disposed) return;
      for (const variant of this.variants) variant.impostor!.bake(renderer);
      this.lodState!.uniforms.farthest.value = DetailLevel.Impostor;
    } catch (error) {
      console.error('tree.js: baking the Forest Impostors failed; far trees draw Light.', error);
    } finally {
      this.resolveLodReady();
    }
  }

  /**
   * Before a Detail Level mesh is drawn: the first time in a frame, picks every tree's level for the
   * LOD camera on the GPU (shadow passes and other cameras reuse that frame's levels).
   */
  private selectDetailLevels(renderer: Renderer, scene: Scene | null, camera: Camera | null): void {
    const { settings, selection } = this.lodState!;
    selection.prepare(renderer, scene, camera, settings.camera, this, this.variants.map((v) => v.levels!));
  }

  /**
   * @internal How many trees each Detail Level drew in the last frame (indexed by DetailLevel; a tree
   * in a cross-fade counts at both levels). All zero until Detail Levels are drawn. Reads the GPU.
   */
  async detailLevelCounts(renderer: Renderer): Promise<number[]> {
    const counts = [0, 0, 0];
    for (const variant of this.variants) {
      if (!variant.levels) continue;
      const args = new Uint32Array(await renderer.getArrayBufferAsync(variant.levels.drawArguments));
      for (let level = 0; level < counts.length; level++) counts[level]! += args[level * MAX_LEVEL_PARTS * 5 + 1]!;
    }
    return counts;
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
   * Crown Normals amount (0..1), from the Definition's `materials.leaf.crownNormals`; null when it is off.
   * Setting it (clamped to 0..1) only writes a uniform: no regeneration, no recompile. Throws on a
   * forest without Crown Normals (switching the feature on needs a new forest).
   */
  get crownNormals(): number | null {
    return this.features.crownNormals;
  }

  set crownNormals(value: number) {
    this.features.crownNormals = value;
  }

  /**
   * Leaf Translucency settings (a copy), from the Definition's `materials.leaf.translucency`; null when it
   * is off. Setting any of them (each clamped to 0..1, the others kept) only writes uniforms: no
   * regeneration, no recompile. Throws on a forest without Leaf Translucency.
   */
  get translucency(): TranslucencyDefinition | null {
    return this.features.translucency;
  }

  set translucency(value: Partial<TranslucencyDefinition>) {
    this.features.translucency = value;
  }

  /**
   * The Material Features this forest shows, with their current (possibly live-tuned) values: the
   * Definition's (see `materialFeaturesOf`), except that Crown Normals at 0 count as off.
   */
  get materialFeatures(): MaterialFeatures {
    return this.features.values;
  }

  /**
   * Structural Occlusion strength (0..1) of every tree, from the Definition's `materials.occlusion`; null
   * when it has none. Setting it (clamped to 0..1) only writes a uniform. Throws without Structural Occlusion.
   */
  get occlusionStrength(): number | null {
    return this.features.occlusionStrength;
  }

  set occlusionStrength(value: number) {
    this.features.occlusionStrength = value;
  }

  /** Frees every Variant's geometries, materials and instance buffers, and removes the forest from its parent. */
  override dispose(): void {
    this.disposed = true;
    this.resolveLodReady(); // nothing left to wait for
    for (const variant of this.variants) variant.dispose();
    this.byKey.clear();
    this.removeFromParent();
    super.dispose();
  }
}
