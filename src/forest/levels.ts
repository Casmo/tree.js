// Forest Detail Levels on the GPU (ADR 0010): per Variant, a compute pass sorts the trees into one
// list per Detail Level and fills the indirect draw arguments of the meshes that draw each level.
import {
  BufferGeometry,
  IndirectStorageBufferAttribute,
  Matrix4,
  Mesh,
  StorageBufferAttribute,
  Vector3,
  type Camera,
  type ComputeNode,
  type Material,
  type Node,
  type Object3D,
  type Renderer,
  type Scene,
  type StorageBufferNode,
  type UniformNode,
} from 'three/webgpu';
import { atomicAdd, atomicLoad, atomicStore, float, Fn, If, instanceIndex, screenCoordinate, select, storage, uint, uniform, varying, vec4 } from 'three/tsl';
import { DetailLevel, DITHER_SIZE, MIN_LOD_SCALE } from './lod';
import { drawsDetailLevel, INSTANCE_STRIDE, type LevelInstance } from './nodes';

/** Detail Levels a Variant can draw: Full, Light and Impostor. Lists and draw arguments have room for all three. */
export const LEVEL_COUNT = 3;
/** Meshes (materials) one Detail Level draws at most: wood, leaves and Fruit. */
export const MAX_LEVEL_PARTS = 3;
/** u32s per indexed indirect draw: indexCount, instanceCount, firstIndex, baseVertex, firstInstance. */
const ARGS_STRIDE = 5;
/** vec4s per tree in the GPU tree data: rotation, state (as the instance data), position. */
const TREE_VEC4S = 3;

/** The live values every Variant's level selection reads (one set per Forest). */
export interface DetailLevelUniforms {
  light: UniformNode<'float', number>;
  impostor: UniformNode<'float', number>;
  fade: UniformNode<'float', number>;
  /** The LOD camera's world position this frame. */
  camera: UniformNode<'vec3', Vector3>;
  /** The Forest's world matrix (tree positions are in forest space). */
  forest: UniformNode<'mat4', Matrix4>;
  /**
   * The farthest Detail Level that can be drawn: Light until the Impostors are baked (#75). Trees
   * beyond it draw at it, without a cross-fade into the level that is not there.
   */
  farthest: UniformNode<'uint', number>;
}

/** One mesh of a Detail Level: the geometry (shared vertex data) and the material it draws with. */
export interface LevelPart {
  name: string;
  geometry: BufferGeometry;
  material: Material;
}

/** The meshes of one Detail Level of a Variant. */
export interface LevelMeshes {
  level: DetailLevel;
  meshes: Mesh[];
}

/** The 8 × 8 Bayer threshold of this fragment (twin of `ditherThreshold`). */
function ditherThresholdNode(): Node<'float'> {
  const x = uint(screenCoordinate.x).bitAnd(7);
  const y = uint(screenCoordinate.y).bitAnd(7);
  const v = x.bitXor(y);
  const rank = v
    .bitAnd(1)
    .shiftLeft(5)
    .bitOr(y.bitAnd(1).shiftLeft(4))
    .bitOr(v.bitAnd(2).shiftLeft(2))
    .bitOr(y.bitAnd(2).shiftLeft(1))
    .bitOr(v.bitAnd(4).shiftRight(1))
    .bitOr(y.bitAnd(4).shiftRight(2));
  return float(rank).add(0.5).div(DITHER_SIZE * DITHER_SIZE);
}

/** 0 below `start`, 1 from `end`, linear in between (twin of `ramp` in lod.ts). */
function ramp(x: Node<'float'>, start: Node<'float'>, end: Node<'float'>): Node<'float'> {
  const step = select(x.greaterThanEqual(end), float(1), float(0));
  return select(end.lessThanEqual(start), step, x.sub(start).div(end.sub(start)).clamp(0, 1));
}

/**
 * The GPU side of one Variant's Detail Levels: the tree data by slot, one list of tree slots per
 * level (with each entry's cross-fade), the indirect draw arguments, the compute pass that fills
 * them, and the meshes of every level (they draw indirectly and read their trees by slot).
 *
 * - `setLevel(level, parts)` gives a level its meshes (Full and Light now; an Impostor card later).
 * - `write(slot, …)` / `count` mirror the Variant's instance data; `resize(capacity)` keeps them.
 * - `dispatches` run once per frame for the LOD camera, before any of the meshes is drawn.
 */
