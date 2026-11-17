import type { TreeDefinition } from '../definition';

/**
 * A Style: a visual look shipped with the library, as one ready-made Tree Definition per Form.
 * Each built-in Style is its own subpath (`@casmo/tree.js/styles/<name>`), loaded with a dynamic
 * `import()`, whose default export is the Style and whose named exports are its Definitions.
 */
export interface TreeStyle {
  name: string;
  broadleaf: TreeDefinition;
  conifer: TreeDefinition;
}
