import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type Material,
  type MeshStandardNodeMaterial,
} from 'three/webgpu';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers, TreeData } from '../generator';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import { assertWebGPURenderer } from '../renderer';
import { applySeasonToLeafMaterial, createSeasonNodes, wrapSeason, type SeasonUniform } from '../season';
import { textureReady, type TextureOptions } from '../textures';

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
 * `season` is a uniform update only (no regeneration, no recompile).
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
  /** The Season uniform the leaf material reads (shared nodes may reference it). */
  readonly seasonUniform: SeasonUniform;

  /**
   * Resolves once every texture of this tree has loaded (at once for a tree without textures);
   * rejects if one fails. Await it before a first render that must show the textures.
   */
  readonly ready: Promise<void>;

  constructor(definition: TreeDefinition, data: TreeData, options: { season?: number; textures?: TextureOptions } = {}) {
    super();
    this.name = 'Tree';
    this.definition = definition;
    this.seed = data.seed;
    this.data = data;

    const bark = createBarkMaterial(definition, options.textures);
    const leaf = createLeafMaterial(definition, options.textures);
    this.wood = treeMesh('wood', toBufferGeometry(data.wood), bark);
    this.leaves = treeMesh('leaves', toBufferGeometry(data.leaves), leaf);
    const textures = [bark.map, bark.normalMap, leaf.map].filter((t) => t !== null);
    this.ready = Promise.all(textures.map(textureReady)).then(() => undefined);
    this.ready.catch(() => {}); // only reported to whoever awaits it
    this.add(this.wood, this.leaves);

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
