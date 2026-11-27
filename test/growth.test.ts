import { describe, expect, it } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, WebGPURenderer, WGSLNodeBuilder } from 'three/webgpu';
import { createTree, type Tree } from '../src/index';

const definition = { schemaVersion: 2 } as const;

const meshes = (tree: Tree) => [tree.wood, tree.leaves] as Mesh[];

/** The vertex shader (WGSL) three builds for `mesh`, without a GPU (see wind-burst-opt-in.test.ts). */
function vertexShader(mesh: Mesh): string {
  const canvas = { style: {}, width: 1, height: 1, addEventListener() {}, removeEventListener() {}, getContext: () => null };
  const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement });
  (renderer as unknown as { _bindings?: unknown })._bindings = undefined;
  (renderer.backend as unknown as { device: unknown }).device = { limits: { maxUniformBufferBindingSize: 65536 } };
  renderer.hasFeature = () => false;
  const builder = new (WGSLNodeBuilder as unknown as new (object: Mesh, renderer: WebGPURenderer) => { scene: Scene; camera: PerspectiveCamera; build(): void; vertexShader: string })(mesh, renderer);
  builder.scene = new Scene();
  builder.camera = new PerspectiveCamera();
  builder.build();
  return builder.vertexShader;
}

describe('Tree growth', () => {
  it('is fully grown (1) by default, and createTree takes a starting Growth', () => {
    expect(createTree(definition).growth).toBe(1);
    expect(createTree(definition, { growth: 0.3 }).growth).toBe(0.3);
  });

  it('clamps Growth to 0..1', () => {
    const tree = createTree(definition);
    tree.growth = 2;
    expect(tree.growth).toBe(1);
    tree.growth = -1;
    expect(tree.growth).toBe(0);
  });

  it('only updates a uniform: geometry, attributes and materials stay the same objects and values', () => {
    const tree = createTree(definition, { seed: 3 });
    const before = meshes(tree).map((m) => ({
      geometry: m.geometry,
      position: m.geometry.getAttribute('position'),
      positions: Float32Array.from(m.geometry.getAttribute('position').array as Float32Array),
      material: m.material,
      positionNode: (m.material as unknown as { positionNode: unknown }).positionNode,
      version: (m.material as unknown as { version: number }).version,
    }));
    for (const g of [0, 0.25, 0.7, 1]) tree.growth = g;
    meshes(tree).forEach((m, i) => {
      const b = before[i]!;
      expect(m.geometry).toBe(b.geometry);
      expect(m.geometry.getAttribute('position')).toBe(b.position);
      expect(m.geometry.getAttribute('position').array).toEqual(b.positions);
      expect(m.material).toBe(b.material);
      expect((m.material as unknown as { positionNode: unknown }).positionNode).toBe(b.positionNode);
      expect((m.material as unknown as { version: number }).version).toBe(b.version); // no recompile
    });
    expect(tree.growthUniform.value).toBe(1);
    tree.growth = 0.4;
    expect(tree.growthUniform.value).toBe(0.4);
  });

  it('drives both the wood and the leaf vertex positions from the Growth uniform', () => {
    const tree = createTree(definition);
    for (const mesh of meshes(tree)) {
      expect((mesh.material as unknown as { positionNode: unknown }).positionNode).toBeTruthy();
    }
  });

  it('gives each tree its own Growth', () => {
    const a = createTree(definition, { seed: 1 });
    const b = createTree(definition, { seed: 1 });
    a.growth = 0.2;
    b.growth = 0.9;
    expect(a.growthUniform).not.toBe(b.growthUniform);
    expect(a.growthUniform.value).toBe(0.2);
    expect(b.growthUniform.value).toBe(0.9);
  });

  it('grows leaves on their twig in the shader (the leaf model) and the wood as before', () => {
    const tree = createTree(definition, { seed: 3, growth: 0.5 });
    expect(vertexShader(tree.leaves as Mesh)).toContain('aTwigGrowth');
    expect(vertexShader(tree.leaves as Mesh)).toContain('aTwigOrigin');
    expect(vertexShader(tree.wood as Mesh)).not.toContain('aTwig');
    tree.dispose();
  });
});
