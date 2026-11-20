// The built-in Styles: their names, display labels and shading. Kept apart from the loaders
// (registry.ts) so Style.apply, the editor and the scripts can use them without pulling in a Style.
import type { Shading } from '../definition/types';

/** Every built-in Style: its display label and the shading its Definitions use (one shading per Style). */
const STYLES = {
  'low-poly': { label: 'Low-poly', shading: 'flat' },
  stylized: { label: 'Stylized', shading: 'toon' },
  realistic: { label: 'Realistic', shading: 'standard' },
  painterly: { label: 'Painterly', shading: 'painted' },
} as const satisfies Record<string, { label: string; shading: Shading }>;

/** Name of a built-in Style, e.g. 'low-poly'. */
export type StyleName = keyof typeof STYLES;

/** Names of all built-in Styles. */
export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

/** Display label of a built-in Style, e.g. 'Low-poly'. */
export function styleLabel(name: StyleName): string {
  return STYLES[name].label;
}

/** The shading a built-in Style draws with. */
export function styleShading(name: StyleName): Shading {
  return STYLES[name].shading;
}

/** The built-in Style a Definition was drawn in, recognised by its `materials.shading`. */
export function styleOfShading(shading: Shading): StyleName {
  return STYLE_NAMES.find((name) => STYLES[name].shading === shading)!;
}
