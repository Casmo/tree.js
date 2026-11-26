import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { validateBytes } from 'gltf-validator';
import { Box3, Color, DataTexture, FrontSide, Mesh, MeshStandardMaterial, NodeMaterial, RepeatWrapping, SRGBColorSpace, Texture, Vector3, type BufferGeometry } from 'three/webgpu';
import { loadSpecies, oak } from '../src/species';
import { bakeTree, createTree, crownNormal, exportBakedTree, extendDefinition, hexToLinear, SUGGESTED_MATERIAL_FEATURES, withMaterialFeatures, type Tree, type TreeDefinition } from '../src/index';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';
import painterly from '../src/styles/painterly';
import enchanted from '../src/styles/enchanted';
import whimsical from '../src/styles/whimsical';
import { definitionForSeed, evaluateSeason } from '../src/season';
import { installGltfExporterGlobals } from './fixtures/node-gltf';

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

// SHA-256 of a .glb that doesn't depend on the Node version: Math.pow and friends may differ in the
// last bit between V8 releases, which shows up in the JSON chunk's float64 material factors. Numbers
// there are rounded to 12 significant digits; the binary chunk (float32 geometry) is hashed as is.
function glbHash(glb: ArrayBuffer) {
  const view = new DataView(glb);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as unknown;
  const rounded = JSON.stringify(json, (_key, value: unknown) => (typeof value === 'number' ? Number(value.toPrecision(12)) : value));
  return createHash('sha256').update(rounded).update(new Uint8Array(glb, 20 + jsonLength)).digest('hex');
}

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

describe('Baked Tree: Material Features', () => {
  const features = (definition: TreeDefinition, leaf: Partial<TreeDefinition['materials']['leaf']>, occlusion?: { strength: number }) =>
    ({ ...definition, materials: { ...definition.materials, leaf: { ...definition.materials.leaf, ...leaf }, ...(occlusion ? { occlusion } : {}) } });
  /** Mean of dot(NORMAL, crown normal) over the leaf vertices; 1 when every normal is the crown's. */
  const crownAlignment = (tree: Tree, mesh: Mesh, growth = 1) => {
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const scale = 0.2 + 0.8 * growth;
    let sum = 0;
    for (let v = 0; v < position.count; v++) {
      const c = crownNormal(tree.data.crown, [position.getX(v) / scale, position.getY(v) / scale, position.getZ(v) / scale]);
      sum += normal.getX(v) * c[0] + normal.getY(v) * c[1] + normal.getZ(v) * c[2];
    }
    return sum / position.count;
  };

  for (const [name, definition] of [['standard', realistic.broadleaf], ['flat', extendDefinition(lowPoly.broadleaf, { leaves: { shape: 'card' } })]] as const) {
    it(`writes the crown normals (blended) into NORMAL with Crown Normals (${name} shading)`, () => {
      const plain = createTree(definition, { seed: 4 });
      const half = createTree(features(definition, { crownNormals: 0.5 }), { seed: 4 });
      const full = createTree(features(definition, { crownNormals: 1 }), { seed: 4 });
      const leaves = (tree: Tree) => bakeTree(tree, { season: 0.3 }).getObjectByName('leaves') as Mesh;
      const [a0, a5, a1] = [crownAlignment(plain, leaves(plain)), crownAlignment(half, leaves(half)), crownAlignment(full, leaves(full))];
      expect(a0).toBeLessThan(0.5);
      expect(a5).toBeGreaterThan(a0 + 0.2);
      expect(a1).toBeGreaterThan(0.999);
      // A young tree is measured against its own, smaller crown.
      expect(crownAlignment(full, bakeTree(full, { growth: 0.8, season: 0.3 }).getObjectByName('leaves') as Mesh, 0.8)).toBeGreaterThan(0.999);
      // Each flat card faces the crown's outside: its winding agrees with its normal, so a double-sided engine
      // doesn't turn the normal of half the cards inwards.
      const mesh = leaves(full); // at 1 every normal is the crown's: a card wound inwards would face against it
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const p = geometry.getAttribute('position');
      const n = geometry.getAttribute('normal');
      for (let t = 0; t < p.count; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p as never, t + k));
        const face = b!.sub(a!).cross(c!.sub(a!));
        expect(face.dot(new Vector3().fromBufferAttribute(n as never, t))).toBeGreaterThanOrEqual(-1e-12);
      }
      for (const tree of [plain, half, full]) tree.dispose();
    });
  }

  it('keeps the winding of solid leaf shapes (closed): their front faces are already their outside', async () => {
    const definition = stylized.apply(await loadSpecies('oak')); // puffs
    const plain = bakeTree(createTree(definition, { seed: 1 })).getObjectByName('leaves') as Mesh;
    const full = createTree(features(definition, { crownNormals: 1 }), { seed: 1 });
    const blended = bakeTree(full).getObjectByName('leaves') as Mesh;
    expect(Array.from(blended.geometry.index!.array)).toEqual(Array.from(plain.geometry.index!.array));
    expect(crownAlignment(full, blended)).toBeGreaterThan(0.999);
    full.dispose();
  });
});

