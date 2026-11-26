// Snow Cover and Wetness on the Fantasy Styles (#142, GLOSSARY: "drawn to suit the tree's Style"): sugar
// frosting and a candy glaze on `whimsical`, faintly glowing frost and a dark, starry sheen on `enchanted`,
// each its own drawing (not another Style's), reaching every part of real Whimsical and Enchanted trees, and
// with the amount at 0 the trees as without the hooks. Pixels are checked in e2e/snow-cover.spec.ts and
// e2e/wetness.spec.ts (screenshots of both Styles, Enchanted at night too).
import { afterEach, describe, expect, it } from 'vitest';
import { float, vec3 } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import { createTree, setSceneShaderHooks, type Shading, type TreeShaderInput, type TreeShaderOutput } from '../../src/index';
import enchanted from '../../src/styles/enchanted';
import whimsical from '../../src/styles/whimsical';
import { sceneSnow, sceneWetness, snowCoverHooks, wetnessHooks } from '../../src/weather';

afterEach(() => setSceneShaderHooks({}));

const SHADINGS: Shading[] = ['flat', 'toon', 'standard', 'painted', 'whimsical', 'enchanted'];

/** Every node reachable from `root`. */
function nodesOf(root: Node): Set<Node> {
  const seen = new Set<Node>();
  const visit = (node: Node) => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
  return seen;
}

/** The shape of a node graph: how many nodes of each type it has. */
function shape(output: Node<'vec3'> | TreeShaderOutput): string {
  const { color, roughness } = 'isNode' in output ? { color: output, roughness: undefined } : output;
  const counts = new Map<string, number>();
  for (const root of [color, roughness].filter(Boolean) as Node[]) for (const node of nodesOf(root)) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return [...counts].sort().join();
}

/** What a hook gets for a leaf fragment of a tree of `shading`. */
const input = (shading: Shading): TreeShaderInput => ({
  part: 'leaves',
  shading,
  color: vec3(0.1, 0.4, 0.3),
  roughness: float(0.8),
  normal: vec3(0, 1, 0),
  position: vec3(1, 2, 3),
  treePosition: vec3(0, 0, 0),
  season: float(0.4),
  growth: float(1),
});

describe('Snow Cover and Wetness on the Fantasy Styles', () => {
  it('draw whimsical and enchanted trees each in their own way, not as another Style', () => {
    for (const [name, hooks] of [['Snow Cover', snowCoverHooks()], ['Wetness', wetnessHooks()]] as const) {
      const shapes = SHADINGS.map((shading) => shape(hooks.leaves(input(shading))));
      expect(new Set(shapes).size, name).toBe(SHADINGS.length);
    }
  });

  it('reach every part of a Whimsical and an Enchanted tree, and at amount 0 change nothing there', () => {
    for (const style of [whimsical, enchanted]) {
      const tree = createTree(style.broadleaf, { seed: 1 });
      const parts = () => [tree.wood, tree.leaves].map((mesh) => (mesh.material as MeshStandardNodeMaterial).colorNode as Node);
      const plain = parts();
      for (const [hooks, amount] of [[snowCoverHooks(), sceneSnow.uniforms.amount], [wetnessHooks(), sceneWetness.uniforms.amount]] as const) {
        tree.shaderHooks = hooks;
        for (const node of parts()) expect(nodesOf(node).has(amount), style.broadleaf.name).toBe(true);
        tree.shaderHooks = {};
        expect(parts()).toEqual(plain);
      }
      tree.dispose();
    }
  });
});
