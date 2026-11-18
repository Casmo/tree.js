// Style.apply (ADR 0005): a Style turns a Style-neutral Species (or an existing Tree Definition)
// into a complete Tree Definition by choosing only the look: shading, polygon detail, how the
// Leaf Type and Bark Type are drawn, and textures. Shape fields pass through untouched.
import { extendDefinition, parseDefinition, type DefinitionPatch } from '../definition/parse';
import {
  CURRENT_SCHEMA_VERSION,
  type BarkMaterialDefinition,
  type MaterialFeatures,
  type BarkType,
  type LeafMaterialDefinition,
  type LeafShape,
  type LeafType,
  type TreeDefinition,
  type TreeDefinitionInput,
} from '../definition/types';
import type { SpeciesBarkDefinition, SpeciesDefinition, SpeciesFoliageDefinition } from '../species/types';
import { styleOfShading, styleShading, type StyleName } from './names';
import { BARK_TEXTURES, LEAF_TEXTURES } from './realistic/textures';

/** Polygon detail of one tree part. */
interface Detail {
  sides: number;
  sections: number;
}

/** How a Style draws one Leaf Type. */
interface LeafLook {
  shape: LeafShape;
  /** Leaves per terminal branch at density 1 (count = round(density × this)). */
  perDensity: number;
  /** Leaf size = the Species' real leaf-spray size × this. */
  sizeScale: number;
  material: LeafMaterialDefinition;
}

/** The trunk's detail, plus the extra rings in its Root Flare (`trunk.flareSections`). */
interface TrunkDetail extends Detail {
  flareSections: number;
}

/** Everything a Style decides about a tree: its look (its shading is in names.ts). */
interface StyleLook {
  trunk: TrunkDetail;
  /** Detail per branch level; deeper levels reuse the last entry. */
  branches: Detail[];
  bark(type: BarkType): Omit<BarkMaterialDefinition, 'type' | 'color'>;
  leaf(type: LeafType): LeafLook;
  /** Faces around each Fruit (`fruit.sides`): few flat facets in low-poly, smooth in the others. */
  fruitSides: number;
  /** Detail of each Root (`roots.sides`, `roots.sections`). */
  roots: Detail;
}

const isNeedleLike = (type: LeafType) => type === 'needle' || type === 'scale';
const untexturedLeaf: LeafMaterialDefinition = { roughness: 1, map: null, alphaTest: 0.5 };
const untexturedBark = () => ({ roughness: 1, map: null, normalMap: null });

// Low-poly and stylized are calibrated so a Species with density 0.5 and leaf-spray size 0.35 m comes
// out close to each Style's own broadleaf / conifer Definitions. Realistic draws far more (cheap, 2
// triangle) cards per twig than its own Definitions: a Species has fewer twigs than the realistic
// generic trees (the low-poly and stylized triangle budgets cap them at about 40-90), so the cards
// have to fill the crown. Deeper branch levels get little detail (twigs are thin and many).
const LOOKS = {
  'low-poly': {
    trunk: { sides: 5, sections: 4, flareSections: 2 },
    branches: [{ sides: 4, sections: 2 }, { sides: 3, sections: 1 }],
    bark: untexturedBark,
    fruitSides: 4,
    roots: { sides: 3, sections: 2 },
    leaf: (type) =>
      isNeedleLike(type)
        ? { shape: 'needle', perDensity: 14, sizeScale: 1.86, material: untexturedLeaf }
        : { shape: 'clump', perDensity: 4, sizeScale: 2.86, material: untexturedLeaf },
  },
  stylized: {
    trunk: { sides: 10, sections: 8, flareSections: 3 },
    branches: [{ sides: 6, sections: 3 }, { sides: 4, sections: 1 }, { sides: 3, sections: 1 }],
    bark: untexturedBark,
    fruitSides: 6,
    roots: { sides: 6, sections: 4 },
    // All puffs; smaller and denser for needle / scale foliage.
    leaf: (type) =>
      isNeedleLike(type)
        ? { shape: 'puff', perDensity: 8, sizeScale: 1.7, material: untexturedLeaf }
        : { shape: 'puff', perDensity: 4, sizeScale: 3.14, material: untexturedLeaf },
  },
  realistic: {
    trunk: { sides: 12, sections: 10, flareSections: 3 },
    branches: [{ sides: 8, sections: 6 }, { sides: 5, sections: 4 }, { sides: 3, sections: 2 }],
    // A texture per Bark Type and per Leaf Type (scripts/generate-textures.mjs).
    bark: (type) => ({ roughness: 0.95, ...BARK_TEXTURES[type] }),
    fruitSides: 9,
    roots: { sides: 8, sections: 6 },
    leaf: (type) =>
      isNeedleLike(type)
        ? { shape: 'card', perDensity: 120, sizeScale: 1.7, material: { roughness: 0.7, map: LEAF_TEXTURES[type], alphaTest: 0.4 } }
        : { shape: 'card', perDensity: 80, sizeScale: 2.2, material: { roughness: 0.65, map: LEAF_TEXTURES[type], alphaTest: 0.4 } },
  },
} satisfies Record<StyleName, StyleLook>;

