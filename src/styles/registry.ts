import type { TreeStyle } from './types';

/**
 * The built-in Styles, each a lazily loaded chunk (`@casmo/tree.js/styles/<name>`).
 * To add a Style: one line here (plus its vite entry and package.json export).
 */
export const STYLE_LOADERS = {
  'low-poly': () => import('./low-poly'),
  stylized: () => import('./stylized'),
} satisfies Record<string, () => Promise<{ default: TreeStyle }>>;

/** Name of a built-in Style, e.g. 'low-poly'. */
export type StyleName = keyof typeof STYLE_LOADERS;

/** Names of all built-in Styles. */
export const STYLE_NAMES = Object.keys(STYLE_LOADERS) as StyleName[];

/** Downloads a built-in Style (dynamic import) and resolves to it. Rejects for an unknown name. */
export async function loadStyle(name: StyleName): Promise<TreeStyle> {
  const load = (STYLE_LOADERS as Record<string, (() => Promise<{ default: TreeStyle }>) | undefined>)[name];
  if (!load) throw new Error(`Unknown tree.js Style "${name}". Built-in Styles: ${STYLE_NAMES.join(', ')}.`);
  return (await load()).default;
}
