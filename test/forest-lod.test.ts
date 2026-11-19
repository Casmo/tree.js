import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, PerspectiveCamera, type MeshStandardNodeMaterial } from 'three/webgpu';
import { createForest, DetailLevel, selectDetailLevel, type Forest, type ForestPlacement, type TreeDefinitionInput } from '../src/index';

// light 10, impostor 40, fade 0.2: bands 9..11 (Full -> Light) and 36..44 (Light -> Impostor).
const settings = { light: 10, impostor: 40, fade: 0.2 };
const select = (distance: number, scale = 1, growth = 1) => selectDetailLevel(distance, scale, growth, settings);

describe('selectDetailLevel', () => {
  it('draws near trees Full, middle trees Light and far trees as an Impostor', () => {
    expect(select(0)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(5)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(20)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(100)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('cross-fades in a band of `fade` times the switch distance, centred on it', () => {
    // Band edges: 9 and 11 for Light, 36 and 44 for Impostor.
    expect(select(9)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(9.5).level).toBe(DetailLevel.Full);
    expect(select(9.5).fade).toBeCloseTo(0.25);
    expect(select(10).fade).toBeCloseTo(0.5);
    expect(select(10.5).fade).toBeCloseTo(0.75);
    expect(select(11)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(36)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(38)).toEqual({ level: DetailLevel.Light, fade: 0.25 });
    expect(select(40)).toEqual({ level: DetailLevel.Light, fade: 0.5 });
    expect(select(44)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('gives a tree in a band complementary amounts for both neighbouring levels', () => {
    const { level, fade } = select(38);
    // `level` draws with 1 - fade and the next level with fade: together always one tree.
    expect(level).toBe(DetailLevel.Light);
    expect(1 - fade).toBeCloseTo(0.75);
    expect(fade).toBeCloseTo(0.25);
  });

  it('switches without a band when fade is 0', () => {
    const hard = { light: 10, impostor: 40, fade: 0 };
    expect(selectDetailLevel(9.999, 1, 1, hard)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(selectDetailLevel(10, 1, 1, hard)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(selectDetailLevel(39.999, 1, 1, hard)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(selectDetailLevel(40, 1, 1, hard)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('divides the distance by the placement scale: bigger trees switch later', () => {
    // A tree at scale 2 switches at twice the distance: 18 / 2 = 9, 22 / 2 = 11, 80 / 2 = 40.
    expect(select(18, 2)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(20, 2).fade).toBeCloseTo(0.5);
    expect(select(22, 2)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(80, 2)).toEqual({ level: DetailLevel.Light, fade: 0.5 });
    // ...and a small one sooner (6 / 0.5 = 12).
    expect(select(6, 0.5)).toEqual({ level: DetailLevel.Light, fade: 0 });
  });

  it('caps a tree that is not fully grown at Light', () => {
    expect(select(100, 1, 0.99)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(40, 1, 0.5)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(10, 1, 0.5).fade).toBeCloseTo(0.5); // Full -> Light still fades
    expect(select(100, 1, 1)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });
});

// A small tree with a straight trunk exactly 5 m tall keeps Variant generation fast.
const definition: TreeDefinitionInput = {
  schemaVersion: 3,
  trunk: { length: 5, lengthVariation: 0, bend: 0 },
  branches: [{ count: 3 }],
  leaves: { count: 2 },
  fruit: { type: 'round', count: 2, size: 0.15 },
  materials: { leaf: { crownNormals: 0.5 }, occlusion: { strength: 0.5 } },
};
const placements: ForestPlacement[] = Array.from({ length: 30 }, (_, i) => ({ id: i, position: [(i % 6) * 4, 0, Math.floor(i / 6) * 4], rotation: i, scale: 1 + (i % 3) / 4 }));

function drawn(forest: Forest): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) out.push(o);
  });
  return out;
}

/** FNV-1a over the bytes of a typed array. */
function hashArray(array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16);
}

/** Everything a Forest draws: meshes, their geometry and instance data, and their materials' node setup. */
function fingerprint(forest: Forest) {
  return drawn(forest).map((mesh) => {
    const geometry = mesh.geometry;
    const material = mesh.material as MeshStandardNodeMaterial;
    const nodes = ['positionNode', 'colorNode', 'normalNode', 'opacityNode', 'emissiveNode', 'aoNode', 'roughnessNode', 'metalnessNode', 'outputNode', 'lightsNode', 'mrtNode', 'castShadowNode', 'maskNode'] as const;
    return {
      name: mesh.name,
      count: mesh.count,
      capacity: mesh.instanceMatrix.count,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      matrices: hashArray(mesh.instanceMatrix.array as Float32Array),
      index: hashArray(geometry.getIndex()!.array as Uint32Array),
      attributes: Object.entries(geometry.attributes).map(([name, a]) => {
        const data = 'data' in a ? (a as { data: { array: Float32Array; stride: number } }).data : null;
        return [name, a.itemSize, 'offset' in a ? a.offset : 0, data ? data.stride : 0, hashArray((data ? data.array : a.array) as Float32Array)];
      }),
      material: {
        type: material.type,
        transparent: material.transparent,
        side: material.side,
        alphaTest: material.alphaTest,
        userData: JSON.stringify(material.userData),
        nodes: nodes.map((key) => [key, (material as unknown as Record<string, { type?: string } | null>)[key]?.type ?? null]),
      },
    };
  });
}

describe('a Forest without lod', () => {
  it('draws exactly the meshes, geometry, instance data and materials it drew before Detail Levels', () => {
    const forest = createForest(definition, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3 });
    expect(fingerprint(forest)).toMatchSnapshot();
    expect(fingerprint(createForest(definition, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3, lod: false }))).toEqual(fingerprint(forest));
  });
});

/** Whether a promise has settled after the current tasks ran. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(() => (done = true)).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

/** Draws every mesh of the forest once (their `onBeforeRender`) with a renderer on the given backend. */
function render(forest: Forest, backend: 'webgpu' | 'webgl'): void {
  const renderer = { isWebGPURenderer: true, backend: backend === 'webgl' ? { isWebGLBackend: true } : { isWebGPUBackend: true } };
  for (const mesh of drawn(forest)) (mesh.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, mesh.geometry, mesh.material, null);
}

describe('ForestOptions.lod', () => {
  it('is null on a Forest without lod, whose lodReady resolves at once', async () => {
    const forest = createForest(definition, placements, { variants: 2 });
    expect(forest.lod).toBeNull();
    expect(await settled(forest.lodReady)).toBe(true);
    expect(createForest(definition, placements, { variants: 2, lod: false }).lod).toBeNull();
  });

  it('lod: true derives the switch distances from the trunk height (Light 6, Impostor 20 trunk heights)', () => {
    const forest = createForest(definition, placements, { variants: 2, lod: true });
    const lod = forest.lod!;
    expect(lod.light).toBeCloseTo(30); // 5 m trunk
    expect(lod.impostor).toBeCloseTo(100);
    expect(lod).toMatchObject({ fade: 0.1, impostorAtlas: { frames: 12, size: 2048 }, lightDefinition: null, camera: null });
    // The tallest Variant decides.
    const varied = createForest({ ...definition, trunk: { length: 5, lengthVariation: 0.5, bend: 0 } }, placements, { variants: 4, seed: 3, lod: true });
    // Trunk height: the tip of the (straight, upright) trunk.
    const tallest = Math.max(...varied.variants.map((v) => Math.max(...v.data.skeleton.branches[0]!.points.map((p) => p.position[1]))));
    expect(tallest).toBeGreaterThan(5);
    expect(varied.lod!.light).toBeCloseTo(tallest * 6);
  });

  it('keeps the settings given, filling in the defaults', () => {
    const camera = new PerspectiveCamera();
    const lightDefinition = { leaves: { count: 1 } };
    const forest = createForest(definition, placements, { lod: { light: 12, impostor: 50, impostorAtlas: { size: 1024 }, lightDefinition, camera } });
    expect(forest.lod).toEqual({ light: 12, impostor: 50, fade: 0.1, impostorAtlas: { frames: 12, size: 1024 }, lightDefinition, camera });
    expect(createForest(definition, placements, { lod: { light: 12, impostor: 12, fade: 0 } }).lod).toMatchObject({ light: 12, impostor: 12, fade: 0 });
  });

  it.each([
    [{ light: -1, impostor: 50 }, /light/],
    [{ light: Number.NaN, impostor: 50 }, /light/],
    [{ light: 10, impostor: Number.POSITIVE_INFINITY }, /impostor/],
    [{ light: 10, impostor: -5 }, /impostor/],
    [{ light: 20, impostor: 10 }, /impostor .*light/],
    [{ light: 10, impostor: 50, fade: -0.1 }, /fade/],
    [{ light: 10, impostor: 50, fade: 1.5 }, /fade/],
    [{ light: 10, impostor: 50, fade: Number.NaN }, /fade/],
    [{ light: 10, impostor: 50, impostorAtlas: { frames: 0 } }, /frames/],
    [{ light: 10, impostor: 50, impostorAtlas: { size: 100.5 } }, /size/],
  ])('rejects invalid settings %o with a RangeError', (lod, message) => {
    expect(() => createForest(definition, placements, { lod })).toThrow(RangeError);
    expect(() => createForest(definition, placements, { lod })).toThrow(message);
  });
});

describe('forest.lod', () => {
  it('changes distances, fade and camera live: same meshes and materials, no recompile', () => {
    const forest = createForest(definition, placements, { variants: 2, lod: { light: 10, impostor: 40 } });
    const meshes = drawn(forest);
    const versions = meshes.map((m) => (m.material as MeshStandardNodeMaterial).version);
    const camera = new PerspectiveCamera();
    forest.lod = { light: 15, fade: 0.3 };
    forest.lod = { impostor: 90, camera };
    expect(forest.lod).toMatchObject({ light: 15, impostor: 90, fade: 0.3, camera });
    expect(drawn(forest)).toEqual(meshes);
    expect(meshes.map((m) => (m.material as MeshStandardNodeMaterial).version)).toEqual(versions);
    forest.lod = { camera: null };
    expect(forest.lod!.camera).toBeNull();
  });

  it('returns a copy: changing it does not change the forest', () => {
    const forest = createForest(definition, placements, { lod: { light: 10, impostor: 40 } });
    const lod = forest.lod!;
    lod.light = 99;
    lod.impostorAtlas.size = 1;
    expect(forest.lod).toMatchObject({ light: 10, impostorAtlas: { size: 2048 } });
  });

  it('rejects invalid values and keeps the old ones', () => {
    const forest = createForest(definition, placements, { lod: { light: 10, impostor: 40 } });
    expect(() => (forest.lod = { light: 50 })).toThrow(RangeError); // beyond impostor
    expect(() => (forest.lod = { fade: 2 })).toThrow(RangeError);
    expect(() => (forest.lod = { impostor: Number.NaN })).toThrow(RangeError);
    expect(forest.lod).toMatchObject({ light: 10, impostor: 40, fade: 0.1 });
  });

  it('cannot switch Detail Levels on: that needs a new Forest', () => {
    const forest = createForest(definition, placements);
    expect(() => (forest.lod = { light: 10 })).toThrow(/new Forest/);
  });
});

describe('Detail Levels on the WebGL2 fallback', () => {
  it('ignores lod with exactly one console warning and draws every tree in full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const forest = createForest(definition, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3, lod: true });
      render(forest, 'webgl');
      render(forest, 'webgl');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/WebGL2.*Detail Levels|Detail Levels.*WebGL2/);
      expect(await settled(forest.lodReady)).toBe(true);
      // Every tree in full: exactly what a Forest without lod draws.
      expect(fingerprint(forest)).toEqual(fingerprint(createForest(definition, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3 })));
    } finally {
      warn.mockRestore();
    }
  });

  it('warns nothing for a Forest without lod, nor on WebGPU', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(createForest(definition, placements), 'webgl');
      render(createForest(definition, placements, { lod: true }), 'webgpu');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
