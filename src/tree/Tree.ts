import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Material,
  type MeshStandardNodeMaterial,
  type NodeMaterial,
} from 'three/webgpu';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers, TreeData } from '../generator';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import { assertWebGPURenderer } from '../renderer';
import { hashCombine, hashString, seedToUint32 } from '../random';
import { applyWind, sceneWind, windOffset, Wind, WindResponse } from '../wind';

export interface TreeOptions {
  /** The Wind this tree sways with. Default: the scene-wide {@link sceneWind}. */
  wind?: Wind;
}

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

    this.wood = treeMesh('wood', toBufferGeometry(data.wood), createBarkMaterial(definition));
    this.leaves = treeMesh('leaves', toBufferGeometry(data.leaves), createLeafMaterial(definition));
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
