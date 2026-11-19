// Scene-wide default Tree Shader Hooks and the stacking order (#99, ADR 0012): the scene-wide default
// applies to every Tree and Forest that doesn't override it; a Tree's or Forest's own hooks stack after it,
// `null` overrides it; and in every stack the ready-made hooks (Snow Cover, Wetness) run before the app's.
import { afterEach, describe, expect, it } from 'vitest';
import { float } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  createForest,
  createTree,
  getSceneShaderHooks,
  setSceneShaderHooks,
  stackShaderHooks,
  type TreeShaderHook,
  type TreeShaderHooks,
} from '../src/index';
import { readyMadeShaderHook } from '../src/materials/shader-hooks';
import { pear } from '../src/species';
import stylized from '../src/styles/stylized';

afterEach(() => setSceneShaderHooks({}));

/** Hooks that log, in run order, which of them shaded which part. */
function recorder() {
  const log: string[] = [];
  const hook = (name: string): TreeShaderHook => ({ color, part }) => {
    log.push(`${name}:${part}`);
    return color;
  };
  return { log, hook };
}

describe('the scene-wide default Tree Shader Hooks', () => {
  it('are none unless set', () => {
    expect(getSceneShaderHooks()).toEqual({});
  });

  it('apply to existing and new Trees and Forests, and are removed again', () => {
    const { log, hook } = recorder();
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const forest = createForest(stylized.apply(pear), [{ position: [0, 0, 0] }], { variants: 1 });
    const own = tree.leaves.material.colorNode;
    const leaves = hook('scene');
    setSceneShaderHooks({ leaves });
    expect(getSceneShaderHooks()).toEqual({ leaves });
    expect(log).toEqual(['scene:leaves', 'scene:leaves']);
    expect(tree.leaves.material.colorNode).not.toBe(own);
    expect(tree.shaderHooks).toEqual({}); // the Tree's own hooks are unchanged

    const later = createTree(stylized.apply(pear), { seed: 3 });
    expect(log).toEqual(['scene:leaves', 'scene:leaves', 'scene:leaves']);

    setSceneShaderHooks({});
    expect(tree.leaves.material.colorNode).toBe(own);
    for (const o of [tree, forest, later]) o.dispose();
  });

  it('rebuild only the parts whose hooks change', () => {
    const { log, hook } = recorder();
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const leaves = hook('scene');
    setSceneShaderHooks({ leaves });
    const barkVersion = tree.wood.material.version;
    const leafVersion = tree.leaves.material.version;
    setSceneShaderHooks({ leaves, fruit: hook('fruit') });
    expect(tree.wood.material.version).toBe(barkVersion);
    expect(tree.leaves.material.version).toBe(leafVersion);
    expect(log).toEqual(['scene:leaves', 'fruit:fruit']);
    tree.dispose();
  });

  it('stop reaching a disposed Tree', () => {
    const { log, hook } = recorder();
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    tree.dispose();
    setSceneShaderHooks({ leaves: hook('scene') });
    expect(log).toEqual([]);
  });

  it('stack before a Tree’s own hooks; null on a part overrides them', () => {
    const { log, hook } = recorder();
    setSceneShaderHooks({ leaves: hook('scene'), bark: hook('scene') });
    log.length = 0;
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: { leaves: hook('own'), bark: null } });
    expect(log).toEqual(['scene:leaves', 'own:leaves']); // no bark: `null` overrides the scene-wide bark hook
    expect(tree.shaderHooks).toEqual({ leaves: expect.any(Function), bark: null });
    // Back to following the scene-wide bark hook once the override is gone.
    tree.shaderHooks = { leaves: tree.shaderHooks.leaves };
    expect(log).toEqual(['scene:leaves', 'own:leaves', 'scene:bark']);
    tree.dispose();
  });
});

describe('the stacking order of Tree Shader Hooks', () => {
  const snow = readyMadeShaderHook((({ color }) => color) as TreeShaderHook);

  it('runs ready-made hooks first, then the app’s: scene-wide default before own within each', () => {
    const { log, hook } = recorder();
    const sceneReady = readyMadeShaderHook(hook('sceneReady'));
    const ownReady = readyMadeShaderHook(hook('ownReady'));
    setSceneShaderHooks({ leaves: [hook('sceneApp'), sceneReady] });
    log.length = 0;
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: { leaves: [hook('ownApp1'), ownReady, hook('ownApp2')] } });
    expect(log).toEqual(['sceneReady:leaves', 'ownReady:leaves', 'sceneApp:leaves', 'ownApp1:leaves', 'ownApp2:leaves']);
    tree.dispose();
  });

  it('chains each hook’s colour and roughness into the next', () => {
    const seen: Node[] = [];
    const first: TreeShaderHook = ({ color, roughness }) => ({ color: color.mul(0.5), roughness: roughness.mul(0.5) });
    const second: TreeShaderHook = ({ color, roughness }) => {
      seen.push(color, roughness);
      return color;
    };
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: { leaves: [first, second] } });
    const [color, roughness] = seen as [Node & { getChildren(): Iterable<unknown> }, Node];
    expect(color.isNode && roughness.isNode).toBe(true);
    // The second hook got the first's output, so the material keeps the first's roughness.
    expect(tree.leaves.material.roughnessNode).toBe(roughness);
    tree.dispose();
  });

  it('runs a hook listed twice once', () => {
    const { log, hook } = recorder();
    const shared = hook('shared');
    setSceneShaderHooks({ leaves: shared });
    log.length = 0;
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: { leaves: [shared, hook('own')] } });
    expect(log).toEqual(['shared:leaves', 'own:leaves']);
    tree.dispose();
  });

  it('applies the same order on a Forest', () => {
    const { log, hook } = recorder();
    setSceneShaderHooks({ bark: hook('sceneApp') });
    log.length = 0;
    const forest = createForest(stylized.apply(pear), [{ position: [0, 0, 0] }], {
      variants: 1,
      shaderHooks: { bark: [hook('ownApp'), readyMadeShaderHook(hook('ownReady'))] },
    });
    expect(log).toEqual(['ownReady:bark', 'sceneApp:bark', 'ownApp:bark']);
    forest.dispose();
  });

  it('stackShaderHooks joins sets of hooks per part, in order', () => {
    const a = (({ color }) => color) as TreeShaderHook;
    const b = (({ color }) => color.mul(float(2))) as TreeShaderHook;
    const sets: TreeShaderHooks[] = [{ leaves: snow, bark: snow }, { leaves: [a, b] }, { fruit: null }];
    expect(stackShaderHooks(...sets)).toEqual({ leaves: [snow, a, b], bark: [snow], fruit: null });
    expect(stackShaderHooks()).toEqual({});
  });
});
