import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type Material,
  type MeshStandardNodeMaterial,
  type NodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import { trunkHeight, type GeometryBuffers, type TreeData } from '../generator';
import { clampGrowth, growthPosition } from '../growth';
import { applyCrownNormals, createBarkMaterial, createFruitMaterial, createLeafMaterial } from '../materials';
import { applyLeafTranslucency } from '../materials/leaf-translucency-model';
import { applyStructuralOcclusion, setOcclusionStrength, type OcclusionStrengthUniform } from '../materials/occlusion';
import { assertWebGPURenderer } from '../renderer';
import { applySeasonToLeafMaterial, createFruitSeasonNodes, createSeasonNodes, type SeasonUniform } from '../season';
import { checkedSeason } from '../season/check';
import { textureReady, type TextureOptions } from '../textures';
import { seedRandom } from '../random';
import { applyWind, sceneWind, windOffset, Wind, WindBinding, WindResponse } from '../wind';

/**
 * The Generator's per-vertex part attributes (`aLevel`, `aSeason`, `aWind`, ...) go into one
 * interleaved vertex buffer: WebGPU allows only 8 vertex buffers per draw by default, and a
 * textured leaf already reads position, normal, uv and colour besides Growth, Season and Wind.
 */
function setPartAttributes(geometry: BufferGeometry, attributes: GeometryBuffers['attributes']): void {
  const entries = Object.entries(attributes);
  const stride = entries.reduce((sum, [, a]) => sum + a.itemSize, 0);
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * stride);
  let offset = 0;
  for (const [, { array, itemSize }] of entries) {
    for (let v = 0; v < count; v++) {
      for (let c = 0; c < itemSize; c++) data[v * stride + offset + c] = array[v * itemSize + c]!;
    }
    offset += itemSize;
  }
  const buffer = new InterleavedBuffer(data, stride);
  offset = 0;
  for (const [name, { itemSize }] of entries) {
    geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, itemSize, offset));
    offset += itemSize;
  }
}

