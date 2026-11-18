import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION, extendDefinition, parseDefinition, type TreeDefinition } from '@casmo/tree.js';
import lowPoly from '@casmo/tree.js/styles/low-poly';
import { treeCodeSnippet } from './export-code';

/** Evaluates the object literal assigned to `const definition = ... satisfies TreeDefinitionInput;`. */
function inlinedDefinition(snippet: string): unknown {
  const match = /const definition = ([\s\S]*?) satisfies TreeDefinitionInput;/.exec(snippet);
  expect(match).not.toBeNull();
  return new Function(`return (${match![1]});`)();
}

const sculpted: TreeDefinition = extendDefinition(lowPoly.broadleaf, {
  name: 'My "quoted" oak',
  trunk: { length: 6.25 },
  sculpts: [{ seed: 7, path: '0.1', action: 'delete' }],
});

const state = { definition: sculpted, seed: 7, growth: 0.8, season: 0.65 };

describe('Copy code snippet', () => {
  it('three.js: imports, the Definition inline as a typed constant and createTree with the current Seed, Growth and Season', () => {
    const snippet = treeCodeSnippet(state, 'three');
    expect(snippet).toContain("import { createTree, type TreeDefinitionInput } from '@casmo/tree.js';");
    expect(snippet).toContain('const tree = createTree(definition, { seed: 7, growth: 0.8, season: 0.65 });');
    expect(snippet).not.toContain('@casmo/tree.js/styles');
    expect(snippet).not.toContain('@casmo/tree.js/react');
  });

  it('React: imports and a <Tree definition> with the current Seed, Growth and Season', () => {
    const snippet = treeCodeSnippet(state, 'react');
    expect(snippet).toContain("import type { TreeDefinitionInput } from '@casmo/tree.js';");
    expect(snippet).toContain("import { Tree } from '@casmo/tree.js/react';");
    expect(snippet).toContain('<Tree definition={definition} seed={7} growth={0.8} season={0.65} />');
    expect(snippet).not.toContain('createTree');
  });

  it.each(['three', 'react'] as const)('%s: the inlined Definition parses back to the same Definition', (target) => {
    const snippet = treeCodeSnippet(state, target);
    expect(parseDefinition(inlinedDefinition(snippet))).toEqual(sculpted);
  });

  it('writes identifier keys unquoted and keeps other keys and strings intact', () => {
    const snippet = treeCodeSnippet({ ...state, definition: DEFAULT_DEFINITION }, 'three');
    expect(snippet).toMatch(/^ {2}schemaVersion: \d+,$/m);
    expect(snippet).not.toMatch(/^\s*"schemaVersion":/m);
    expect(inlinedDefinition(snippet)).toEqual(DEFAULT_DEFINITION);
  });
});
