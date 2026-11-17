import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Material,
  type MeshStandardNodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers, TreeData } from '../generator';
import { clampGrowth, growthPosition } from '../growth';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import { assertWebGPURenderer } from '../renderer';

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
}

/**
 * A generated tree as a three.js object. Add it to a scene rendered by `WebGPURenderer`.
 * `growth` (and, later, `season`) only update uniforms: the geometry is never regenerated.
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
