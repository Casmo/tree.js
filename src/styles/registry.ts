import { STYLE_NAMES, type StyleName } from './names';
import type { TreeStyle } from './types';

export { STYLE_NAMES, styleLabel, styleOfShading, styleShading, type StyleName } from './names';

/**
 * The built-in Styles, each a lazily loaded chunk (`@casmo/tree.js/styles/<name>`).
 * To add a Style: its name, label and shading in names.ts, its loader here, its look in apply.ts
 * (plus its vite entry and package.json export). The editor and the scripts read these lists.
 */
const STYLE_LOADERS: Record<StyleName, () => Promise<{ default: TreeStyle }>> = {
  'low-poly': () => import('./low-poly'),
  stylized: () => import('./stylized'),
  realistic: () => import('./realistic'),
  painterly: () => import('./painterly'),
  whimsical: () => import('./whimsical'),
};

/** Downloads a built-in Style (dynamic import) and resolves to it. Rejects for an unknown name. */
export async function loadStyle(name: StyleName): Promise<TreeStyle> {
  const load = (STYLE_LOADERS as Partial<Record<string, () => Promise<{ default: TreeStyle }>>>)[name];
  if (!load) throw new Error(`Unknown tree.js Style "${name}". Built-in Styles: ${STYLE_NAMES.join(', ')}.`);
  return (await load()).default;
}
