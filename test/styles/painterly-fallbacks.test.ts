// Painterly (#112) next to features drawn for it in their own tickets: Snow Cover and Wetness (#117, painted
// branches; their look is checked in e2e/snow-cover.spec.ts and e2e/wetness.spec.ts; the Bake #120 is in
// test/bake.test.ts). Until then they fall back to another Style's look, but never throw. Forests, Detail
// Levels and Impostors (#118): test/styles/painterly-forest.test.ts.
import { describe, expect, it } from 'vitest';
import { createTree } from '../../src/index';
import { snowCoverHooks, wetnessHooks } from '../../src/weather';
import painterly from '../../src/styles/painterly';

const { broadleaf } = painterly;

describe('painterly trees with features not yet painted', () => {
  it('take Snow Cover and Wetness hooks', () => {
    const tree = createTree(broadleaf, { seed: 1 });
    expect(() => (tree.shaderHooks = snowCoverHooks())).not.toThrow();
    expect(() => (tree.shaderHooks = wetnessHooks())).not.toThrow();
    tree.dispose();
  });
});
