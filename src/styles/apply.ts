// Style.apply (ADR 0005): a Style turns a Style-neutral Species (or an existing Tree Definition)
// into a complete Tree Definition by choosing only the look: shading, polygon detail, how the
// Leaf Type and Bark Type are drawn, and textures. Shape fields pass through untouched.
import { extendDefinition, parseDefinition, type DefinitionPatch } from '../definition/parse';
import {
  CURRENT_SCHEMA_VERSION,
  type BarkMaterialDefinition,
  type BarkType,
  type LeafMaterialDefinition,
  type LeafShape,
  type LeafType,
  type Shading,
  type TreeDefinition,
  type TreeDefinitionInput,
} from '../definition/types';
import type { SpeciesBarkDefinition, SpeciesDefinition, SpeciesFoliageDefinition } from '../species/types';
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

/** Everything a Style decides about a tree: its look. */
interface StyleLook {
  shading: Shading;
  trunk: Detail;
  /** Detail per branch level; deeper levels reuse the last entry. */
  branches: Detail[];
  bark(type: BarkType): Omit<BarkMaterialDefinition, 'type' | 'color'>;
  leaf(type: LeafType): LeafLook;
}

const isFine = (type: LeafType) => type === 'needle' || type === 'scale';
const untexturedLeaf: LeafMaterialDefinition = { roughness: 1, map: null, alphaTest: 0.5 };
const untexturedBark = () => ({ roughness: 1, map: null, normalMap: null });

// Calibrated so a Species with density 0.5 and leaf-spray size 0.35 m comes out close to each
// Style's own broadleaf / conifer Definitions.
const LOOKS = {
  'low-poly': {
    shading: 'flat',
    trunk: { sides: 5, sections: 4 },
    branches: [{ sides: 4, sections: 2 }, { sides: 3, sections: 1 }],
    bark: untexturedBark,
    leaf: (type) =>
      isFine(type)
        ? { shape: 'needle', perDensity: 14, sizeScale: 1.86, material: untexturedLeaf }
        : { shape: 'clump', perDensity: 4, sizeScale: 2.86, material: untexturedLeaf },
  },
  stylized: {
    shading: 'toon',
    trunk: { sides: 10, sections: 8 },
    branches: [{ sides: 8, sections: 5 }, { sides: 6, sections: 3 }, { sides: 4, sections: 2 }, { sides: 3, sections: 1 }],
    bark: untexturedBark,
    // All puffs; smaller and denser for needle / scale foliage.
    leaf: (type) =>
      isFine(type)
        ? { shape: 'puff', perDensity: 8, sizeScale: 1.7, material: untexturedLeaf }
        : { shape: 'puff', perDensity: 4, sizeScale: 3.14, material: untexturedLeaf },
  },
  realistic: {
    shading: 'standard',
    trunk: { sides: 12, sections: 10 },
    branches: [{ sides: 8, sections: 6 }, { sides: 5, sections: 4 }, { sides: 3, sections: 2 }],
    // A texture per Bark Type and per Leaf Type (scripts/generate-textures.mjs).
    bark: (type) => ({ roughness: 0.95, ...BARK_TEXTURES[type] }),
    leaf: (type) =>
      isFine(type)
        ? { shape: 'card', perDensity: 16, sizeScale: 2.3, material: { roughness: 0.7, map: LEAF_TEXTURES[type], alphaTest: 0.4 } }
        : { shape: 'card', perDensity: 12, sizeScale: 2, material: { roughness: 0.65, map: LEAF_TEXTURES[type], alphaTest: 0.4 } },
  },
} satisfies Record<string, StyleLook>;

/** Name of a Style that has a look (the built-in Styles). */
export type LookName = keyof typeof LOOKS;

/** What `Style.apply` accepts: a Species, or a Tree Definition to re-style. */
export type StyleSource = SpeciesDefinition | TreeDefinition | TreeDefinitionInput;

/** The Style-neutral content of a source: every non-look field, plus foliage and bark. */
interface Neutral {
  /** Definition fields that pass through (shape, Season, Wind, Sculpts, Fruit, ...). */
  base: Record<string, unknown> & { trunk: object; branches: object[] };
  foliage: SpeciesFoliageDefinition;
  bark: SpeciesBarkDefinition;
}

function fromSpecies(species: SpeciesDefinition): Neutral {
  const { id, name, trunk, branches, season, wind, variation, fruit, foliage, bark } = species;
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
      ...(fruit ? { fruit } : {}),
    },
    foliage,
    bark,
  };
}

/** The look a Definition was drawn in, recognised by its shading. */
const LOOK_BY_SHADING: Record<Shading, StyleLook> = { flat: LOOKS['low-poly'], toon: LOOKS.stylized, standard: LOOKS.realistic };

function fromDefinition(input: TreeDefinition | TreeDefinitionInput): Neutral {
  const definition = parseDefinition(input);
  const { leaves, materials, ...base } = definition;
  // Definitions not made by `apply` carry no Leaf / Bark Type: guess them from how they are drawn.
  const leafType = leaves.type ?? (leaves.shape === 'needle' || /needle/.test(materials.leaf.map ?? '') ? 'needle' : 'broad');
  const source = LOOK_BY_SHADING[materials.shading].leaf(leafType);
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
    bark: { type: materials.bark.type ?? 'furrowed', color: materials.bark.color },
  };
}

function draw(look: StyleLook, { base, foliage, bark }: Neutral): TreeDefinition {
  const leaf = look.leaf(foliage.type);
  return parseDefinition({
    ...base,
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
      shading: look.shading,
      bark: { type: bark.type, color: bark.color, ...look.bark(bark.type) },
      leaf: { ...leaf.material },
    },
  });
}

/**
 * Applies a built-in Style's look to a Species or a Tree Definition (see `TreeStyle.apply`).
 * Pure: never mutates its inputs.
 */
export function applyStyle(name: LookName, source: StyleSource, overrides?: DefinitionPatch): TreeDefinition {
  const neutral = 'schemaVersion' in source ? fromDefinition(source) : fromSpecies(source);
  const definition = draw(LOOKS[name], neutral);
  return overrides ? extendDefinition(definition, overrides) : definition;
}
