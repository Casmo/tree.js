// Wind Bursts are opt-in at the material level: until a burst is triggered on the Wind a tree sways with,
// its shaders are exactly the ones from before Wind Bursts existed (no burst uniforms, no loop). The
// first burst rebuilds the node graphs once (never the geometry), on Trees, every Forest Detail Level,
// Impostors and the Wind-aware velocity channel.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, PerspectiveCamera, RenderTarget, Scene, WebGPURenderer, WGSLNodeBuilder, type Material } from 'three/webgpu';
import { createForest, createTree, Wind, type Forest, type TreeDefinitionInput } from '../src/index';
import { windVelocityMRT } from '../src/scene';
import { withoutTipBranches } from './definitions';

const definition: TreeDefinitionInput = { schemaVersion: 3, fruit: { type: 'round', count: 2 } };
const placements = [{ position: [0, 0, 0] as [number, number, number] }, { position: [60, 0, 0] as [number, number, number] }];

/** A WebGPURenderer that only builds shaders (no GPU, no canvas). */
function shaderRenderer(velocity = false): WebGPURenderer {
  const canvas = { style: {}, width: 1, height: 1, addEventListener() {}, removeEventListener() {}, getContext: () => null };
  const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement });
  (renderer as unknown as { _bindings?: unknown })._bindings = undefined;
  (renderer.backend as unknown as { device: unknown }).device = { limits: { maxUniformBufferBindingSize: 65536 } };
  renderer.hasFeature = () => false;
  if (velocity) {
    // A scene pass with the Wind-aware velocity channel (an MRT render target).
    renderer.setMRT(windVelocityMRT());
    renderer.getRenderTarget = () => new RenderTarget(1, 1, { count: 2 });
  }
  return renderer;
}

/** The WGSL (vertex and fragment) three builds for `mesh` with its material, as a short hash. */
function shaderOf(mesh: Mesh, renderer = shaderRenderer()): string {
  const builder = new (WGSLNodeBuilder as unknown as new (object: Mesh, renderer: WebGPURenderer) => {
    scene: Scene;
    camera: PerspectiveCamera;
    build(): void;
    vertexShader: string;
    fragmentShader: string;
  })(mesh, renderer);
  builder.scene = new Scene();
  builder.camera = new PerspectiveCamera();
  builder.build();
  return createHash('sha256').update(builder.vertexShader).update(builder.fragmentShader).digest('hex').slice(0, 16);
}

/** Whether the shader three builds for `mesh` loops over Wind Bursts (their 8-slot uniform array). */
function drawsBursts(mesh: Mesh, renderer = shaderRenderer()): boolean {
  const builder = new (WGSLNodeBuilder as unknown as new (object: Mesh, renderer: WebGPURenderer) => {
    scene: Scene;
    camera: PerspectiveCamera;
    build(): void;
    vertexShader: string;
  })(mesh, renderer);
  builder.scene = new Scene();
  builder.camera = new PerspectiveCamera();
  builder.build();
  return builder.vertexShader.includes('array< vec4<f32>, 8 >');
}

/** A WebGPURenderer as the Forest's Impostor bake sees it (see forest-lod.test.ts). */
function bakeRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

async function lodForest(wind: Wind, tree: TreeDefinitionInput = definition): Promise<Forest> {
  const forest = createForest(tree, placements, { variants: 1, seed: 5, wind, lod: { light: 10, impostor: 40 } });
  const renderer = bakeRenderer();
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
  });
  await forest.lodReady;
  return forest;
}

/** Every mesh a Tree or Forest draws: Tree parts, instanced Variant parts, Detail Level meshes (Impostor cards included). */
function meshesOf(root: Tree | Forest): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  return meshes;
}
type Tree = ReturnType<typeof createTree>;

