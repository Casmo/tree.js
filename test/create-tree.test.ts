import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, Object3D, type BufferGeometry, type MeshStandardNodeMaterial } from 'three/webgpu';
import { createTree, hashGeometry, TreeDefinitionError, UnsupportedRendererError, type Tree, type TreeAttributes } from '../src/index';

const definition = { schemaVersion: 2 } as const;

function meshes(tree: Tree): Mesh[] {
  const out: Mesh[] = [];
  tree.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

/** Hash of what actually ends up on the GPU: the BufferGeometry attributes of every mesh. */
function sceneGeometryHash(tree: Tree): string {
  return meshes(tree)
    .map((m) => {
      const g = m.geometry as BufferGeometry;
      const array = (name: string) => g.getAttribute(name)?.array as Float32Array;
      const custom = Object.keys(g.attributes).filter((name) => name.startsWith('a'));
      return hashGeometry({
        positions: array('position'),
        normals: array('normal'),
        uvs: array('uv'),
        colors: array('color'),
        indices: g.getIndex()!.array as Uint32Array,
        attributes: Object.fromEntries(
          custom.map((name) => [name, { array: array(name), itemSize: g.getAttribute(name).itemSize }]),
        ) as TreeAttributes,
      });
    })
    .join('/');
}

describe('createTree', () => {
  it('returns a three.js object with a wood mesh and a leaf mesh', () => {
    const tree = createTree(definition, { seed: 1 });
    expect(tree).toBeInstanceOf(Object3D);
    expect(meshes(tree)).toEqual([tree.wood, tree.leaves]);
    expect(tree.data.skeleton.branches.length).toBeGreaterThan(1);
    expect(tree.leaves.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('puts the Generator\'s per-vertex attributes on every mesh, for Growth, Season and Wind', () => {
    const tree = createTree(definition, { seed: 1 });
    for (const mesh of meshes(tree)) {
      const g = mesh.geometry as BufferGeometry;
      for (const name of ['aLevel', 'aAlong', 'aAttach', 'aRandom']) expect(g.getAttribute(name).itemSize).toBe(1);
      expect(g.getAttribute('aOrigin').itemSize).toBe(3);
      expect(g.getAttribute('aLevel').count).toBe(g.getAttribute('position').count);
    }
  });

  it('colours leaves from the Season Profile (at Season 0) and the leaf material settings', () => {
    const tree = createTree({
      schemaVersion: 2,
      season: { leafColor: [{ t: 0, value: '#336699' }] },
      materials: { leaf: { roughness: 0.42 } },
    });
    expect(tree.leaves.material.color.getHexString()).toBe('336699');
    expect(tree.leaves.material.roughness).toBe(0.42);
  });

  it('draws leaves double-sided with their per-leaf vertex colours', () => {
    const tree = createTree(definition, { seed: 1 });
    expect(tree.leaves.material.side).toBe(DoubleSide);
    expect(tree.leaves.material.vertexColors).toBe(true);
    expect(tree.leaves.geometry.getAttribute('color').count).toBe(tree.leaves.geometry.getAttribute('position').count);
  });

  it('flat shading (low-poly) draws every mesh faceted; standard shading is smooth', () => {
    for (const mesh of meshes(createTree({ schemaVersion: 2, materials: { shading: 'flat' } }, { seed: 1 }))) {
      expect((mesh.material as MeshStandardNodeMaterial).flatShading).toBe(true);
    }
    for (const mesh of meshes(createTree({ schemaVersion: 2, materials: { shading: 'standard' } }, { seed: 1 }))) {
      expect((mesh.material as MeshStandardNodeMaterial).flatShading).toBe(false);
    }
  });

  it('gives an identical geometry hash for the same Definition and Seed', () => {
    expect(sceneGeometryHash(createTree(definition, { seed: 11 }))).toBe(
      sceneGeometryHash(createTree(definition, { seed: 11 })),
    );
  });

  it('gives a different geometry hash for a different Seed', () => {
    expect(sceneGeometryHash(createTree(definition, { seed: 11 }))).not.toBe(
      sceneGeometryHash(createTree(definition, { seed: 12 })),
    );
  });

  it('uses TSL node materials', () => {
    for (const mesh of meshes(createTree(definition, { seed: 1 }))) {
      expect((mesh.material as { isNodeMaterial?: boolean }).isNodeMaterial).toBe(true);
    }
  });

  it('casts and receives shadows', () => {
    for (const mesh of meshes(createTree(definition, { seed: 1 }))) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it('rejects an invalid Definition with an error naming the field', () => {
    expect(() => createTree({ schemaVersion: 1, trunk: { sides: 2 } })).toThrow(TreeDefinitionError);
    expect(() => createTree({ schemaVersion: 1, trunk: { sides: 2 } })).toThrow(/trunk\.sides/);
  });

  it('dispose() frees geometry and materials', () => {
    const tree = createTree(definition, { seed: 1 });
    const disposed: string[] = [];
    for (const mesh of meshes(tree)) {
      mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
      (mesh.material as Mesh['material'] & { addEventListener: Mesh['addEventListener'] }).addEventListener(
        'dispose',
        () => disposed.push('material'),
      );
    }
    tree.dispose();
    expect(disposed.sort()).toEqual(['geometry', 'geometry', 'material', 'material']);
  });

  it('throws a clear error pointing to WebGPURenderer when drawn by the classic WebGLRenderer', () => {
    const tree = createTree(definition, { seed: 1 });
    const webglRenderer = { isWebGLRenderer: true };
    const draw = () => {
      for (const mesh of meshes(tree)) {
        // This is how WebGLRenderer calls into every object it draws.
        (mesh.onBeforeRender as (...args: unknown[]) => void)(webglRenderer, null, null, mesh.geometry, mesh.material, null);
      }
    };
    expect(draw).toThrow(UnsupportedRendererError);
    expect(draw).toThrow(/WebGPURenderer/);
  });

  it('does not complain when drawn by WebGPURenderer', () => {
    const tree = createTree(definition, { seed: 1 });
    const webgpuRenderer = { isWebGPURenderer: true };
    for (const mesh of meshes(tree)) {
      expect(() =>
        (mesh.onBeforeRender as (...args: unknown[]) => void)(webgpuRenderer, null, null, mesh.geometry, mesh.material, null),
      ).not.toThrow();
    }
  });
});