function toBufferGeometry(buffers: GeometryBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2));
  if (buffers.colors) geometry.setAttribute('color', new BufferAttribute(buffers.colors, 3));
  setPartAttributes(geometry, buffers.attributes);
  geometry.setIndex(new BufferAttribute(buffers.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function treeMesh<M extends Material>(name: string, geometry: BufferGeometry, material: M): Mesh<BufferGeometry, M> {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.onBeforeRender = (renderer) => assertWebGPURenderer(renderer);
  return mesh;
}

/** Per-tree state a Tree starts with. */
export interface TreeOptions {
  /** Growth, 0 (sapling) .. 1 (fully grown, default). */
  growth?: number;
  /** Season, 0 (first day of spring, default) .. 1 (last day of winter). */
  season?: number;
  /** The Wind this tree sways with. Default: the scene-wide {@link sceneWind}. */
  wind?: Wind;
  /**
   * Where this tree's textures load from (base path / per-URL overrides); takes precedence over
   * the app-wide `setTextureOptions`. Only Definitions with textures (e.g. the realistic Style) use it.
   */
  textures?: TextureOptions;
}

/**
 * A generated tree as a three.js object. Add it to a scene rendered by `WebGPURenderer`.
 * `growth`, `season` and the Wind only update uniforms: no regeneration, no recompile.
 */
export class Tree extends Group {
  readonly isTree = true;
  readonly definition: TreeDefinition;
  readonly seed: number;
  /** The generator output this object was built from (pure data). */
  readonly data: TreeData;
  /** Trunk and branches. */
  readonly wood: Mesh<BufferGeometry, Material>;
  /** Leaf cards (empty geometry for a bare tree). */
  readonly leaves: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  /** Fruit (empty geometry when the Definition has no Fruit). */
  readonly fruit: Mesh<BufferGeometry, MeshStandardNodeMaterial>;
  /** This tree's Growth uniform (read by the wood, leaf and Fruit materials' `positionNode`). */
  readonly growthUniform: UniformNode<'float', number>;
  /** The Season uniform the leaf and Fruit materials read (shared nodes may reference it). */
  readonly seasonUniform: SeasonUniform;
  /** This tree's response to the Wind, from `definition.wind`; `windResponse.set(...)` changes it live. */
  readonly windResponse: WindResponse;
  private readonly windBinding: WindBinding;
  private readonly occlusion: OcclusionStrengthUniform | null;

  /**
   * Resolves once every texture of this tree has loaded (at once for a tree without textures);
   * rejects if one fails. Await it before a first render that must show the textures.
   */
  readonly ready: Promise<void>;

  constructor(definition: TreeDefinition, data: TreeData, options: TreeOptions = {}) {
    super();
    this.name = 'Tree';
    this.definition = definition;
    this.seed = data.seed;
    this.data = data;

    this.growthUniform = uniform(clampGrowth(options.growth ?? 1));
    const bark = createBarkMaterial(definition, options.textures, this.growthUniform);
    const leaf = createLeafMaterial(definition, options.textures);
    bark.positionNode = growthPosition(this.growthUniform);
    leaf.positionNode = growthPosition(this.growthUniform);
    applyCrownNormals(leaf, definition.materials.leaf.crownNormals, data.crown, this.growthUniform);
    const { translucency } = definition.materials.leaf;
    if (translucency) applyLeafTranslucency(leaf, translucency, data.crown, this.growthUniform);
    this.wood = treeMesh('wood', toBufferGeometry(data.wood), bark);
    this.leaves = treeMesh('leaves', toBufferGeometry(data.leaves), leaf);
    const textures = [bark.map, bark.normalMap, leaf.map].filter((t) => t !== null);
    this.ready = Promise.all(textures.map(textureReady)).then(() => undefined);
    this.ready.catch(() => {}); // only reported to whoever awaits it
    const fruit = createFruitMaterial(definition);
    this.fruit = treeMesh('fruit', toBufferGeometry(data.fruit), fruit);
    this.add(this.wood, this.leaves, this.fruit);

    this.windBinding = new WindBinding(options.wind ?? sceneWind);
    this.windResponse = new WindResponse(definition.wind, {
      height: trunkHeight(data.skeleton),
      phase: seedRandom(data.seed, 'wind') * Math.PI * 2,
    });
    const offset = windOffset(this.windBinding, this.windResponse);
    applyWind(this.wood.material as NodeMaterial, offset);
    applyWind(this.leaves.material, offset);

    const season = createSeasonNodes(definition.season);
    applySeasonToLeafMaterial(this.leaves.material, season);
    this.seasonUniform = season.season;
    // Fruit: Season scales it about its attachment point, then Growth, then Wind (with its twig).
    const fruitSeason = createFruitSeasonNodes(definition.season, this.seasonUniform);
    fruit.colorNode = fruitSeason.color;
    fruit.positionNode = growthPosition(this.growthUniform, fruitSeason.position);
    applyWind(fruit, offset);
    this.season = options.season ?? 0;
    this.occlusion = applyStructuralOcclusion(definition, [bark, leaf, fruit]);
  }

  /**
   * Structural Occlusion strength (0..1), from the Definition's `materials.occlusion`; null when it has none.
   * Setting it (clamped to 0..1) only writes a uniform: no regeneration, no recompile. Throws on a tree
   * without Structural Occlusion (there is no baked occlusion to show).
   */
  get occlusionStrength(): number | null {
    return this.occlusion?.value ?? null;
  }

  set occlusionStrength(value: number) {
    setOcclusionStrength(this.occlusion, value);
  }

  /**
   * The Wind this tree sways with (shared with every other tree using it). Assigning another
   * Wind only rebinds uniforms: no regeneration, no recompile.
   */
  get wind(): Wind {
    return this.windBinding.wind;
  }

  set wind(value: Wind) {
    this.windBinding.wind = value;
  }

  /**
   * Season: 0 (first day of spring) .. 1 (last day of winter); sets leaf colour, leaf coverage,
   * blossom and Fruit (amount, size, colour) from the Definition's Season Profile. Values outside 0..1 wrap around the year.
   * Only updates a uniform, so it is cheap to animate.
   */
  get season(): number {
    return this.seasonUniform.value;
  }

  set season(value: number) {
    this.seasonUniform.value = checkedSeason(value);
  }

  /**
   * How far this tree has grown: 0 (sapling) .. 1 (fully grown); values outside are clamped.
   * Setting it only writes a uniform, so it is cheap to animate every frame.
   */
  get growth(): number {
    return this.growthUniform.value;
  }

  set growth(value: number) {
    this.growthUniform.value = clampGrowth(value);
  }

  /** Frees the GPU resources (geometries and materials) of this tree and removes it from its parent. */
  override dispose(): void {
    this.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.removeFromParent();
    super.dispose();
  }
}
