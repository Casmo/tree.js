import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, PerspectiveCamera, Vector3, Vector4, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createForest, DetailLevel, selectDetailLevel, Wind, type Forest, type ForestOptions, type ForestPlacement, type TreeDefinitionInput } from '../src/index';
import { ditherThreshold, showsPixel } from '../src/forest/lod';
import { windMotionOf } from '../src/wind/motion';
import { uniform } from 'three/tsl';

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
    // Without Tip Branches (ADR 0019), as the tree was before them too.
    const stumps = { ...definition, branches: [{ count: 3, tipBranches: 0 }] };
    const forest = createForest(stumps, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3 });
    expect(fingerprint(forest)).toMatchSnapshot();
    expect(fingerprint(createForest(stumps, placements, { variants: 3, seed: 5, growth: 0.8, season: 0.3, lod: false }))).toEqual(fingerprint(forest));
  });
});

/** Whether a promise has settled after the current tasks ran. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(() => (done = true)).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

/**
 * A WebGPURenderer as the Forest sees it: its backend, a frame number, `compute` and `render` (mocks)
 * and every other getter/setter as a no-op (the Impostor bake saves and restores the renderer's state).
 */
function fakeRenderer(backend: 'webgpu' | 'webgl', frame = 1) {
  const target = {
    isWebGPURenderer: true,
    backend: backend === 'webgl' ? { isWebGLBackend: true } : { isWebGPUBackend: true },
    info: { frame },
    compute: vi.fn(),
    render: vi.fn(),
    setRenderTarget: vi.fn(),
  };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** Draws every mesh of the forest once (their `onBeforeRender`) with a renderer on the given backend. */
function render(forest: Forest, backend: 'webgpu' | 'webgl', renderer: unknown = fakeRenderer(backend)): void {
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

  it('resolves lodReady on the first render, not before: the backend is only known when the Forest is drawn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const forest = createForest(definition, placements, { variants: 2, lod: true });
      expect(await settled(forest.lodReady)).toBe(false);
      render(forest, 'webgl');
      expect(await settled(forest.lodReady)).toBe(true);
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

describe('ditherThreshold', () => {
  it('is an 8 × 8 ordered (Bayer) matrix: every threshold once per tile, repeating, the same every call', () => {
    const tile = Array.from({ length: 64 }, (_, i) => ditherThreshold(i % 8, Math.floor(i / 8)));
    expect([...tile].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, k) => (k + 0.5) / 64));
    expect(ditherThreshold(3 + 8, 5 + 16)).toBe(ditherThreshold(3, 5));
    expect(ditherThreshold(3.7, 5.2)).toBe(ditherThreshold(3, 5)); // pixel centres
    // Neighbouring pixels are far apart in rank (ordered, not clustered).
    expect(Math.abs(ditherThreshold(0, 0) - ditherThreshold(1, 0))).toBeGreaterThanOrEqual(0.25);
  });

  it('splits every pixel between the two levels of a cross-fade, in proportion to the fade', () => {
    for (const fade of [0, 0.1, 0.25, 0.5, 0.8, 0.99]) {
      let next = 0;
      for (let i = 0; i < 64; i++) {
        const t = ditherThreshold(i % 8, Math.floor(i / 8));
        expect(showsPixel(fade, false, t)).not.toBe(showsPixel(fade, true, t));
        if (showsPixel(fade, true, t)) next++;
      }
      expect(next / 64).toBeCloseTo(fade, 1);
    }
  });
});

/** The meshes a Forest draws its Detail Levels with (plain meshes, drawn indirectly). */
function levelMeshes(forest: Forest): Mesh[] {
  return forest.children.filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh));
}

function triangles(meshes: Mesh[]): number {
  return meshes.reduce((sum, m) => sum + m.geometry.getIndex()!.count / 3, 0);
}

/** A WebGPU renderer as the selection sees it: a frame number and a compute call. */
function gpu(frame = 1) {
  return fakeRenderer('webgpu', frame);
}

const shadowScene = { overrideMaterial: { isShadowPassMaterial: true } };