export class VariantLevels {
  /** Every level's meshes, nearest level first. */
  readonly levels: LevelMeshes[] = [];
  private capacityValue: number;
  private treeData: StorageBufferAttribute;
  private lists: StorageBufferAttribute;
  private dithers: StorageBufferAttribute;
  private readonly counters = new StorageBufferAttribute(new Uint32Array(LEVEL_COUNT), 1);
  private readonly args = new IndirectStorageBufferAttribute(new Uint32Array(LEVEL_COUNT * MAX_LEVEL_PARTS * ARGS_STRIDE), 1);
  // The draw side reads the buffers through these nodes; resize() points them at the new buffers.
  private readonly treeNode: StorageBufferNode<'vec4'>;
  private readonly listNode: StorageBufferNode<'uint'>;
  private readonly ditherNode: StorageBufferNode<'float'>;
  private readonly countNode = uniform(0, 'uint');
  private readonly levelOf = new WeakMap<object, DetailLevel>();
  private computeNodes: ComputeNode[];
  /** What the meshes read per tree (see `drawsDetailLevel`). */
  private readonly instance: LevelInstance;

  constructor(
    capacity: number,
    private readonly uniforms: DetailLevelUniforms,
    private readonly setupMesh: (mesh: Mesh) => void,
  ) {
    this.capacityValue = capacity;
    this.treeData = new StorageBufferAttribute(new Float32Array(capacity * TREE_VEC4S * 4), 4);
    this.lists = new StorageBufferAttribute(new Uint32Array(LEVEL_COUNT * capacity), 1);
    this.dithers = new StorageBufferAttribute(new Float32Array(LEVEL_COUNT * capacity), 1);
    this.treeNode = storage(this.treeData, 'vec4', capacity * TREE_VEC4S).toReadOnly();
    this.listNode = storage(this.lists, 'uint', LEVEL_COUNT * capacity).toReadOnly();
    this.ditherNode = storage(this.dithers, 'float', LEVEL_COUNT * capacity).toReadOnly();

    // The entry of the level list this instance draws: the level's base (per mesh) + instanceIndex.
    // A flat varying, so the fragment stage reads the same entry.
    const base = uniform(0, 'uint').onObjectUpdate(({ object }) => (this.levelOf.get(object as object) ?? 0) * this.capacityValue);
    const entry = varying(base.add(instanceIndex)) as unknown as Node<'uint'>;
    const slot = this.listNode.element(entry) as unknown as Node<'uint'>;
    const tree = (k: number) => this.treeNode.element(slot.mul(TREE_VEC4S).add(k)) as unknown as Node<'vec4'>;
    // dither >= 0: the nearer level of a cross-fade, drawn where threshold < dither; < 0: the next
    // level, drawn where threshold >= -dither (see `showsPixel`).
    const dither = this.ditherNode.element(entry) as unknown as Node<'float'>;
    const threshold = ditherThresholdNode();
    this.instance = {
      slot,
      rotation: tree(0),
      state: tree(1),
      position: tree(2).xyz,
      visible: select(dither.greaterThanEqual(0), threshold.lessThan(dither), threshold.greaterThanEqual(dither.negate())) as unknown as Node<'bool'>,
    };
    this.computeNodes = this.createDispatches();
  }

  get capacity(): number {
    return this.capacityValue;
  }

  /** Number of trees (slots 0..count-1 are in use). */
  set count(value: number) {
    this.countNode.value = value;
  }

  /** The compute dispatches to run once per frame (reset, select, draw arguments). */
  get dispatches(): readonly ComputeNode[] {
    return this.computeNodes;
  }

  /** Every mesh of every level. */
  get meshes(): Mesh[] {
    return this.levels.flatMap((l) => l.meshes);
  }

  /** The indirect draw arguments, LEVEL_COUNT × MAX_LEVEL_PARTS draws of 5 u32 (for read-back). */
  get drawArguments(): IndirectStorageBufferAttribute {
    return this.args;
  }