describe('Baked Tree: Material Features off', () => {
  // Hash (glbHash) of the .glb as exported before Material Features existed: with none set, nothing changes.
  const golden: [string, () => TreeDefinition, { seed: number; growth?: number; season?: number }, string][] = [
    ['low-poly broadleaf', () => lowPoly.broadleaf, { seed: 42, growth: 0.8, season: 0.3 }, '68a85e2222cb1cba08f6b1131a84334fd68f0e8a52d704c94042a60f31dd3645'],
    ['stylized broadleaf', () => stylized.broadleaf, { seed: 3, growth: 0.9, season: 0.02 }, '4e1f2517bb5684580e8eb5a754aec1e811422fa976897bd5cd4d9d31fc136bd7'],
    ['low-poly oak with Fruit', () => extendDefinition(lowPoly.apply(oak), { fruit: { type: 'round', count: 2, size: 0.2 } }), { seed: 2, season: 0.5 }, '883a9d503b07178d2d7efe82df57d42002a45b72c12530be1fdb1e37c0dc2150'],
  ];
  for (const [name, definition, options, hash] of golden) {
    it(`exports the same glTF as before (${name})`, async () => {
      const tree = createTree(definition(), options);
      const glb = await exportBakedTree(tree, { occlusionInVertexColors: true });
      expect(glbHash(glb)).toBe(hash);
      tree.dispose();
    });
  }
});

