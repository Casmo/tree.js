import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Material,
  type MeshStandardNodeMaterial,
  type NodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers, TreeData } from '../generator';
import { clampGrowth, growthPosition } from '../growth';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import { assertWebGPURenderer } from '../renderer';
import { applySeasonToLeafMaterial, createSeasonNodes, wrapSeason, type SeasonUniform } from '../season';
import { hashCombine, hashString, seedToUint32 } from '../random';
import { applyWind, sceneWind, windOffset, Wind, WindResponse } from '../wind';

function toBufferGeometry(buffers: GeometryBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2));
  if (buffers.colors) geometry.setAttribute('color', new BufferAttribute(buffers.colors, 3));
  for (const [name, { array, itemSize }] of Object.entries(buffers.attributes)) {
    geometry.setAttribute(name, new BufferAttribute(array, itemSize));
  }
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
  /** This tree's Growth uniform (read by the wood and leaf materials' `positionNode`). */
  readonly growthUniform: UniformNode<'float', number>;
  /** The Season uniform the leaf material reads (shared nodes may reference it). */
  readonly seasonUniform: SeasonUniform;
  /** The Wind this tree sways with (shared with every other tree using it). */
  readonly wind: Wind;
  /** This tree's response to the Wind, from `definition.wind`; `windResponse.set(...)` changes it live. */
  readonly windResponse: WindResponse;

  constructor(definition: TreeDefinition, data: TreeData, options: TreeOptions = {}) {
    super();
    this.name = 'Tree';
    this.definition = definition;
    this.seed = data.seed;
    this.data = data;

    this.growthUniform = uniform(clampGrowth(options.growth ?? 1));
    const bark = createBarkMaterial(definition);
    const leaf = createLeafMaterial(definition);
    bark.positionNode = growthPosition(this.growthUniform);
    leaf.positionNode = growthPosition(this.growthUniform);
    this.wood = treeMesh('wood', toBufferGeometry(data.wood), bark);
    this.leaves = treeMesh('leaves', toBufferGeometry(data.leaves), leaf);
    this.add(this.wood, this.leaves);

    this.wind = options.wind ?? sceneWind;
    const trunk = data.skeleton.branches[0]!.points;
    this.windResponse = new WindResponse(definition.wind, {
      height: trunk[trunk.length - 1]!.position[1],
      phase: (hashCombine(seedToUint32(data.seed), hashString('wind')) / 4294967296) * Math.PI * 2,
    });
    const offset = windOffset(this.wind, this.windResponse);
    applyWind(this.wood.material as NodeMaterial, offset);
    applyWind(this.leaves.material, offset);

    const season = createSeasonNodes(definition.season);
    applySeasonToLeafMaterial(this.leaves.material, season);
    this.seasonUniform = season.season;
    this.season = options.season ?? 0;
  }

  /**
   * Season: 0 (first day of spring) .. 1 (last day of winter); sets leaf colour, leaf coverage
   * and blossom from the Definition's Season Profile. Values outside 0..1 wrap around the year.
   * Only updates a uniform, so it is cheap to animate.
   */
  get season(): number {
    return this.seasonUniform.value;
  }

  set season(value: number) {
    if (!Number.isFinite(value)) throw new RangeError(`Tree.season must be a finite number, got ${value}`);
    this.seasonUniform.value = wrapSeason(value);
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
