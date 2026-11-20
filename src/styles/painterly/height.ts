// Painterly height compression (ADR 0013): the Painterly Style scales each tree uniformly (trunk length
// and radius, leaf size, Fruit and Ground Tint together; branch and Root fields are fractions of their
// parent, so they follow) so that its fully grown height maps linearly from its real height into the
// Painterly range, keeping the order between Species. Only the overall size changes, never the shape.
import { parseDefinition } from '../../definition/parse';
import type { TreeDefinition } from '../../definition/types';
import { generateTree } from '../../generator';

/**
 * Real heights (metres, see {@link treeHeight}) of the lowest and the tallest Species in the catalogue
 * (peach and redwood), drawn in Painterly before scaling. A test keeps them in step with the Species.
 */
export const CATALOGUE_HEIGHTS = { min: 4.58, max: 15.42 } as const;

/**
 * Where the catalogue's real heights land. Inside 2-4 m by the Seed's variation of a tree's height
 * (up to about ±7 % around the mean), so every Seed of every Species stays within 2-4 m.
 */
export const PAINTERLY_HEIGHTS = { min: 2.2, max: 3.8 } as const;

/** A tree at most this tall (metres) is already Painterly-sized and keeps its size (no shrinking twice). */
export const PAINTERLY_MAX_HEIGHT = 4;

/** Seeds whose mean height is a tree's height. */
const SEEDS = [1, 2, 3];

/** Heights already measured, by Definition (JSON): `Style.apply` runs again on every React render. */
const measured = new Map<string, number>();
const MEASURED_MAX = 64;

/** Mean height (metres) of the fully grown tree (top of its wood, leaves and Fruit) over a few Seeds. */
export function treeHeight(definition: TreeDefinition): number {
  const key = JSON.stringify(definition);
  const known = measured.get(key);
  if (known !== undefined) return known;
  const height = measureHeight(definition);
  if (measured.size >= MEASURED_MAX) measured.delete(measured.keys().next().value!);
  measured.set(key, height);
  return height;
}

function measureHeight(definition: TreeDefinition): number {
  let sum = 0;
  for (const seed of SEEDS) {
    const data = generateTree(definition, seed);
    let top = 0;
    for (const { positions } of [data.wood, data.leaves, data.fruit]) for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!);
    sum += top;
  }
  return sum / SEEDS.length;
}

/** The Painterly height for a real height: linear from the catalogue's range into the Painterly range, clamped. */
export function painterlyHeight(height: number): number {
  const t = Math.min(1, Math.max(0, (height - CATALOGUE_HEIGHTS.min) / (CATALOGUE_HEIGHTS.max - CATALOGUE_HEIGHTS.min)));
  return PAINTERLY_HEIGHTS.min + t * (PAINTERLY_HEIGHTS.max - PAINTERLY_HEIGHTS.min);
}

/** Scales a tree uniformly by `factor`: every length in metres; every other length is a fraction of one. Pure. */
export function scaleDefinition(definition: TreeDefinition, factor: number): TreeDefinition {
  const { trunk, leaves, fruit, materials } = definition;
  const { groundTint } = materials.bark;
  return parseDefinition({
    ...definition,
    trunk: { ...trunk, length: trunk.length * factor, radius: trunk.radius * factor },
    leaves: { ...leaves, size: leaves.size * factor },
    ...(fruit && { fruit: { ...fruit, size: fruit.size * factor } }),
    materials: { ...materials, bark: { ...materials.bark, ...(groundTint && { groundTint: { ...groundTint, height: groundTint.height * factor } }) } },
  });
}

/** Scales a real-sized tree to its Painterly height; a tree already at most 4 m tall is kept as is. */
export function compressHeight(definition: TreeDefinition): TreeDefinition {
  const height = treeHeight(definition);
  return height <= PAINTERLY_MAX_HEIGHT ? definition : scaleDefinition(definition, painterlyHeight(height) / height);
}