describe('Baked Tree: Structural Occlusion, Leaf Translucency and the treejs extras', () => {
  type Json = {
    extensionsUsed?: string[];
    accessors: { min?: number[]; max?: number[]; type: string }[];
    materials: { name: string; extras?: Record<string, unknown>; extensions?: Record<string, Record<string, unknown>> }[];
    meshes: { name: string; primitives: { attributes: Record<string, number> }[] }[];
  };
  const fruity = extendDefinition(stylized.broadleaf, { fruit: { type: 'round', count: 2, size: 0.2 } });
  const withFeatures = (definition: TreeDefinition, materials: { crownNormals?: number; translucency?: { strength: number; edge: number; ambient: number }; occlusion?: { strength: number } }) => ({
    ...definition,
    materials: {
      ...definition.materials,
      leaf: { ...definition.materials.leaf, ...(materials.crownNormals ? { crownNormals: materials.crownNormals } : {}), ...(materials.translucency ? { translucency: materials.translucency } : {}) },
      ...(materials.occlusion ? { occlusion: materials.occlusion } : {}),
    },
  });
  const colors = (mesh: Mesh) => Array.from(mesh.geometry.getAttribute('color').array as Float32Array);

  it('writes _OCCLUSION (0..1) on wood, leaves and Fruit only with Structural Occlusion', async () => {
    const off = createTree(fruity, { seed: 5 });
    const on = createTree(withFeatures(fruity, { occlusion: { strength: 0.7 } }), { seed: 5 });
    const offJson = (await exportBakedTree(off, { season: 0.5, binary: false })) as Json;
    const onJson = (await exportBakedTree(on, { season: 0.5, binary: false })) as Json;
    for (const mesh of offJson.meshes) expect(Object.keys(mesh.primitives[0]!.attributes)).not.toContain('_OCCLUSION');
    expect(onJson.meshes.length).toBe(3); // wood, leaves and Fruit
    for (const mesh of onJson.meshes) {
      const accessor = onJson.accessors[mesh.primitives[0]!.attributes._OCCLUSION!]!;
      expect(accessor.type).toBe('SCALAR');
      expect(accessor.min![0]).toBeGreaterThanOrEqual(1 - 0.7);
      expect(accessor.max![0]).toBeLessThanOrEqual(1);
      expect(accessor.min![0]).toBeLessThan(accessor.max![0]!); // the inside of the crown is darker
    }
    // strength 0 shows no occlusion: all open
    on.occlusionStrength = 0;
    const leaves = bakeTree(on, { season: 0.5 }).getObjectByName('leaves') as Mesh;
    expect(Math.min(...(leaves.geometry.getAttribute('_occlusion').array as Float32Array))).toBe(1);
    expect((await validate(await exportBakedTree(on, { season: 0.5 }))).numErrors).toBe(0);
    off.dispose();
    on.dispose();
  });

  it('multiplies the occlusion into COLOR_0 only with occlusionInVertexColors', () => {
    const plain = createTree(fruity, { seed: 5 });
    const on = createTree(withFeatures(fruity, { occlusion: { strength: 0.7 } }), { seed: 5 });
    for (const name of ['wood', 'leaves', 'fruit']) {
      const reference = colors(bakeTree(plain, { season: 0.5 }).getObjectByName(name) as Mesh);
      expect(colors(bakeTree(on, { season: 0.5 }).getObjectByName(name) as Mesh)).toEqual(reference);
      const darkened = bakeTree(on, { season: 0.5, occlusionInVertexColors: true }).getObjectByName(name) as Mesh;
      const ao = darkened.geometry.getAttribute('_occlusion');
      const darker = colors(darkened);
      for (const v of [0, ao.count >> 1, ao.count - 1]) expect(darker[v * 3]).toBeCloseTo(reference[v * 3]! * ao.getX(v), 6);
      expect(darker.some((c, i) => c < reference[i]! - 1e-3)).toBe(true);
    }
    // Flat-shaded wood has no vertex colours of its own: the option gives it the occlusion as COLOR_0.
    const flat = createTree(withFeatures(lowPoly.broadleaf, { occlusion: { strength: 1 } }), { seed: 5 });
    expect((bakeTree(flat).getObjectByName('wood') as Mesh).geometry.hasAttribute('color')).toBe(false);
    const wood = bakeTree(flat, { occlusionInVertexColors: true }).getObjectByName('wood') as Mesh;
    expect((wood.material as MeshStandardMaterial).vertexColors).toBe(true);
    expect(wood.geometry.getAttribute('color').getY(0)).toBeCloseTo(wood.geometry.getAttribute('_occlusion').getX(0), 6);
    for (const tree of [plain, on, flat]) tree.dispose();
  });

  it('writes Leaf Translucency as KHR_materials_diffuse_transmission on the leaf material', async () => {
    const definition = extendDefinition(withFeatures(lowPoly.broadleaf, { translucency: { strength: 0.6, edge: 0.7, ambient: 0.3 } }), { variation: { color: 0, season: 0 } });
    const tree = createTree(definition, { seed: 3, season: 0.3 });
    const json = (await exportBakedTree(tree, { binary: false })) as Json;
    expect(json.extensionsUsed).toEqual(['KHR_materials_diffuse_transmission']);
    const leaves = json.materials.find((m) => m.name === 'leaves')!;
    const transmission = leaves.extensions!.KHR_materials_diffuse_transmission!;
    expect(transmission.diffuseTransmissionFactor).toBe(0.6);
    const summer = hexToLinear('#3e7d2b'); // the leaf colour at this Season
    expect((transmission.diffuseTransmissionColorFactor as number[]).map((c) => +c.toFixed(4))).toEqual(summer.map((c) => +c.toFixed(4)));
    expect(json.materials.find((m) => m.name === 'bark')!.extensions).toBeUndefined();
    expect((await validate(await exportBakedTree(tree))).numErrors).toBe(0);
    tree.dispose();
  });

  it('puts the raw settings and the Crown Volume in a treejs extras object on the leaf and bark materials', async () => {
    const translucency = { strength: 0.5, edge: 0.6, ambient: 0.3 };
    const tree = createTree(withFeatures(fruity, { crownNormals: 0.8, translucency, occlusion: { strength: 0.7 } }), { seed: 5, growth: 0.8, season: 0.5 });
    const json = (await exportBakedTree(tree, { binary: false })) as Json;
    const scale = 0.2 + 0.8 * 0.8; // the Baked Tree's Growth scale: the Volume is in the baked geometry's space
    const { center, radii } = tree.data.crown;
    for (const name of ['leaves', 'bark']) {
      const extras = json.materials.find((m) => m.name === name)!.extras!.treejs as Record<string, unknown>;
      expect(extras).toMatchObject({ crownNormals: 0.8, translucency, occlusion: { strength: 0.7 } });
      const crown = extras.crown as { center: number[]; radii: number[] };
      crown.center.forEach((c, i) => expect(c).toBeCloseTo(center[i]! * scale, 6));
      crown.radii.forEach((r, i) => expect(r).toBeCloseTo(radii[i]! * scale, 6));
    }
    expect(json.materials.find((m) => m.name === 'fruit')?.extras).toBeUndefined();
    // Only the features that are set.
    const only = createTree(withFeatures(realistic.broadleaf, { crownNormals: 1 }), { seed: 5 });
    const onlyJson = (await exportBakedTree(only, { binary: false })) as Json;
    expect(Object.keys(onlyJson.materials.find((m) => m.name === 'leaves')!.extras!.treejs as object).sort()).toEqual(['crown', 'crownNormals']);
    expect(onlyJson.extensionsUsed ?? []).toEqual([]);
    expect((await validate(await exportBakedTree(tree, { occlusionInVertexColors: true }))).numErrors).toBe(0);
    const report = await validate(await exportBakedTree(only)); expect(report.numErrors, JSON.stringify(report.messages.slice(0, 3))).toBe(0);
    tree.dispose();
    only.dispose();
  });

  it('says in the extras that _OCCLUSION already has the strength applied, and whether COLOR_0 carries it too', async () => {
    const tree = createTree(withFeatures(fruity, { occlusion: { strength: 0.7 } }), { seed: 5 });
    const occlusionOf = async (options: { occlusionInVertexColors?: boolean }) => {
      const json = (await exportBakedTree(tree, { ...options, binary: false })) as Json;
      return (json.materials.find((m) => m.name === 'leaves')!.extras!.treejs as { occlusion: unknown }).occlusion;
    };
    expect(await occlusionOf({})).toEqual({ strength: 0.7, strengthApplied: true, inVertexColors: false });
    expect(await occlusionOf({ occlusionInVertexColors: true })).toEqual({ strength: 0.7, strengthApplied: true, inVertexColors: true });
    tree.dispose();
  });
});

