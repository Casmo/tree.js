import type { DefinitionPatch, TreeDefinition } from '../definition';
import type { StyleSource } from './apply';

/**
 * A Style: a visual look shipped with the library. It turns any Species into a Tree Definition
 * (`apply`, ADR 0005), and has one ready-made generic Tree Definition per Form.
 * Each built-in Style is its own subpath (`@casmo/tree.js/styles/<name>`), loaded with a dynamic
 * `import()`, whose default export is the Style and whose named exports are its Definitions.
 */
export interface TreeStyle {
  name: string;
  broadleaf: TreeDefinition;
  conifer: TreeDefinition;
  /**
   * Draws a Species in this Style: returns a complete, validated Tree Definition with this Style's
   * shading, polygon detail, leaf shape / count / size / texture (from the Leaf Type and density)
   * and bark (from the Bark Type and colour). Given a Tree Definition instead, it re-applies only
   * the look and keeps every shape field (trunk, branches, Crown Shape, Season, Wind, Sculpts).
   * Painterly also scales the tree uniformly to 2-4 m and records it in `styleScale` (ADR 0013), unless
   * the source is already Painterly-sized (has a `styleScale`, or is a Painterly Definition): it never
   * shrinks a tree twice. The other Styles keep real sizes.
   * `overrides` are merged on top like `extendDefinition`. Pure.
   *
   * ```ts
   * createTree(lowPoly.apply(oak, { trunk: { length: 8 } }), { seed: 42 });
   * ```
   */
  apply(source: StyleSource, overrides?: DefinitionPatch): TreeDefinition;
}
