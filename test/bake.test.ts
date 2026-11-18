import { beforeAll, describe, expect, it } from 'vitest';
import { validateBytes } from 'gltf-validator';
import { Box3, Mesh, MeshStandardMaterial, NodeMaterial, Vector3, type BufferGeometry } from 'three/webgpu';
import { oak } from '../src/species';
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

describe('bakeTree: Roots', () => {
  const vertices = (mesh: Mesh) => mesh.geometry.getAttribute('position').count;

  it("bakes a Species' Roots into the wood: extra vertices that reach every Root tip below the ground", () => {
    const definition = lowPoly.apply(oak);
    expect(definition.roots?.count).toBeGreaterThan(0);
    const rooted = createTree(definition, { seed: 2 });
    const bare = createTree({ ...definition, roots: undefined }, { seed: 2 });
    const wood = bakeTree(rooted).getObjectByName('wood') as Mesh;
    const bareWood = bakeTree(bare).getObjectByName('wood') as Mesh;

    expect(vertices(wood)).toBeGreaterThan(vertices(bareWood));
    const box = new Box3().setFromBufferAttribute(wood.geometry.getAttribute('position') as never);
    const bareBox = new Box3().setFromBufferAttribute(bareWood.geometry.getAttribute('position') as never);
    // The Roots run out past the Root Flare and end below the ground, deeper than the sunk trunk base.
    expect(box.min.y).toBeLessThan(bareBox.min.y);
    const tips = rooted.data.skeleton.roots.map((root) => root.points.at(-1)!.position);
    expect(tips.length).toBe(definition.roots!.count);
    for (const [x, y, z] of tips) {
      expect(y).toBeLessThan(0);
      expect(box.clone().expandByScalar(1e-4).containsPoint(new Vector3(x, y, z))).toBe(true); // float32 positions
      expect(bareBox.containsPoint(new Vector3(x, y, z))).toBe(false);
    }
    rooted.dispose();
    bare.dispose();
  });
});

describe('bakeTree: Fruit', () => {
  // Fruit sets at 0.2, is full size 0.4..0.6, gone from 0.7; green until 0.3, red from 0.6.
  const definition = extendDefinition(lowPoly.broadleaf, {
    fruit: { type: 'round', count: 2, size: 0.2 },
    variation: { season: 0, color: 0 },
    season: {
      fruit: [
        { t: 0.2, value: 0 },
        { t: 0.4, value: 1 },
        { t: 0.6, value: 1 },
        { t: 0.7, value: 0 },
      ],
      fruitColor: [
        { t: 0.3, value: '#00ff00' },
        { t: 0.6, value: '#ff0000' },
      ],
    },
  });
  const extent = (mesh: Mesh) => new Box3().setFromObject(mesh);

  it('exports a fruit mesh at the baked Growth and Season when the tree has Fruit', async () => {
    const tree = createTree(definition, { seed: 2 });
    const baked = bakeTree(tree, { season: 0.5 });
    expect(baked.children.map((c) => c.name)).toEqual(['wood', 'leaves', 'fruit']);
    const fruit = baked.getObjectByName('fruit') as Mesh;
    expect(fruit.material).toBeInstanceOf(MeshStandardMaterial);
    expect((fruit.material as MeshStandardMaterial).name).toBe('fruit');
    expect(Object.keys(fruit.geometry.attributes).filter((n) => n.startsWith('a'))).toEqual([]);

    const gltf = (await exportBakedTree(tree, { season: 0.5, binary: false })) as { nodes: { name: string }[]; materials: { name: string }[] };
    expect(gltf.nodes.map((n) => n.name)).toContain('fruit');
    expect(gltf.materials.map((m) => m.name).sort()).toEqual(['bark', 'fruit', 'leaves']);
    const glb = await exportBakedTree(tree, { season: 0.5 });
    expect((await validate(glb)).numErrors).toBe(0);
    tree.dispose();
  });

  it('has no fruit mesh without Fruit, or out of the Fruit season', async () => {
    const plain = createTree(lowPoly.broadleaf, { seed: 2 });
    expect(bakeTree(plain, { season: 0.5 }).getObjectByName('fruit')).toBeUndefined();
    const gltf = (await exportBakedTree(plain, { season: 0.5, binary: false })) as { nodes: { name: string }[] };
    expect(gltf.nodes.map((n) => n.name)).not.toContain('fruit');
    plain.dispose();

    const tree = createTree(definition, { seed: 2 });
    expect(bakeTree(tree, { season: 0.1 }).getObjectByName('fruit')).toBeUndefined(); // not set yet
    expect(bakeTree(tree, { season: 0.8 }).getObjectByName('fruit')).toBeUndefined(); // dropped
    tree.dispose();
  });

  it('colours Fruit with the Fruit colour track and swells it with the Fruit amount', () => {
    const tree = createTree(definition, { seed: 2 });
    const ripe = bakeTree(tree, { season: 0.6 }).getObjectByName('fruit') as Mesh;
    const color = ripe.geometry.getAttribute('color');
    for (const v of [0, color.count - 1]) {
      expect([color.getX(v), color.getY(v), color.getZ(v)].map((c) => +c.toFixed(4))).toEqual([1, 0, 0]);
    }
    // At 0.3 the amount is 0.5: Fruit whose rank is below it shows at half size.
    const young = bakeTree(tree, { season: 0.3 }).getObjectByName('fruit') as Mesh;
    expect(young.geometry.getAttribute('position').count).toBeLessThan(ripe.geometry.getAttribute('position').count);
    const full = bakeTree(tree, { season: 0.5 }).getObjectByName('fruit') as Mesh;
    expect(full.geometry.getAttribute('position').count).toBe(ripe.geometry.getAttribute('position').count);
    tree.dispose();
  });

  it('bakes Fruit at the baked Growth: a sapling has none, a grown tree all of them', () => {
    const tree = createTree(definition, { seed: 2 });
    expect(bakeTree(tree, { season: 0.5, growth: 0.2 }).getObjectByName('fruit')).toBeUndefined();
    const grown = bakeTree(tree, { season: 0.5 }).getObjectByName('fruit') as Mesh;
    tree.fruit.geometry.computeBoundingBox();
    expect(extent(grown).max.y).toBeCloseTo(tree.fruit.geometry.boundingBox!.max.y, 4);
    tree.dispose();
  });
});