describe('Baked Tree: Painterly (#120), an approximation of the painted shading', () => {
  type Json = {
    materials: { name: string; alphaMode?: string; extras?: { treejs?: Record<string, unknown> } }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    nodes: { name: string; mesh?: number }[];
  };
  const leavesOf = (tree: Tree) => bakeTree(tree, { season: 0.3 }).getObjectByName('leaves') as Mesh;
  const vec = (geometry: BufferGeometry, name: string, v: number) => new Vector3().fromBufferAttribute(geometry.getAttribute(name) as never, v);
  const luminance = (c: Vector3) => 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z;

  for (const [form, definition] of [['broadleaf', painterly.broadleaf], ['conifer', painterly.conifer]] as const) {
    it(`exports a valid glTF of a painterly ${form}: geometry, vertex colours, standard materials and the Painterly settings in extras`, async () => {
      const tree = createTree(definition, { seed: 42 });
      const report = await validate(await exportBakedTree(tree, { season: 0.3 }));
      expect(report.numErrors, JSON.stringify(report.messages.slice(0, 5))).toBe(0);
      const json = (await exportBakedTree(tree, { season: 0.3, binary: false })) as Json;
      expect(json.materials.map((m) => m.name).sort()).toEqual(['bark', 'leaves']);
      const leaves = json.meshes[json.nodes.find((n) => n.name === 'leaves')!.mesh!]!.primitives[0]!.attributes;
      expect(Object.keys(leaves).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', '_MASS_NORMAL', '_PAINT']);
      const extras = (name: string) => json.materials.find((m) => m.name === name)!.extras?.treejs as Record<string, unknown>;
      expect(extras('bark')).toEqual({ painted: { wrap: 0.5, warm: [1.06, 1.02, 0.9] } });
      expect(extras('leaves')).toMatchObject({
        painted: {
          wrap: 0.5,
          warm: [1.06, 1.02, 0.9],
          leafMasses: { masses: definition.leaves.masses, massLayering: definition.leaves.massLayering ?? 1, bend: 0.85, sunlit: 0.35, leafShadow: 0.3 },
        },
      });
      tree.dispose();
    });
  }

  it("bakes a painterly tree with its Style's suggested Material Features: both in the extras, still valid", async () => {
    const tree = createTree(withMaterialFeatures(painterly.broadleaf, SUGGESTED_MATERIAL_FEATURES.painterly), { seed: 42 });
    const report = await validate(await exportBakedTree(tree, { season: 0.3 }));
    expect(report.numErrors, JSON.stringify(report.messages.slice(0, 5))).toBe(0);
    const json = (await exportBakedTree(tree, { season: 0.3, binary: false })) as Json;
    const extras = json.materials.find((m) => m.name === 'leaves')!.extras!.treejs!;
    expect(Object.keys(extras).sort()).toEqual(['crown', 'crownNormals', 'occlusion', 'painted', 'translucency']);
    tree.dispose();
  });

  it('bends the leaf normals towards their Leaf Mass, the same on both sides of each card', () => {
    const tree = createTree(painterly.broadleaf, { seed: 42 });
    const mesh = leavesOf(tree);
    const geometry = mesh.geometry.toNonIndexed();
    const count = geometry.getAttribute('position').count;
    let sum = 0;
    for (let v = 0; v < count; v++) sum += vec(geometry, 'normal', v).dot(vec(geometry, '_mass_normal', v));
    expect(sum / count).toBeGreaterThan(0.95);
    // Live both sides of a card are lit with its lighting normal; engines flip it on the back of a double-sided
    // material. So each card is in twice, once each way round, with a single-sided material.
    expect((mesh.material as MeshStandardMaterial).side).toBe(FrontSide);
    const index = Array.from(mesh.geometry.index!.array);
    const half = index.length / 2;
    for (let t = 0; t < half; t += 3) expect(index.slice(half + t, half + t + 3)).toEqual([index[t], index[t + 2], index[t + 1]]);
    tree.dispose();
  });

  it('paints the crown gradient into the vertex colours: deep inside the masses, light on the open tips', () => {
    const tree = createTree(extendDefinition(painterly.broadleaf, { variation: { color: 0, season: 0 } }), { seed: 42 });
    const { geometry } = leavesOf(tree);
    const paint = geometry.getAttribute('_paint');
    const buried: number[] = [];
    const tips: number[] = [];
    for (let v = 0; v < paint.count; v++) {
      const l = luminance(vec(geometry, 'color', v));
      if (paint.getY(v) > 0.6) buried.push(l);
      else if (paint.getY(v) < 0.15 && paint.getZ(v) > 0.7) tips.push(l);
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(buried.length).toBeGreaterThan(10);
    expect(tips.length).toBeGreaterThan(10);
    expect(mean(buried)).toBeLessThan(mean(tips) * 0.5);
    // The tips warmer (more red to their green) than the plain summer green, the inside cooler (more blue).
    const summer = new Vector3(...hexToLinear('#3e7d2b'));
    const ratio = (pick: (v: number) => boolean, a: 'x' | 'z') => {
      let [sum, green] = [0, 0];
      for (let v = 0; v < paint.count; v++) if (pick(v)) [sum, green] = [sum + vec(geometry, 'color', v)[a], green + vec(geometry, 'color', v).y];
      return sum / green;
    };
    expect(ratio((v) => paint.getY(v) < 0.15 && paint.getZ(v) > 0.7, 'x')).toBeGreaterThan(summer.x / summer.y);
    expect(ratio((v) => paint.getY(v) > 0.6, 'z')).toBeGreaterThan(summer.z / summer.y);
    tree.dispose();
  });

  it("bakes the spray's paint value into a brightness map, keeping its cut-out", () => {
    const tree = createTree(painterly.broadleaf, { seed: 42 });
    // Four texels (sRGB grey, alpha): three covered (paint values 64, 128, 200), one cut out.
    const spray = new Texture({ data: new Uint8Array([64, 64, 64, 255, 128, 128, 128, 255, 200, 200, 200, 255, 255, 255, 255, 0]), width: 2, height: 2 });
    tree.leaves.material.map = spray;
    const leaves = bakeTree(tree, { season: 0.3 }).getObjectByName('leaves') as Mesh;
    const material = leaves.material as MeshStandardMaterial;
    const texels = Array.from((material.map!.image as { data: Uint8Array }).data);
    // COLOR_0 is painted at the light end of the covered texels' paint values (linear 0.0513, 0.2159, 0.5776).
    expect((material.userData.treejs as { painted: { leafMasses: { paintValue: number } } }).painted.leafMasses.paintValue).toBeCloseTo(0.5776, 3);
    expect(texels.filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 0]); // the cut-out as it was
    const grey = texels.filter((_, i) => i % 4 === 0);
    expect(texels.filter((_, i) => i % 4 === 1)).toEqual(grey);
    expect(grey[2]).toBe(255); // at the painted value: white, the vertex colour as it is
    expect(grey[0]).toBeLessThan(grey[1]!); // darker strokes darker
    expect(grey[1]).toBeLessThan(grey[2]!);
    expect(spray.image.data[0]).toBe(64); // the tree's own texture is untouched
    tree.dispose();
  });
});

// The Fantasy Styles (#142, ADR 0017): an Enchanted tree's Inner Glow exported as a steady emissive (glTF
// emissive, KHR_materials_emissive_strength), and Whimsical's candy stripes as a bark map. Exported with a
// stand-in canvas for the images (test/fixtures/node-gltf.ts) and checked with the glTF validator.
describe('Baked Tree: the Fantasy Styles', () => {
  let uninstall: () => void;
  beforeAll(() => (uninstall = installGltfExporterGlobals()));
  afterAll(() => uninstall());

  type FantasyJson = {
    extensionsUsed?: string[];
    materials: {
      name: string;
      emissiveFactor?: number[];
      emissiveTexture?: { index: number };
      pbrMetallicRoughness?: { baseColorTexture?: { index: number }; baseColorFactor?: number[] };
      extensions?: Record<string, Record<string, unknown>>;
      extras?: { treejs?: Record<string, unknown> };
    }[];
  };


  /** A 2×2 sRGB RGBA texture (rows top to bottom). */
  const texture2x2 = (texels: number[]) => {
    const map = new DataTexture(new Uint8Array(texels), 2, 2);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.needsUpdate = true;
    return map;
  };
  /** A grey card: veins (alpha 255) in two texels, none in the others. */
  const veinedBark = () => texture2x2([90, 90, 90, 255, 90, 90, 90, 0, 90, 90, 90, 0, 90, 90, 90, 255]);
  const card = () => texture2x2([200, 200, 200, 255, 40, 40, 40, 255, 255, 255, 255, 0, 120, 120, 120, 255]);

  /** An Enchanted tree with stand-in textures (Node loads no images). */
  function enchantedTree(seed = 1): Tree {
    const tree = createTree(enchanted.broadleaf, { seed, season: 0.4 });
    (tree.wood.material as MeshStandardMaterial).map = veinedBark();
    tree.leaves.material.map = card();
    return tree;
  }

  /** The baked material of 'bark' (the wood mesh) or 'leaves'. */
  const part = (baked: ReturnType<typeof bakeTree>, name: 'bark' | 'leaves') => (baked.getObjectByName(name === 'bark' ? 'wood' : name) as Mesh).material as MeshStandardMaterial;
  /** The emissive a material gives off: its colour × intensity. */
  const glow = (material: MeshStandardMaterial) => material.emissive.clone().multiplyScalar(material.emissiveIntensity);
  /** Hue direction of a colour (normalised). */
  const direction = (c: Color | number[]) => {
    const [r, g, b] = Array.isArray(c) ? c : [c.r, c.g, c.b];
    const n = Math.hypot(r!, g!, b!);
    return [r! / n, g! / n, b! / n];
  };

  describe('Baked Tree: Enchanted Inner Glow (#142)', () => {
    it('gives the leaves a steady emissive: their own colour, with the leaf card as its texture', () => {
      const tree = enchantedTree();
      const leaves = bakeTree(tree).getObjectByName('leaves') as Mesh;
      const material = leaves.material as MeshStandardMaterial;
      expect(glow(material).r + glow(material).g + glow(material).b).toBeGreaterThan(0.3);
      // The colour of the leaves (mean of COLOR_0): the glow has their hue.
      const colors = leaves.geometry.getAttribute('color');
      const mean = [0, 1, 2].map((c) => {
        let sum = 0;
        for (let v = 0; v < colors.count; v++) sum += colors.getComponent(v, c);
        return sum / colors.count;
      });
      direction(glow(material)).forEach((c, i) => expect(c).toBeCloseTo(direction(mean)[i]!, 2));
      // Shines where the card is bright (its veins and edge), as live.
      expect(material.emissiveMap).toBe(material.map);
      tree.dispose();
    });

    it('is steady: the same however far the pulse is, and follows the live glow strength', () => {
      const tree = enchantedTree();
      const at = (time: number) => {
        tree.wind.time = time;
        return glow(part(bakeTree(tree), 'leaves'));
      };
      const one = at(0);
      expect(at(2.3).equals(one)).toBe(true);
      tree.innerGlow = { leaf: 2 };
      const two = at(0);
      expect(two.r).toBeCloseTo(one.r * 2, 6);
      expect(two.g).toBeCloseTo(one.g * 2, 6);
      tree.innerGlow = { leaf: 0 };
      expect(part(bakeTree(tree), 'leaves').emissive.getHex()).toBe(0);
      expect(part(bakeTree(tree), 'leaves').emissiveMap).toBeNull();
      tree.dispose();
    });

    it("lights the bark veins (the bark map's alpha) in the tree's Season leaf colour", () => {
      const tree = enchantedTree(3);
      const bark = part(bakeTree(tree, { season: 0.4 }), 'bark');
      // The vein mask as a grey texture (glTF emissive reads no alpha), tiled as the bark map.
      const veins = bark.emissiveMap!;
      expect(Array.from((veins.image as { data: Uint8Array }).data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
      expect(veins.repeat.toArray()).toEqual(bark.map!.repeat.toArray());
      // In the leaf colour of this tree's Leaf Palette at the baked Season.
      const { leafColor } = evaluateSeason(definitionForSeed(tree.definition, tree.seed).season, 0.4);
      direction(glow(bark)).forEach((c, i) => expect(c).toBeCloseTo(direction(leafColor)[i]!, 3));
      tree.innerGlow = { veins: 0 };
      expect(part(bakeTree(tree), 'bark').emissiveMap).toBeNull();
      tree.dispose();
    });

    it('exports valid glTF: emissive factors, KHR_materials_emissive_strength and the Inner Glow settings in the extras', async () => {
      const tree = enchantedTree();
      const glb = await exportBakedTree(tree, { season: 0.4 });
      const report = await validate(glb);
      expect(report.numErrors, JSON.stringify(report.messages.slice(0, 5))).toBe(0);
      const json = (await exportBakedTree(tree, { season: 0.4, binary: false })) as FantasyJson;
      expect(json.extensionsUsed).toContain('KHR_materials_emissive_strength');
      for (const name of ['bark', 'leaves']) {
        const material = json.materials.find((m) => m.name === name)!;
        expect(material.emissiveFactor!.some((c) => c > 0), name).toBe(true);
        expect(material.emissiveTexture, name).toBeDefined();
        expect(material.extras?.treejs?.innerGlow, name).toEqual({ leaf: 1, veins: 1, pulse: { period: 7, low: 0.6, baked: 0.8 } });
      }
      tree.dispose();
    });

    it('is only drawn by the enchanted shading: another shading with an innerGlow block bakes no emissive', () => {
      const definition = extendDefinition(realistic.broadleaf, { materials: { innerGlow: { leaf: 1, veins: 1 } } });
      const tree = createTree(definition, { seed: 1 });
      const baked = bakeTree(tree);
      for (const name of ['bark', 'leaves'] as const) {
        expect(part(baked, name).emissive.getHex(), name).toBe(0);
        expect(part(baked, name).userData.treejs?.innerGlow, name).toBeUndefined();
      }
      tree.dispose();
    });
  });

  describe('Baked Tree: Whimsical candy stripes (#142)', () => {
    it('bakes the candy stripes into a bark map: the bark colour with stripes in the accent colour', async () => {
      const tree = createTree(whimsical.broadleaf, { seed: 2 });
      const definition = definitionForSeed(tree.definition, tree.seed);
      const accent = definition.season.leafPalettes![0]!.accent;
      const bark = part(bakeTree(tree), 'bark');
      expect(bark.color.getHex()).toBe(0xffffff); // the colour is all in the map (and the vertex shade)
      const { data, width, height } = bark.map!.image as { data: Uint8Array; width: number; height: number };
      const texels = Array.from({ length: width * height }, (_, i) => new Color().setRGB(data[i * 4]! / 255, data[i * 4 + 1]! / 255, data[i * 4 + 2]! / 255, SRGBColorSpace).getHexString());
      const share = (hex: string) => texels.filter((t) => t === hex.slice(1)).length / texels.length;
      expect(share(accent)).toBeGreaterThan(0.3);
      expect(share(accent)).toBeLessThan(0.45);
      expect(share(definition.materials.bark.color)).toBeGreaterThan(0.5);
      expect(bark.map!.wrapS).toBe(RepeatWrapping);
      const report = await validate(await exportBakedTree(tree));
      expect(report.numErrors, JSON.stringify(report.messages.slice(0, 5))).toBe(0);
      tree.dispose();
    });

    it('winds the stripes as the live bark does: a stripe runs on round the branch and along it (uv.x + uv.y)', () => {
      const tree = createTree(whimsical.broadleaf, { seed: 2 });
      const { data, width } = part(bakeTree(tree), 'bark').map!.image as { data: Uint8Array; width: number };
      const at = (x: number, y: number) => data[(y * width + x) * 4]!;
      // One step round and one step back along lands on the same colour.
      for (let y = 1; y < width; y++) for (let x = 0; x < width - 1; x++) expect(Math.abs(at(x + 1, y - 1) - at(x, y))).toBeLessThanOrEqual(1);
      tree.dispose();
    });
  });
});