  /**
   * Gives `level` its meshes (at most MAX_LEVEL_PARTS parts), one per part, each drawn
   * indirectly from the level's list. Returns them; the caller adds them to the scene.
   */
  setLevel(level: DetailLevel, parts: readonly LevelPart[]): Mesh[] {
    if (parts.length > MAX_LEVEL_PARTS) throw new RangeError(`A Detail Level has at most ${MAX_LEVEL_PARTS} meshes`);
    if (this.levels.some((l) => l.level === level)) throw new Error(`Detail Level ${level} already has its meshes`);
    const array = this.args.array as Uint32Array;
    const meshes = parts.map((part, i) => {
      const draw = (level * MAX_LEVEL_PARTS + i) * ARGS_STRIDE;
      const geometry = new BufferGeometry();
      for (const [name, attribute] of Object.entries(part.geometry.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(part.geometry.getIndex());
      array[draw] = geometry.getIndex()!.count;
      geometry.setIndirect(this.args, draw * 4);
      const mesh = new Mesh(geometry, part.material);
      mesh.name = part.name;
      // The level lists span the whole forest: the compute pass decides what is drawn, not the CPU.
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Raycasting stays on the Variant's instanced meshes (one hit per tree, `instanceId` = slot).
      mesh.raycast = () => {};
      this.levelOf.set(mesh, level);
      drawsDetailLevel(mesh, this.instance);
      this.setupMesh(mesh);
      return mesh;
    });
    this.args.needsUpdate = true; // only before the first frame: later uploads would wipe the GPU's counts
    this.levels.push({ level, meshes });
    this.levels.sort((a, b) => a.level - b.level);
    return meshes;
  }

  /**
   * Writes one tree: `instance` = its INSTANCE_STRIDE floats of instance data (rotation, state),
   * `position` = its base in forest space.
   */
  write(slot: number, instance: ArrayLike<number>, position: readonly [number, number, number]): void {
    const array = this.treeData.array as Float32Array;
    const o = slot * TREE_VEC4S * 4;
    for (let i = 0; i < INSTANCE_STRIDE; i++) array[o + i] = instance[i]!;
    array[o + 8] = position[0];
    array[o + 9] = position[1];
    array[o + 10] = position[2];
    array[o + 11] = 0;
    this.treeData.needsUpdate = true;
  }

  /** Room for `capacity` trees (the tree data is kept; the lists are refilled every frame). */
  resize(capacity: number): void {
    const treeData = new StorageBufferAttribute(new Float32Array(capacity * TREE_VEC4S * 4), 4);
    (treeData.array as Float32Array).set((this.treeData.array as Float32Array).subarray(0, Math.min(capacity, this.capacityValue) * TREE_VEC4S * 4));
    this.disposeBuffers();
    this.capacityValue = capacity;
    this.treeData = treeData;
    this.lists = new StorageBufferAttribute(new Uint32Array(LEVEL_COUNT * capacity), 1);
    this.dithers = new StorageBufferAttribute(new Float32Array(LEVEL_COUNT * capacity), 1);
    for (const [node, attribute, count] of [
      [this.treeNode, this.treeData, capacity * TREE_VEC4S],
      [this.listNode, this.lists, LEVEL_COUNT * capacity],
      [this.ditherNode, this.dithers, LEVEL_COUNT * capacity],
    ] as const) {
      node.value = attribute;
      node.bufferCount = count;
    }
    for (const node of this.computeNodes) node.dispose();
    this.computeNodes = this.createDispatches();
  }

  /** Frees the meshes' geometry, the buffers and the compute pass (the materials belong to the Variant). */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.levels.length = 0;
    this.disposeBuffers();
    this.counters.dispose();
    this.args.dispose();
    for (const node of this.computeNodes) node.dispose();
  }

  private disposeBuffers(): void {
    this.treeData.dispose();
    this.lists.dispose();
    this.dithers.dispose();
  }

  /**
   * The compute pass: reset the level counters; sort every tree into its level list (and, in a
   * cross-fade, the next level's too), mirroring `selectDetailLevel`; copy the counts into the draw
   * arguments of every level's meshes.
   */
  private createDispatches(): ComputeNode[] {
    const capacity = this.capacityValue;
    const { light, impostor, fade, camera, forest, farthest } = this.uniforms;
    const counters = storage(this.counters, 'uint', LEVEL_COUNT).toAtomic();
    const trees = storage(this.treeData, 'vec4', capacity * TREE_VEC4S).toReadOnly();
    const lists = storage(this.lists, 'uint', LEVEL_COUNT * capacity);
    const dithers = storage(this.dithers, 'float', LEVEL_COUNT * capacity);
    const args = storage(this.args, 'uint', LEVEL_COUNT * MAX_LEVEL_PARTS * ARGS_STRIDE);
    const count = this.countNode;

    const reset = Fn(() => {
      If(instanceIndex.lessThan(LEVEL_COUNT), () => {
        atomicStore(counters.element(instanceIndex), uint(0));
      });
    })().compute(LEVEL_COUNT);

    const append = (level: Node<'uint'>, i: Node<'uint'>, dither: Node<'float'>) => {
      const at = atomicAdd(counters.element(level), uint(1)).toVar();
      const entry = level.mul(uint(capacity)).add(at);
      lists.element(entry).assign(i);
      dithers.element(entry).assign(dither);
    };

    const select_ = Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(count), () => {
        const state = trees.element(i.mul(TREE_VEC4S).add(1));
        const base = trees.element(i.mul(TREE_VEC4S).add(2)).xyz;
        const world = forest.mul(vec4(base, 1)).xyz;
        // selectDetailLevel, line by line.
        const t = world.distance(camera).div(state.x.max(MIN_LOD_SCALE));
        const half = fade.mul(0.5);
        const toImpostor = select(
          state.y.greaterThanEqual(1),
          ramp(t, impostor.mul(float(1).sub(half)), impostor.mul(float(1).add(half))),
          float(0),
        );
        const toLight = ramp(t, light.mul(float(1).sub(half)), light.mul(float(1).add(half)));
        const level = uint(DetailLevel.Full).toVar();
        const amount = toLight.toVar();
        If(toImpostor.greaterThanEqual(1), () => {
          level.assign(DetailLevel.Impostor);
          amount.assign(0);
        })
          .ElseIf(toImpostor.greaterThan(0), () => {
            level.assign(DetailLevel.Light);
            amount.assign(toImpostor);
          })
          .ElseIf(toLight.greaterThanEqual(1), () => {
            level.assign(DetailLevel.Light);
            amount.assign(0);
          });
        // Nothing beyond the farthest level that can be drawn (no Impostors yet: Light, not faded).
        If(level.greaterThanEqual(farthest), () => {
          level.assign(farthest);
          amount.assign(0);
        });
        const nearer = float(1).sub(amount);
        append(level, i, nearer);
        If(amount.greaterThan(0), () => {
          append(level.add(uint(1)), i, nearer.negate());
        });
      });
    })().compute(capacity);

    const draws = LEVEL_COUNT * MAX_LEVEL_PARTS;
    const copyCounts = Fn(() => {
      If(instanceIndex.lessThan(draws), () => {
        const level = instanceIndex.div(uint(MAX_LEVEL_PARTS));
        args.element(instanceIndex.mul(ARGS_STRIDE).add(1)).assign(atomicLoad(counters.element(level)));
      });
    })().compute(draws);

    return [reset, select_, copyCounts];
  }
}