/** Draws every Detail Level mesh once, as `renderer` would (its onBeforeRender). */
function drawLevels(forest: Forest, renderer: unknown, scene: unknown, camera: unknown): void {
  for (const mesh of levelMeshes(forest)) (mesh.onBeforeRender as (...args: unknown[]) => void)(renderer, scene, camera, mesh.geometry, mesh.material, null);
}

describe('Detail Levels on WebGPU', () => {
  async function lodForest(options: Partial<ForestOptions> = {}) {
    const forest = createForest(definition, placements, { variants: 3, seed: 5, lod: { light: 10, impostor: 40 }, ...options });
    render(forest, 'webgpu');
    expect(await settled(forest.lodReady)).toBe(true);
    return forest;
  }

  it('gives each Variant a Full and a Light mesh set after the first frame, with its own materials', async () => {
    const forest = createForest(definition, placements, { variants: 3, seed: 5, lod: { light: 10, impostor: 40 } });
    expect(levelMeshes(forest)).toEqual([]);
    render(forest, 'webgpu');
    // The first frame finds the backend; the Detail Levels draw from the next one, then lodReady resolves.
    expect(await settled(forest.lodReady)).toBe(true);
    for (const variant of forest.variants) {
      const meshes = levelMeshes(forest).filter((m) => m.name.startsWith('forest') && m.name.split(' ')[2] === String(variant.index));
      const full = meshes.filter((m) => m.name.endsWith(' full'));
      const light = meshes.filter((m) => m.name.endsWith(' light'));
      expect(full.map((m) => m.name.split(' ')[1])).toEqual(['wood', 'leaves', 'fruit']);
      expect(light.length).toBeGreaterThanOrEqual(2);
      expect(triangles(light)).toBeLessThan(triangles(full));
      // Same materials (Growth, Season, Wind, Material Features), drawn indirectly.
      expect(full.map((m) => m.material)).toEqual(variant.meshes.map((m) => m.material));
      expect(light.map((m) => m.material)).toEqual(variant.meshes.slice(0, light.length).map((m) => m.material));
      for (const mesh of [...full, ...light]) expect(mesh.geometry.indirect).not.toBeNull();
      // Full draws the Variant's own vertex data.
      expect(full[0]!.geometry.getAttribute('position')).toBe(variant.wood.geometry.getAttribute('position'));
      // The instanced meshes stay for raycasting and Tree IDs, hidden.
      expect(variant.meshes.every((m) => !m.visible && m.parent === forest)).toBe(true);
    }
    const offsets = levelMeshes(forest).map((m) => `${m.geometry.indirect!.id}:${String(m.geometry.indirectOffset)}`);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('draws no mesh for an empty part (a WebGPU draw of 0 indices): a bare Definition has no leaf meshes', async () => {
    const bare = createForest({ ...definition, leaves: { count: 0 }, fruit: undefined }, placements, { variants: 2, lod: { light: 10, impostor: 40 } });
    render(bare, 'webgpu');
    await bare.lodReady;
    const meshes = levelMeshes(bare);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.geometry.getIndex()!.count).toBeGreaterThan(0);
    expect(meshes.filter((m) => m.name.includes('leaves'))).toEqual([]);
  });

  it('builds the same Light meshes for the same Definition and Variant Seed', async () => {
    const a = levelMeshes(await lodForest());
    const b = levelMeshes(await lodForest());
    expect(a.map((m) => hashArray(m.geometry.getIndex()!.array as Uint32Array))).toEqual(b.map((m) => hashArray(m.geometry.getIndex()!.array as Uint32Array)));
  });

  it('builds nothing without lod, nor on the WebGL2 fallback', async () => {
    const plain = createForest(definition, placements, { variants: 2 });
    render(plain, 'webgpu');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const webgl = createForest(definition, placements, { variants: 2, lod: true });
      render(webgl, 'webgl');
      await settled(webgl.lodReady);
      expect(levelMeshes(plain)).toEqual([]);
      expect(levelMeshes(webgl)).toEqual([]);
      expect(drawn(webgl).every((m) => m.visible)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('selects the levels once per frame for the camera that picks them; shadow passes and other cameras reuse them', async () => {
    const forest = await lodForest();
    const view = new PerspectiveCamera();
    view.position.set(1, 2, 3);
    const minimap = new PerspectiveCamera();
    minimap.position.set(50, 60, 70);
    const sun = new PerspectiveCamera();
    sun.position.set(-9, 9, -9);

    const frame1 = gpu(1);
    drawLevels(forest, frame1, {}, view);
    drawLevels(forest, frame1, shadowScene, sun);
    drawLevels(forest, frame1, {}, minimap);
    expect(frame1.compute).toHaveBeenCalledTimes(1);
    // One dispatch list for every Variant (reset, select, draw arguments).
    expect(frame1.compute.mock.calls[0]![0]).toHaveLength(3 * 3);
    expect(forest.lodUniforms!.camera.value.toArray()).toEqual([1, 2, 3]);

    // Next frame the shadow map is drawn first: it uses the last frame's level camera, not the light's.
    const frame2 = gpu(2);
    drawLevels(forest, frame2, shadowScene, sun);
    drawLevels(forest, frame2, {}, view);
    expect(frame2.compute).toHaveBeenCalledTimes(1);
    expect(forest.lodUniforms!.camera.value.toArray()).toEqual([1, 2, 3]);

    // lod.camera, when set, decides.
    forest.lod = { camera: minimap };
    const frame3 = gpu(3);
    drawLevels(forest, frame3, {}, view);
    expect(forest.lodUniforms!.camera.value.toArray()).toEqual([50, 60, 70]);
  });

  it('selects again in the same frame only when the trees, the settings or the level camera changed', async () => {
    const forest = await lodForest();
    const view = new PerspectiveCamera();
    const renderer = gpu(7);
    drawLevels(forest, renderer, {}, view);
    drawLevels(forest, renderer, {}, view);
    expect(renderer.compute).toHaveBeenCalledTimes(1);
    forest.addTree({ id: 'late', position: [0, 0, 50] });
    drawLevels(forest, renderer, {}, view);
    expect(renderer.compute).toHaveBeenCalledTimes(2);
    forest.get(3)!.growth = 0.5;
    drawLevels(forest, renderer, {}, view);
    expect(renderer.compute).toHaveBeenCalledTimes(3);
    forest.lod = { fade: 0.3 };
    drawLevels(forest, renderer, {}, view);
    expect(renderer.compute).toHaveBeenCalledTimes(4);
    view.position.x = 5;
    drawLevels(forest, renderer, {}, view);
    expect(renderer.compute).toHaveBeenCalledTimes(5);
    // Another camera in the same frame reuses the level camera's levels.
    drawLevels(forest, renderer, {}, new PerspectiveCamera());
    expect(renderer.compute).toHaveBeenCalledTimes(5);
  });

  it('takes the Forest transform into account (distances are in world units)', async () => {
    const forest = await lodForest();
    forest.position.set(100, 0, 0);
    forest.updateMatrixWorld();
    drawLevels(forest, gpu(1), {}, new PerspectiveCamera());
    expect(forest.lodUniforms!.forest.value.elements[12]).toBe(100);
  });

  it('changes distances, fade and camera live while drawing: no new meshes, no recompile', async () => {
    const forest = await lodForest();
    const meshes = levelMeshes(forest);
    const versions = meshes.map((m) => (m.material as MeshStandardNodeMaterial).version);
    forest.lod = { light: 12, impostor: 30, fade: 0.4, camera: new PerspectiveCamera() };
    expect(levelMeshes(forest)).toEqual(meshes);
    expect(meshes.map((m) => (m.material as MeshStandardNodeMaterial).version)).toEqual(versions);
    expect([forest.lodUniforms!.light.value, forest.lodUniforms!.impostor.value, forest.lodUniforms!.fade.value]).toEqual([12, 30, 0.4]);
  });


  it('keeps drawing by Detail Level when a Variant outgrows its capacity', async () => {
    const forest = await lodForest();
    const meshes = levelMeshes(forest);
    const variant = forest.variants[0]!;
    const capacity = variant.capacity;
    for (let i = 0; variant.trees.length <= capacity; i++) forest.addTree({ id: `extra ${i}`, position: [i, 0, 100] });
    expect(variant.capacity).toBeGreaterThan(capacity);
    expect(levelMeshes(forest)).toEqual(meshes);
    // The new instanced meshes are hidden as well.
    expect(variant.meshes.every((m) => !m.visible && m.parent === forest)).toBe(true);
  });

  it('frees the Detail Level meshes and buffers on dispose', async () => {
    const forest = await lodForest();
    const meshes = levelMeshes(forest);
    const disposed = vi.fn();
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', disposed);
    const indirect = meshes[0]!.geometry.indirect!;
    const freed = vi.fn();
    indirect.addEventListener('dispose', freed);
    forest.dispose();
    expect(disposed).toHaveBeenCalledTimes(meshes.length);
    expect(freed).toHaveBeenCalled();
    expect(meshes.every((m) => m.parent === null)).toBe(true);
  });
});

/** The bake renders the renderer was asked for: the scene, and the render target set before it. */
/** The values of every uniform in a node graph (per-render ones updated as the renderer would). */
function uniformValues(root: Node): unknown[] {
  const values: unknown[] = [];
  root.traverse((node) => {
    const n = node as unknown as { isUniformNode?: boolean; updateType: string; update?(frame: { time: number }): void; value?: unknown; array?: unknown[] };
    if (n.array && !n.value) n.value = new Float32Array(n.array.length * 4); // as the node builder's setup does
    if (n.updateType === 'render' && n.update) n.update({ time: 100 });
    if (n.isUniformNode) values.push(n.value instanceof Vector3 ? n.value.toArray() : n.value);
  });
  return values;
}

/** The Wind Bursts a node graph draws (per-render uniforms updated as the renderer would): x, z, start, strength. */
function burstPoints(root: Node): number[][] {
  const arrays = new Set<unknown[]>();
  let count = 0;
  root.traverse((node) => {
    const n = node as unknown as { updateType: string; update?(frame: { time: number }): void; value?: unknown; array?: unknown[]; name?: string };
    if (n.array && !n.value) n.value = new Float32Array(n.array.length * 4); // as the node builder's setup does
    if (n.updateType === 'render' && n.update) n.update({ time: 100 });
    if (n.array?.[0] instanceof Vector4) arrays.add(n.array);
  });
  root.traverse((node) => {
    const n = node as unknown as { value?: unknown; nodeType?: string | null };
    if (n.nodeType === 'int' && typeof n.value === 'number') count = Math.max(count, n.value);
  });
  return [...arrays].flatMap((array) => array.slice(0, count).map((v) => (v as Vector4).toArray()));
}

/** The bake renders per Variant: [tree layer, wood layer]. */
function bakes(renderer: ReturnType<typeof fakeRenderer>) {
  const renders = renderer.render.mock.calls.map(([scene], i) => {
    const target = renderer.setRenderTarget.mock.calls.filter(([t]) => t)[i]![0] as { width: number; height: number; textures: { name: string }[] };
    const meshes = (scene as { children: InstancedMesh[] }).children;
    return { target, meshes };
  });
  const variants: (typeof renders)[] = [];
  for (let i = 0; i < renders.length; i += 2) variants.push(renders.slice(i, i + 2));
  return variants;
}

describe('Impostors', () => {
  async function baked(options: Partial<ForestOptions> = {}, renderer = fakeRenderer('webgpu')) {
    const forest = createForest(definition, placements, { variants: 3, seed: 5, lod: { light: 10, impostor: 40 }, ...options });
    render(forest, 'webgpu', renderer);
    expect(await settled(forest.lodReady)).toBe(true);
    return { forest, renderer };
  }

  it('are baked for every Variant on the first WebGPU frame, with the app renderer, from frames × frames directions', async () => {
    const { forest, renderer } = await baked();
    const done = bakes(renderer);
    expect(done).toHaveLength(3);
    for (const [tree, wood] of done) {
      // The tree layer: colour (with coverage), normal (a = leaf flag), Season (shift, coverage and blossom
      // ranks, leaf flag) and the Material Feature atlas (the Definition sets Crown Normals and Structural
      // Occlusion) at the default 2048², 12 × 12 frames of wood and leaves.
      expect([tree!.target.width, tree!.target.height]).toEqual([2048, 2048]);
      expect(tree!.target.textures.map((t) => t.name)).toEqual(['output', 'normal', 'season', 'features']);
      expect(tree!.meshes.map((m) => m.count)).toEqual([144, 144]);
      // The wood layer: the wood alone, so bare branches show where leaves have dropped.
      expect([wood!.target.width, wood!.target.height]).toEqual([2048, 2048]);
      expect(wood!.target.textures.map((t) => t.name)).toEqual(['woodOutput', 'woodNormal']);
      expect(wood!.meshes.map((m) => m.count)).toEqual([144]);
      expect(wood!.meshes[0]!.geometry.getIndex()).toBe(tree!.meshes[0]!.geometry.getIndex());
    }
    // The renderer is left as it was: its render target is restored after each bake.
    expect(renderer.setRenderTarget.mock.calls.at(-1)![0]).toBeUndefined();
    // Far trees now draw as Impostors.
    expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Impostor);
  });

  it('respects impostorAtlas', async () => {
    const { renderer } = await baked({ lod: { light: 10, impostor: 40, impostorAtlas: { frames: 4, size: 256 } } });
    for (const [tree, wood] of bakes(renderer)) {
      expect([tree!.target.width, tree!.target.height]).toEqual([256, 256]);
      expect([wood!.target.width, wood!.target.height]).toEqual([256, 256]);
      expect(tree!.meshes.map((m) => m.count)).toEqual([16, 16]);
    }
  });

  it('draws far trees Light while the bake runs; lodReady resolves after it', async () => {
    const forest = createForest(definition, placements, { variants: 2, lod: { light: 10, impostor: 40 } });
    const renderer = fakeRenderer('webgpu');
    render(forest, 'webgpu', renderer);
    expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Light);
    expect(renderer.render).not.toHaveBeenCalled();
    await forest.lodReady;
    expect(renderer.render).toHaveBeenCalledTimes(4); // tree and wood layer per Variant
    expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Impostor);
  });

  it('give every Variant one card mesh (no Fruit), drawn indirectly from the Impostor level list', async () => {
    const { forest } = await baked();
    for (const variant of forest.variants) {
      const cards = levelMeshes(forest).filter((m) => m.name === `forest impostor ${variant.index}`);
      expect(cards).toHaveLength(1);
      // A card of 4 rows of quads (2 triangles each), so the Wind can bend it with height.
      expect(cards[0]!.geometry.getIndex()!.count).toBe(4 * 6);
      expect(cards[0]!.geometry.indirect).toBe(levelMeshes(forest).find((m) => m.name === `forest wood ${variant.index} full`)!.geometry.indirect);
      expect(cards[0]!.castShadow).toBe(true);
      expect(cards[0]!.material).not.toBe(variant.leafMaterial);
    }
  });

  it('sway with the Forest Wind and the Variant Wind response, in the vertex stage (shadows too)', async () => {
    const { forest } = await baked();
    const storm = new Wind({ direction: [0, 0, -1], strength: 3.5 });
    storm.time = 7.25;
    forest.wind = storm;
    for (const variant of forest.variants) {
      const card = levelMeshes(forest).find((m) => m.name === `forest impostor ${variant.index}`)!;
      const material = card.material as MeshStandardNodeMaterial;
      const values = uniformValues(material.positionNode as Node);
      expect(values).toContain(3.5);
      expect(values).toContain(7.25);
      expect(values).toContainEqual([0, 0, -1]);
      expect(values).toContain(variant.windResponse.uniforms.height.value);
      expect(uniformValues(material.castShadowPositionNode as Node)).toContain(3.5);
    }
  });

  it('sway with the Wind Bursts of the Forest Wind (shadows too)', async () => {
    const { forest } = await baked();
    const wind = new Wind();
    wind.time = 3;
    forest.wind = wind;
    const card = levelMeshes(forest).find((m) => m.name === 'forest impostor 0')!;
    const material = card.material as MeshStandardNodeMaterial;
    expect(burstPoints(material.positionNode as Node)).toEqual([]);
    wind.burst({ x: 3, z: -2, strength: 0.5, radius: 5 });
    expect(burstPoints(material.positionNode as Node)).toEqual([[3, -2, 3, 0.5]]);
    expect(burstPoints(material.castShadowPositionNode as Node)).toEqual([[3, -2, 3, 0.5]]);
  });

  it('register their Wind motion, bursts included, for the Wind-aware velocity channel', async () => {
    const { forest } = await baked();
    const wind = new Wind({ strength: 1 });
    wind.time = 3;
    forest.wind = wind;
    const card = levelMeshes(forest).find((m) => m.name === 'forest impostor 0')!;
    const motion = windMotionOf((card.material as MeshStandardNodeMaterial).positionNode)!;
    const previous = uniform(2.9);
    const shift = motion.shift(previous);
    const nodes = new Set<Node>();
    shift.traverse((node) => nodes.add(node));
    expect(nodes.has(previous)).toBe(true);
    wind.burst({ x: 3, z: -2, strength: 0.5, radius: 5 });
    expect(burstPoints(shift)).toEqual([[3, -2, 3, 0.5]]);
  });

  it('bake the same pictures for the same Definition and Variant Seeds', async () => {
    const picture = (renderer: ReturnType<typeof fakeRenderer>) =>
      bakes(renderer).flat().map(({ meshes }) =>
        meshes.map((m) => [hashArray(m.instanceMatrix.array as Float32Array), hashArray(m.geometry.getIndex()!.array as Uint32Array), (m.material as MeshStandardNodeMaterial).type]),
      );
    const a = picture((await baked()).renderer);
    expect(picture((await baked()).renderer)).toEqual(a);
    expect(picture((await baked({ seed: 6 })).renderer)).not.toEqual(a);
  });

  it('are not baked without lod, nor on the WebGL2 fallback', async () => {
    const plain = createForest(definition, placements, { variants: 2 });
    const renderer = fakeRenderer('webgpu');
    render(plain, 'webgpu', renderer);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const webgl = createForest(definition, placements, { variants: 2, lod: true });
      const fallback = fakeRenderer('webgl');
      render(webgl, 'webgl', fallback);
      await settled(webgl.lodReady);
      await settled(plain.lodReady);
      expect(renderer.render).not.toHaveBeenCalled();
      expect(fallback.render).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keep far trees Light when the bake fails, and still resolve lodReady', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const renderer = fakeRenderer('webgpu');
      renderer.render.mockImplementation(() => {
        throw new Error('device lost');
      });
      const { forest } = await baked({}, renderer);
      expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Light);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('resolve lodReady when the Forest is disposed before it is drawn (nothing left to wait for)', async () => {
    const forest = createForest(definition, placements, { variants: 2, lod: true });
    forest.dispose();
    expect(await settled(forest.lodReady)).toBe(true);
  });

  it('are freed on dispose: atlases, cards and their material', async () => {
    const { forest, renderer } = await baked();
    const targets = bakes(renderer).flat().map(({ target }) => target as unknown as Mesh & { addEventListener: Mesh['addEventListener'] });
    const freed = vi.fn();
    for (const target of targets) target.addEventListener('dispose', freed);
    const cards = levelMeshes(forest).filter((m) => m.name.startsWith('forest impostor'));
    const materials = vi.fn();
    for (const card of cards) (card.material as MeshStandardNodeMaterial).addEventListener('dispose', materials);
    forest.dispose();
    expect(freed).toHaveBeenCalledTimes(6); // tree and wood layers
    expect(materials).toHaveBeenCalledTimes(3);
    expect(cards.every((m) => m.parent === null)).toBe(true);
  });
});
