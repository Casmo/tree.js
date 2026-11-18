// "Copy code": a self-contained snippet with the full Definition inline (not a Style reference, so it
// keeps growing the same tree when the library's Style mapping changes) and the preview's Seed,
// Growth and Season.
import type { TreeDefinition } from '@casmo/tree.js';

export type CodeTarget = 'three' | 'react';

export interface CodeSnippetState {
  definition: TreeDefinition;
  seed: number;
  growth: number;
  season: number;
}

/** The Definition as a TypeScript object literal: JSON with identifier keys unquoted. */
function definitionLiteral(definition: TreeDefinition): string {
  // Anchored at a line start and followed by `":`, so only keys match (strings in arrays never do).
  return JSON.stringify(definition, null, 2).replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:');
}

/** A ready-to-paste snippet for vanilla three.js (`createTree`) or React Three Fiber (`<Tree>`). */
export function treeCodeSnippet(state: CodeSnippetState, target: CodeTarget): string {
  const { seed, growth, season } = state;
  const constant = `const definition = ${definitionLiteral(state.definition)} satisfies TreeDefinitionInput;`;
  if (target === 'react') {
    return [
      "import type { TreeDefinitionInput } from '@casmo/tree.js';",
      "import { Tree } from '@casmo/tree.js/react';",
      '',
      constant,
      '',
      '// Inside your <Canvas> (WebGPURenderer).',
      'export function MyTree() {',
      `  return <Tree definition={definition} seed={${seed}} growth={${growth}} season={${season}} />;`,
      '}',
      '',
    ].join('\n');
  }
  return [
    "import { createTree, type TreeDefinitionInput } from '@casmo/tree.js';",
    '',
    constant,
    '',
    `const tree = createTree(definition, { seed: ${seed}, growth: ${growth}, season: ${season} });`,
    'scene.add(tree); // your THREE.Scene, drawn by a WebGPURenderer',
    '',
  ].join('\n');
}