/** What `Style.apply` accepts: a Species, or a Tree Definition to re-style. */
export type StyleSource = SpeciesDefinition | TreeDefinition | TreeDefinitionInput;

/** `{ [key]: value }` for an optional block that is present, `{}` when it is absent (to spread). */
function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

/** The Style-neutral content of a source: every non-look field, plus foliage and bark. */
interface Neutral {
  /** Definition fields that pass through (shape, Season, Wind, Sculpts, Fruit, Roots, ...). */
  base: Record<string, unknown> & { trunk: object; branches: object[] };
  foliage: SpeciesFoliageDefinition;
  /** A Definition's Ground Tint passes through too: it is not part of a Style's look. */
  bark: SpeciesBarkDefinition & Pick<BarkMaterialDefinition, 'groundTint'>;
  /** A Definition's Material Features pass through too (ADR 0008): they are the app's choice, never a Style's. */
  features: MaterialFeatures;
}

function fromSpecies(species: SpeciesDefinition): Neutral {
  const { id, name, trunk, branches, season, wind, variation, fruit, roots, foliage, bark } = species;
  return {
    base: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name,
      species: id,
      trunk,
      branches,
      season,
      wind,
      variation,
      sculpts: [],
      ...present('fruit', fruit),
      ...present('roots', roots),
    },
    foliage,
    bark,
    features: {},
  };
}

function fromDefinition(input: TreeDefinition | TreeDefinitionInput): Neutral {
  const definition = parseDefinition(input);
  const { leaves, materials, ...base } = definition;
  // Definitions not made by `apply` carry no Leaf / Bark Type: guess them from how they are drawn.
  const leafType = leaves.type ?? (leaves.shape === 'needle' || /needle/.test(materials.leaf.map ?? '') ? 'needle' : 'broad');
  const source = LOOKS[styleOfShading(materials.shading)].leaf(leafType);
  return {
    base,
    foliage: {
      type: leafType,
      density: leaves.count / source.perDensity,
      size: leaves.size / source.sizeScale,
      sizeVariation: leaves.sizeVariation,
      start: leaves.start,
      angle: leaves.angle,
    },
    bark: {
      type: materials.bark.type ?? 'furrowed',
      color: materials.bark.color,
      ...present('groundTint', materials.bark.groundTint),
    },
    features: {
      ...present('crownNormals', materials.leaf.crownNormals),
      ...present('translucency', materials.leaf.translucency),
      ...present('occlusion', materials.occlusion),
    },
  };
}

function draw(name: StyleName, { base, foliage, bark, features }: Neutral): TreeDefinition {
  const look: StyleLook = LOOKS[name];
  const leaf = look.leaf(foliage.type);
  const fruit = base.fruit as TreeDefinition['fruit'];
  const roots = base.roots as TreeDefinition['roots'];
  return parseDefinition({
    ...base,
    ...present('fruit', fruit && { ...fruit, sides: look.fruitSides }),
    ...present('roots', roots && { ...roots, ...look.roots }),
    trunk: { ...base.trunk, ...look.trunk },
    branches: base.branches.map((level, i) => ({ ...level, ...look.branches[Math.min(i, look.branches.length - 1)] })),
    leaves: {
      type: foliage.type,
      count: Math.round(foliage.density * leaf.perDensity),
      shape: leaf.shape,
      size: foliage.size * leaf.sizeScale,
      sizeVariation: foliage.sizeVariation,
      start: foliage.start,
      angle: foliage.angle,
    },
    materials: {
      shading: styleShading(name),
      bark: { type: bark.type, color: bark.color, ...look.bark(bark.type), ...present('groundTint', bark.groundTint) },
      leaf: { ...leaf.material, ...present('crownNormals', features.crownNormals), ...present('translucency', features.translucency) },
      ...present('occlusion', features.occlusion),
    },
  });
}

/**
 * Applies a built-in Style's look to a Species or a Tree Definition (see `TreeStyle.apply`).
 * Pure: never mutates its inputs.
 */
export function applyStyle(name: StyleName, source: StyleSource, overrides?: DefinitionPatch): TreeDefinition {
  const neutral = 'schemaVersion' in source ? fromDefinition(source) : fromSpecies(source);
  const definition = draw(name, neutral);
  return overrides ? extendDefinition(definition, overrides) : definition;
}
