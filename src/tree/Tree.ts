import { BufferAttribute, BufferGeometry, Group, Mesh, type Material, type MeshStandardNodeMaterial } from 'three/webgpu';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers, TreeData } from '../generator';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import { assertWebGPURenderer } from '../renderer';

function toBufferGeometry(buffers: GeometryBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2));
  if (buffers.colors) geometry.setAttribute('color', new BufferAttribute(buffers.colors, 3));
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

/**
 * A generated tree as a three.js object. Add it to a scene rendered by `WebGPURenderer`.
 * Growth/Season setters (uniform updates only) arrive in tickets #6/#7.
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

  constructor(definition: TreeDefinition, data: TreeData) {
    super();
    this.name = 'Tree';
    this.definition = definition;
    this.seed = data.seed;
    this.data = data;

    this.wood = treeMesh('wood', toBufferGeometry(data.wood), createBarkMaterial(definition));
    this.leaves = treeMesh('leaves', toBufferGeometry(data.leaves), createLeafMaterial());
    this.add(this.wood, this.leaves);
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
