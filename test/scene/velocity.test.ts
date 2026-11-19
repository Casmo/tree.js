import { describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, type Material, type Node, type NodeMaterial, type Renderer } from 'three/webgpu';
import { createForest, createTree, Wind, type TreeDefinitionInput } from '../../src/index';
import { TREE_MASK } from '../../src/effects';
import { createScenePipeline, windVelocity, windVelocityMRT, WIND_VELOCITY } from '../../src/scene';

// SMAA (in the suggestions) loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const definition: TreeDefinitionInput = {
  schemaVersion: 3,
  branches: [{ count: 3 }],
  leaves: { count: 2 },
  fruit: { type: 'round', count: 2, size: 0.12, hang: 0.7 },
};

function treeMaterials(root: { traverse(f: (o: unknown) => void): void }): NodeMaterial[] {
  const found: NodeMaterial[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) found.push(o.material as NodeMaterial);
  });
  return found;
}

/** Everything about a material that shapes its shaders: its node slots, their graphs, and its version. */
function fingerprint(material: NodeMaterial): unknown {
  const slots = ['positionNode', 'colorNode', 'normalNode', 'outputNode', 'mrtNode', 'fragmentNode', 'vertexNode'] as const;
  return {
    version: material.version,
    userData: JSON.stringify(material.userData),
    slots: slots.map((slot) => {
      const node = material[slot] as Node | null;
      return node && { node, size: graphSize(node) };
    }),
  };
}

function graphSize(root: Node): number {
  const seen = new Set<Node>();
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
  return seen.size;
}

describe('Wind-aware velocity', () => {
  it('is an MRT output named velocity, the name three asks for previous-frame data by', () => {
    expect(WIND_VELOCITY).toBe('velocity');
    const outputs = windVelocityMRT().outputNodes;
    expect(Object.keys(outputs)).toEqual([WIND_VELOCITY]);
    expect(outputs[WIND_VELOCITY]).toBe(windVelocity);
  });

  it('is a ScenePipeline channel only when asked for (the velocity option)', () => {
    const create = (velocity?: boolean) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), { style: 'realistic', velocity });
    const without = create();
    expect(Object.keys(without.scenePass.pass.getMRT()!.outputNodes)).not.toContain(WIND_VELOCITY);
    expect(without.scenePass.velocity).toBeUndefined();
    const withVelocity = create(true);
    expect(Object.keys(withVelocity.scenePass.pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK, WIND_VELOCITY]);
    expect(withVelocity.scenePass.velocity).toBe(withVelocity.scenePass.pass.getTextureNode(WIND_VELOCITY));
  });

  it('keeps the scene pass for the same channels, and replaces it when velocity switches', () => {
    const pipeline = createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), { velocity: true });
    const first = pipeline.scenePass;
    pipeline.set({ style: 'realistic' });
    expect(pipeline.scenePass).toBe(first);
    // Not a pass-through any more: the velocity channel needs the scene pass.
    expect(pipeline.pipeline.outputNode).not.toBeNull();
  });

  it('leaves tree materials unchanged when no velocity channel is requested (and when one is)', () => {
    const tree = createTree(definition, { seed: 1 });
    const forest = createForest(definition, [{ position: [0, 0, 0] }, { position: [3, 0, 0] }], { seed: 1 });
    const materials = [...treeMaterials(tree), ...treeMaterials(forest)];
    expect(materials.length).toBeGreaterThanOrEqual(5);
    const before = materials.map(fingerprint);
    const scene = new Scene().add(tree, forest);
    createScenePipeline(renderer, scene, new PerspectiveCamera(), { style: 'realistic' });
    expect(materials.map(fingerprint)).toEqual(before);
    createScenePipeline(renderer, scene, new PerspectiveCamera(), { style: 'realistic', velocity: true });
    windVelocityMRT();
    expect(materials.map(fingerprint)).toEqual(before);
  });
});

describe('the previous Wind time of the velocity channel', () => {
  /** One draw of `mesh` with the velocity node at renderer time `time`; returns the previous Wind time it used. */
  function draw(mesh: Mesh, time: number, frameId: number): number {
    const frame = { frameId, time, camera: new PerspectiveCamera(), object: mesh, material: mesh.material as Material };
    const node = windVelocity as unknown as { update(f: unknown): void; updateAfter(f: unknown): void; previousWindTime: { value: number } };
    node.update(frame);
    const previous = node.previousWindTime.value;
    node.updateAfter(frame);
    return previous;
  }

  it('is the Wind time the tree was last drawn with', () => {
    const tree = createTree(definition, { seed: 1, wind: new Wind({ strength: 1 }) });
    expect(draw(tree.leaves, 10, 1)).toBeCloseTo(10 - 1 / 60); // first draw: one 60 fps frame back
    expect(draw(tree.leaves, 10.05, 2)).toBeCloseTo(10);
    expect(draw(tree.leaves, 10.08, 3)).toBeCloseTo(10.05);
  });

  it('is one 60 fps frame before a pinned Wind time, so a still frame still shows the sway', () => {
    const wind = new Wind({ strength: 1 });
    wind.time = 3;
    const forest = createForest(definition, [{ position: [0, 0, 0] }], { seed: 1, wind });
    const leaves = findMesh(forest, 'leaves')!;
    expect(draw(leaves, 50, 1)).toBeCloseTo(3 - 1 / 60);
    expect(draw(leaves, 51, 2)).toBeCloseTo(3 - 1 / 60);
    wind.time = 3.1; // an app that drives the pinned clock itself
    expect(draw(leaves, 52, 3)).toBeCloseTo(3);
  });
});

function findMesh(root: { traverse(f: (o: unknown) => void): void }, name: string): Mesh | undefined {
  let found: Mesh | undefined;
  root.traverse((o) => {
    if (!found && o instanceof Mesh && (o.material as Material).userData.treePart === name) found = o;
  });
  return found;
}
