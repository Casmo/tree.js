import { beforeAll, describe, expect, it } from 'vitest';
import { validateBytes } from 'gltf-validator';
import { Box3, Mesh, MeshStandardMaterial, NodeMaterial, type BufferGeometry } from 'three/webgpu';
import { bakeTree, createTree, exportBakedTree, extendDefinition, hexToLinear } from '../src/index';
import lowPoly from '../src/styles/low-poly';
import stylized from '../src/styles/stylized';

// GLTFExporter writes its buffers through FileReader, which plain Node lacks (browsers have it).
beforeAll(() => {
  if ('FileReader' in globalThis) return;
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((b) => ((this.result = b), this.onloadend?.()));
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((b) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
        this.onloadend?.();
      });
    }
  }
  (globalThis as Record<string, unknown>).FileReader = NodeFileReader;
});

async function validate(glb: ArrayBuffer) {
  const report = await validateBytes(new Uint8Array(glb), { maxIssues: 100 });
  return report.issues;
}

describe('Baked Tree glTF export', () => {
  it('writes a valid, static binary glTF (no animation, no Growth/Season/Wind attributes)', async () => {
    const tree = createTree(lowPoly.broadleaf, { seed: 42, growth: 0.8, season: 0.3 });
    const glb = await exportBakedTree(tree);
    expect(glb).toBeInstanceOf(ArrayBuffer);
    const issues = await validate(glb);
    expect(issues.numErrors, JSON.stringify(issues.messages.slice(0, 5))).toBe(0);
    tree.dispose();
  });

  it('uses standard PBR materials only and stores nothing that moves', async () => {
    const tree = createTree(stylized.broadleaf, { seed: 3, growth: 0.9, season: 0.02 });
    const gltf = await exportBakedTree(tree, { binary: false });
    const json = gltf as {
      animations?: unknown[];
      extensionsUsed?: string[];
      materials: { name: string; pbrMetallicRoughness?: { metallicFactor?: number } }[];
      meshes: { name: string; primitives: { attributes: Record<string, number> }[] }[];
    };
    expect(json.animations ?? []).toEqual([]);
    expect(json.extensionsUsed ?? []).toEqual([]);
    expect(json.materials.map((m) => m.name).sort()).toEqual(['bark', 'leaves']);
    for (const material of json.materials) expect(material.pbrMetallicRoughness?.metallicFactor).toBe(0);
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        expect(Object.keys(primitive.attributes).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0']);
      }
    }
    tree.dispose();
  });

  it('bakes into plain MeshStandardMaterial meshes without node or Growth/Season/Wind attributes', () => {
    const tree = createTree(lowPoly.conifer, { seed: 1 });
    const baked = bakeTree(tree);
    expect(baked.children.map((c) => c.name)).toEqual(['wood', 'leaves']);
    for (const mesh of baked.children as Mesh[]) {
      expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
      expect(mesh.material).not.toBeInstanceOf(NodeMaterial);
      expect(Object.keys((mesh.geometry as BufferGeometry).attributes).filter((n) => n.startsWith('a'))).toEqual([]);
    }
    tree.dispose();
  });
});

describe('bakeTree: Growth and Season', () => {
  const size = (geometry: BufferGeometry) => new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never).max.y;

  it('a fully grown tree keeps the generated shape; a young one is smaller', () => {
    const tree = createTree(lowPoly.broadleaf, { seed: 2 });
    const full = bakeTree(tree, { growth: 1 }).getObjectByName('wood') as Mesh;
    const young = bakeTree(tree, { growth: 0.3 }).getObjectByName('wood') as Mesh;
    tree.wood.geometry.computeBoundingBox();
    expect(size(full.geometry)).toBeCloseTo(tree.wood.geometry.boundingBox!.max.y, 5);
    expect(size(young.geometry)).toBeLessThan(size(full.geometry) * 0.6);
    tree.dispose();
  });

  it('bakes every Stem of a multi-Stem tree, at full size and as a young tree', () => {
    const tree = createTree(extendDefinition(lowPoly.broadleaf, { trunk: { stems: 3, spread: 25 } }), { seed: 2 });
    const wide = (geometry: BufferGeometry) => {
      const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never);
      return Math.min(box.max.x - box.min.x, box.max.z - box.min.z);
    };
    const full = bakeTree(tree, { growth: 1 }).getObjectByName('wood') as Mesh;
    const sapling = bakeTree(tree, { growth: 0 }).getObjectByName('wood') as Mesh;
    tree.wood.geometry.computeBoundingBox();
    expect(size(full.geometry)).toBeCloseTo(tree.wood.geometry.boundingBox!.max.y, 5);
    // Even a sapling is all its Stems (only the branches wait to sprout): wider than one thin trunk.
    expect(wide(sapling.geometry)).toBeGreaterThan(size(sapling.geometry) * 0.2);
    tree.dispose();
  });

  it('defaults to the tree\'s own Growth and Season', () => {
    const tree = createTree(lowPoly.broadleaf, { seed: 2, growth: 0.3 });
    const wood = bakeTree(tree).getObjectByName('wood') as Mesh;
    expect(bakeTree(tree, { growth: 0.3 }).userData).toMatchObject({ growth: 0.3, season: 0 });
    tree.growth = 1;
    expect(size(wood.geometry)).toBeLessThan(size((bakeTree(tree).getObjectByName('wood') as Mesh).geometry));
    tree.dispose();
  });

  it('drops leaves that have not sprouted yet or have fallen', () => {
    const tree = createTree(lowPoly.broadleaf, { seed: 2 });
    expect(bakeTree(tree, { growth: 0.1 }).getObjectByName('leaves')).toBeUndefined(); // bare sapling
    expect(bakeTree(tree, { season: 0.85 }).getObjectByName('leaves')).toBeUndefined(); // deciduous winter
    const summer = bakeTree(tree, { season: 0.3 }).getObjectByName('leaves') as Mesh;
    expect(summer.geometry.getAttribute('position').count).toBeGreaterThan(0);
    tree.dispose();
  });

  it('colours each leaf with the Season Profile colour (times its tint)', () => {
    const definition = extendDefinition(lowPoly.broadleaf, { variation: { color: 0, season: 0 } });
    const tree = createTree(definition, { seed: 2 });
    const leaves = bakeTree(tree, { season: 0.3 }).getObjectByName('leaves') as Mesh;
    const color = leaves.geometry.getAttribute('color');
    const summer = hexToLinear('#3e7d2b'); // deciduous: deep green 0.2..0.5
    for (const v of [0, Math.floor(color.count / 2), color.count - 1]) {
      expect([color.getX(v), color.getY(v), color.getZ(v)].map((c) => +c.toFixed(5))).toEqual(summer.map((c) => +c.toFixed(5)));
    }
    tree.dispose();
  });
});
