// Baked Trees of the Fantasy Styles (#142, ADR 0017): an Enchanted tree's Inner Glow exported as a steady
// emissive (glTF emissive, KHR_materials_emissive_strength), and Whimsical's candy stripes as a bark map.
// Exported in Node with a stand-in canvas (test/fixtures/node-gltf.ts) and checked with the glTF validator.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateBytes } from 'gltf-validator';
import { Color, DataTexture, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three/webgpu';
import { bakeTree, createTree, exportBakedTree, extendDefinition, type Tree } from '../src/index';
import enchanted from '../src/styles/enchanted';
import realistic from '../src/styles/realistic';
import whimsical from '../src/styles/whimsical';
import { definitionForSeed, evaluateSeason } from '../src/season';
import { installGltfExporterGlobals } from './fixtures/node-gltf';

let uninstall: () => void;
beforeAll(() => (uninstall = installGltfExporterGlobals()));
afterAll(() => uninstall());

type Json = {
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

async function validate(glb: ArrayBuffer) {
  const report = await validateBytes(new Uint8Array(glb), { maxIssues: 100 });
  return report.issues;
}

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
    const json = (await exportBakedTree(tree, { season: 0.4, binary: false })) as Json;
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