describe('Wind Bursts are opt-in at the material level', () => {
  it('before any burst, Tree, Forest, Impostor and velocity shaders are the ones from before Wind Bursts', async () => {
    // Without Tip Branches (ADR 0019), which came later: the Impostor's shader holds the tree's size.
    const stumps = withoutTipBranches(definition);
    const tree = createTree(stumps, { seed: 1, wind: new Wind({ strength: 0.5 }) });
    const forest = await lodForest(new Wind({ strength: 0.5 }), stumps);
    const shaders = {
      tree: meshesOf(tree).map((mesh) => `${mesh.name}: ${shaderOf(mesh)}`),
      treeVelocity: meshesOf(tree).map((mesh) => `${mesh.name}: ${shaderOf(mesh, shaderRenderer(true))}`),
      forest: meshesOf(forest).map((mesh) => `${mesh.name}: ${shaderOf(mesh)}`),
      // Impostor cards left out: since Wind Bursts they also take part in Wind-aware velocity (their Wind sway,
      // which they did not before); the next test checks that, too, has no burst nodes before a burst.
      forestVelocity: meshesOf(forest)
        .filter((mesh) => !mesh.name.includes('impostor'))
        .map((mesh) => `${mesh.name}: ${shaderOf(mesh, shaderRenderer(true))}`),
    };
    // Recorded on origin/main (before Wind Bursts): the same shaders, character for character.
    expect(shaders).toMatchInlineSnapshot(`
      {
        "forest": [
          "forest wood 0: d28d7cd733b263a3",
          "forest leaves 0: 564bda0e63111013",
          "forest fruit 0: 6144f270831e1725",
          "forest wood 0 full: 48c7fc2695581f85",
          "forest leaves 0 full: 63762f19f9423ad4",
          "forest fruit 0 full: 01f90dc58ec2d2e0",
          "forest wood 0 light: 48c7fc2695581f85",
          "forest leaves 0 light: 63762f19f9423ad4",
          "forest fruit 0 light: 01f90dc58ec2d2e0",
          "forest impostor 0: 70a652d937b51b43",
        ],
        "forestVelocity": [
          "forest wood 0: 83046b19979446cd",
          "forest leaves 0: bc0e5c264e0dbd75",
          "forest fruit 0: fd61875d3438d21f",
          "forest wood 0 full: 2ab87b78f0e26657",
          "forest leaves 0 full: 54d1626e6a29e8fc",
          "forest fruit 0 full: ff3803db98ddb755",
          "forest wood 0 light: 2ab87b78f0e26657",
          "forest leaves 0 light: 54d1626e6a29e8fc",
          "forest fruit 0 light: ff3803db98ddb755",
        ],
        "tree": [
          "wood: cc51190036007fcb",
          "leaves: 3a5133dbadb1a46e",
          "fruit: e170279d22521126",
        ],
        "treeVelocity": [
          "wood: fb26cfe2f2a79648",
          "leaves: faedaa8f68ca3a7f",
          "fruit: 870bc1701e4eae19",
        ],
      }
    `);
  });

  it('a burst rebuilds the node graphs of the trees bound to its Wind once, after which they draw bursts', async () => {
    const wind = new Wind({ strength: 0.5 });
    const other = new Wind({ strength: 0.5 });
    const tree = createTree(definition, { seed: 1, wind });
    const elsewhere = createTree(definition, { seed: 1, wind: other });
    const forest = await lodForest(wind);
    const meshes = [...meshesOf(tree), ...meshesOf(forest)];
    expect(meshes.some((m) => m.name.includes('impostor'))).toBe(true);
    for (const mesh of meshes) {
      expect(drawsBursts(mesh)).toBe(false);
      expect(drawsBursts(mesh, shaderRenderer(true))).toBe(false);
    }
    const geometries = meshes.map((m) => m.geometry);
    const versions = new Map<Material, number>(meshes.map((m) => [m.material as Material, (m.material as Material).version]));

    wind.burst({ x: 0, z: 0 });
    for (const [material, version] of versions) expect(material.version).toBeGreaterThan(version);
    for (const mesh of meshes) {
      expect(drawsBursts(mesh), mesh.name).toBe(true);
      expect(drawsBursts(mesh, shaderRenderer(true)), mesh.name).toBe(true);
    }
    expect(meshes.map((m) => m.geometry)).toEqual(geometries);
    // A tree on another Wind is left alone.
    for (const mesh of meshesOf(elsewhere)) expect(drawsBursts(mesh)).toBe(false);

    // Only the first burst rebuilds.
    const rebuilt = meshes.map((m) => (m.material as Material).version);
    wind.burst({ x: 1, z: 1 });
    expect(meshes.map((m) => (m.material as Material).version)).toEqual(rebuilt);
  });

  it('a tree switched to a Wind that has had a burst draws bursts; one switched away keeps drawing them', () => {
    const calm = new Wind();
    const bursting = new Wind();
    bursting.burst({ x: 0, z: 0 });
    const tree = createTree(definition, { seed: 1, wind: calm });
    expect(drawsBursts(tree.leaves)).toBe(false);
    tree.wind = bursting;
    expect(drawsBursts(tree.leaves)).toBe(true);
    tree.wind = calm;
    expect(drawsBursts(tree.leaves)).toBe(true);

    // A burst on a Wind the tree no longer follows does not rebuild it.
    const later = createTree(definition, { seed: 1, wind: new Wind() });
    const previous = later.wind;
    later.wind = calm;
    previous.burst({ x: 0, z: 0 });
    expect(drawsBursts(later.leaves)).toBe(false);
    calm.burst({ x: 0, z: 0 });
    expect(drawsBursts(later.leaves)).toBe(true);
  });

  it('a tree created on a Wind that already had a burst draws bursts from the start', () => {
    const wind = new Wind();
    wind.burst({ x: 0, z: 0 });
    expect(drawsBursts(createTree(definition, { seed: 1, wind }).wood)).toBe(true);
  });
});
