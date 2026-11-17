import { describe, expect, it } from 'vitest';
import { Mesh, Object3D, type BufferGeometry } from 'three/webgpu';
import { createTree, hashGeometry, TreeDefinitionError, UnsupportedRendererError, type Tree } from '../src/index';

const definition = { schemaVersion: 1 } as const;

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
      return hashGeometry({
        positions: g.getAttribute('position').array as Float32Array,
        normals: g.getAttribute('normal').array as Float32Array,
        uvs: g.getAttribute('uv').array as Float32Array,
        indices: g.getIndex()!.array as Uint32Array,
      });
    })
    .join('/');
}

describe('createTree', () => {
  it('returns a three.js object with a trunk mesh', () => {
    const tree = createTree(definition, { seed: 1 });
    expect(tree).toBeInstanceOf(Object3D);
    expect(meshes(tree)).toHaveLength(1);
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
    expect(disposed.sort()).toEqual(['geometry', 'material']);
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
