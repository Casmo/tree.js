import type { TreeDefinition } from '../definition';
import type { Random } from '../random';
import type { SkeletonBranch, SkeletonPoint } from './types';

/** Builds the trunk centre line from the Definition, varied by the Seed within its ranges. */
export function buildTrunk(definition: TreeDefinition, random: Random): SkeletonBranch {
  const { trunk } = definition;
  const length = trunk.length * (1 + random.range(-trunk.lengthVariation, trunk.lengthVariation));
  const sectionLength = length / trunk.sections;
  const maxDrift = trunk.bend * sectionLength;

  const points: SkeletonPoint[] = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i <= trunk.sections; i++) {
    const t = i / trunk.sections;
    if (i > 0) {
      x += random.range(-maxDrift, maxDrift);
      z += random.range(-maxDrift, maxDrift);
    }
    points.push({ position: [x, t * length, z], radius: trunk.radius * (1 + (trunk.taper - 1) * t) });
  }
  return { path: '0', parent: null, level: 0, attach: 0, points };
}
