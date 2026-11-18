import { afterEach, describe, expect, it, vi } from 'vitest';
import { texture, vec4 } from 'three/tsl';
import { NodeUpdateType, PerspectiveCamera, Scene, Texture, type Node, type Renderer } from 'three/webgpu';
import { createForest, createTree, type ForestPlacement, type TreeDefinitionInput } from '../../src/index';
import { createTreeEffects, SUGGESTED_TREE_EFFECTS, TREE_ID, TREE_MASK, treeHighlight, type TreeEffects } from '../../src/effects';

const definition: TreeDefinitionInput = { schemaVersion: 2, branches: [{ count: 3 }], leaves: { count: 2 } };
const grid = (n: number): ForestPlacement[] => Array.from({ length: n }, (_, i) => ({ position: [(i % 10) * 3, 0, Math.floor(i / 10) * 3] }));
const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const outputsOf = (effects: TreeEffects) => Object.keys(effects.scenePass.pass.getMRT()!.outputNodes);
const input = () => ({ color: vec4(0.2, 0.4, 0.1, 1), mask: texture(new Texture()), treeId: texture(new Texture()) });

/** Runs the per-render and per-frame updates of every node in a graph, as the renderer does before a draw. */
function renderFrame(root: Node, frameId = 1): void {
  const frame = { frameId, renderId: frameId, time: frameId / 60, deltaTime: 1 / 60 };
  const seen = new Set<Node>();
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.updateType !== NodeUpdateType.NONE) node.update(frame as never);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
}

afterEach(() => vi.restoreAllMocks());

describe('Highlight', () => {
  it('needs the Tree ID input, and says so', () => {
    expect(() => treeHighlight({ color: vec4(1), mask: texture(new Texture()) }, [])).toThrow(/treeId/);
    expect(treeHighlight(input(), [])).toBeDefined();
  });

  it('turns on the Tree ID channel in TreeEffects', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { highlight: {} } });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, TREE_ID]);
    effects.set('low-poly');
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
  });

  it('changes colours and numbers without a new graph, and switching it on or off builds one', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { outline: {}, highlight: {} } });
    const before = effects.pipeline.outputNode;
    effects.set({ outline: {}, highlight: { color: '#ff0000', tint: 0.8, brightness: 2, outlineColor: '#00ff00', thickness: 4, strength: 0.5, pulse: 2 } });
    expect(effects.pipeline.outputNode).toBe(before);
    effects.set({ outline: {} });
    expect(effects.pipeline.outputNode).not.toBe(before);
  });

  it('is in no suggested combination', () => {
    for (const settings of Object.values(SUGGESTED_TREE_EFFECTS)) expect(settings).not.toHaveProperty('highlight');
  });

  it('reads the mutable highlighted list every frame and warns once beyond 64 trees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forest = createForest(definition, grid(70), { variants: 2 });
    const scene = new Scene().add(forest);
    const highlighted = forest.trees.slice(0, 64);
    const effects = createTreeEffects(renderer, scene, new PerspectiveCamera(), { effects: { highlight: {} }, highlighted });
    expect(effects.highlighted).toBe(highlighted);
    renderFrame(effects.pipeline.outputNode, 1);
    expect(warn).not.toHaveBeenCalled();
    highlighted.push(...forest.trees.slice(64)); // changed in place: 70 trees
    renderFrame(effects.pipeline.outputNode, 2);
    renderFrame(effects.pipeline.outputNode, 3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/64/);
  });

  it('skips removed, disposed and undrawn trees without errors (and without counting them)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forest = createForest(definition, grid(66), { variants: 1 });
    const gone = createForest(definition, grid(3), { variants: 1 });
    const disposed = createTree(definition, { seed: 1 });
    const undrawn = createTree(definition, { seed: 2 });
    const scene = new Scene().add(forest, gone, disposed);
    const removed = forest.trees.slice(0, 3);
    const highlighted = [...forest.trees.slice(0, 66), ...gone.trees, disposed, undrawn, forest as never, scene as never];
    for (const tree of removed) forest.removeTree(tree);
    gone.dispose();
    disposed.dispose();
    const node = treeHighlight(input(), highlighted);
    expect(() => renderFrame(node)).not.toThrow();
    // 63 Forest trees remain: under the limit.
    expect(warn).not.toHaveBeenCalled();
  });
});
