// Suggested Material Features per Style and the helper that opts a Definition in (ADR 0008).
// Built-in Styles and Species never set Material Features: the app applies them explicitly.
import { parseDefinition } from '../definition/parse';
import type { MaterialFeatures, TreeDefinition, TreeDefinitionInput } from '../definition/types';
import type { StyleName } from './names';

/**
 * Suggested Material Features for each built-in Style (like `SUGGESTED_TREE_EFFECTS`). Nothing uses
 * them by default; pass one to {@link withMaterialFeatures} to opt a Definition in.
 *
 * Tuned against the e2e screenshots (e2e/material-features.spec.ts). Structural Occlusion only darkens
 * ambient light, so it is set high; translucency stays low enough that a crown against the sun keeps its shape.
 */
export const SUGGESTED_MATERIAL_FEATURES: Record<StyleName, MaterialFeatures> = {
  // Facets stay visible (half-way crown normals); no translucency, which would soften the flat look.
  'low-poly': {
    crownNormals: 0.5,
    occlusion: { strength: 0.8 },
  },
  // The crown lit as one soft shape, with a glow mostly at its thin edge against the sun.
  stylized: {
    crownNormals: 1,
    translucency: { strength: 0.3, edge: 0.8, ambient: 0.2 },
    occlusion: { strength: 0.9 },
  },
  // Some per-card detail stays; a natural glow, strongest at the thin edge of the crown.
  realistic: {
    crownNormals: 0.6,
    translucency: { strength: 0.45, edge: 0.7, ambient: 0.25 },
    occlusion: { strength: 0.9 },
  },
  // Painterly bends its cards to their Leaf Mass and paints its own depth (ADR 0014): a little of the whole
  // crown's shape on top, light occlusion (the painted gradient already darkens the inside), and a soft
  // glow at the thin edges against the sun.
  painterly: {
    crownNormals: 0.3,
    translucency: { strength: 0.3, edge: 0.8, ambient: 0.15 },
    occlusion: { strength: 0.35 },
  },
  // Each pom-pom lit as one smooth ball, so the toon bands run round the whole puff; occlusion keeps the
  // inner puffs a little darker. No translucency: the rim light does the edges.
  whimsical: {
    crownNormals: 1,
    occlusion: { strength: 0.7 },
  },
};

/**
 * The Material Features a Tree Definition has (`materials.leaf.crownNormals`, `materials.leaf.translucency`,
 * `materials.occlusion`), in the shape {@link withMaterialFeatures} takes. A feature that is absent is left
 * out; the values are the Definition's own (not copies).
 */
export function materialFeaturesOf(definition: TreeDefinition): MaterialFeatures {
  const { crownNormals, translucency } = definition.materials.leaf;
  const { occlusion } = definition.materials;
  return {
    ...(crownNormals === undefined ? {} : { crownNormals }),
    ...(translucency === undefined ? {} : { translucency }),
    ...(occlusion === undefined ? {} : { occlusion }),
  };
}

/**
 * Returns a new Tree Definition whose Material Features are exactly `features`: each feature given is
 * set, each feature left out is switched off (`{}` switches them all off). Everything else is kept. The
 * input is not changed. Throws a TreeDefinitionError for an out-of-range value.
 *
 * ```ts
 * const tree = createTree(withMaterialFeatures(stylized.broadleaf, SUGGESTED_MATERIAL_FEATURES.stylized));
 * ```
 */
export function withMaterialFeatures(definition: TreeDefinition | TreeDefinitionInput, features: MaterialFeatures): TreeDefinition {
  const parsed = parseDefinition(definition);
  // parseDefinition returns fresh objects, so the copies can drop the old features.
  const leaf = { ...parsed.materials.leaf };
  delete leaf.crownNormals;
  delete leaf.translucency;
  const materials = { ...parsed.materials };
  delete materials.occlusion;
  const { crownNormals, translucency, occlusion } = features;
  return parseDefinition({
    ...parsed,
    materials: {
      ...materials,
      leaf: {
        ...leaf,
        ...(crownNormals === undefined ? {} : { crownNormals }),
        ...(translucency === undefined ? {} : { translucency: { ...translucency } }),
      },
      ...(occlusion === undefined ? {} : { occlusion: { ...occlusion } }),
    },
  });
}