/** Whether a render is a shadow pass (three draws shadow maps with a shadow override material). */
function isShadowPass(scene: Scene | null): boolean {
  return (scene?.overrideMaterial as { isShadowPassMaterial?: boolean } | null | undefined)?.isShadowPassMaterial === true;
}

/**
 * Picks the LOD camera and runs every Variant's level selection once per frame (`renderer.info.frame`),
 * before the first Detail Level mesh of the Forest is drawn in it, so every render of that frame
 * (shadow passes, other cameras) draws the same levels.
 */
export class LevelSelection {
  private frame: number | null = null;
  /** The camera the last selection was made for. */
  private previous: Camera | null = null;
  /** The last non-shadow camera seen drawing the Forest (before the first selection). */
  private seen: Camera | null = null;
  private readonly cameraPosition = new Vector3();

  constructor(private readonly uniforms: DetailLevelUniforms) {}

  /** Notes the camera of a render that draws the Forest, unless it is a shadow pass. */
  observe(scene: Scene | null, camera: Camera | null): void {
    if (camera && !isShadowPass(scene)) this.seen = camera;
  }

  /**
   * Called before a Detail Level mesh is drawn. The first call of a frame selects the levels for the
   * LOD camera: `explicit` (`lod.camera`) when set, otherwise the camera of this render. A shadow map
   * can be drawn before the camera's own render reaches the Forest: then the levels are selected for
   * the previous frame's LOD camera (or, on the first frame, the last camera seen drawing the Forest).
   */
  prepare(renderer: Renderer, scene: Scene | null, camera: Camera | null, explicit: Camera | null, forest: Object3D, variants: readonly VariantLevels[]): void {
    this.observe(scene, camera);
    const frame = (renderer.info as { frame?: number } | undefined)?.frame;
    if (frame !== undefined && frame === this.frame) return;
    const lodCamera = explicit ?? (isShadowPass(scene) ? (this.previous ?? this.seen ?? camera) : camera);
    if (!lodCamera || typeof renderer.compute !== 'function') return;
    this.frame = frame ?? null;
    if (!explicit) this.previous = lodCamera;
    lodCamera.updateMatrixWorld();
    this.uniforms.camera.value.copy(lodCamera.getWorldPosition(this.cameraPosition));
    this.uniforms.forest.value.copy(forest.matrixWorld);
    void renderer.compute(variants.flatMap((v) => v.dispatches));
  }
}
