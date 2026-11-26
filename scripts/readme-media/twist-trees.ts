// The Tree Definitions of the README's Twist pictures (scripts/readme-media/main.ts): Twist Styles side by
// side, Follow Twist off and on, and an extreme stylized Corkscrew. All start from the stylized broadleaf.
import { extendDefinition, type BranchLevelDefinition, type DefinitionPatch, type TreeDefinition } from '@casmo/tree.js';
import stylized from '@casmo/tree.js/styles/stylized';

/** A bare demo tree: a straight trunk with a few long, thick branches, so their paths are easy to see. */
function bare(trunk: DefinitionPatch['trunk'], branch: Partial<BranchLevelDefinition>): TreeDefinition {
  return extendDefinition(stylized.broadleaf, {
    name: 'Twist demo',
    trunk: { length: 3.4, radius: 0.22, bend: 0, lengthVariation: 0, ...trunk },
    branches: [
      { count: 4, start: 0.35, end: 0.85, angle: 65, angleVariation: 0.1, spiral: 137.5, length: 0.9, lengthVariation: 0.1, radius: 0.6, taper: 0.6, sides: 8, sections: 24, bend: 0, gravity: 0, ...branch },
    ],
    leaves: { count: 0 },
  });
}

/** Twist Styles: none, Snake, Corkscrew, Corkscrew with Twist Curve 0.6 (Spin clockwise on all). */
export const TWIST_STYLE_TREES: TreeDefinition[] = [
  bare({}, {}),
  bare({}, { twist: 1, twists: 2 }),
  bare({}, { twist: 1, twists: 2, twistStyle: 'corkscrew', spin: 'clockwise' }),
  bare({}, { twist: 1, twists: 2, twistStyle: 'corkscrew', spin: 'clockwise', twistCurve: 0.6 }),
];

/** Follow Twist off and on: a Corkscrew trunk with Corkscrew branches of Random Spin. */
export function followTwistTree(followTwist: boolean): TreeDefinition {
  return bare(
    { twist: 0.6, twists: 2, twistStyle: 'corkscrew', spin: 'clockwise', twistCurve: 0.4, sections: 24 },
    { count: 6, twist: 0.7, twists: 2, twistStyle: 'corkscrew', twistCurve: 0.6, ...(followTwist ? { followTwist } : {}) },
  );
}

/** The extreme stylized example: a Corkscrew trunk with Twist Curve 0.6 and following Corkscrew branches (as in the README). */
const [first, second] = stylized.broadleaf.branches;
const follow = { bend: 0, twists: 2, twistStyle: 'corkscrew', twistCurve: 0.3, followTwist: true } as const;
export const EXTREME_CORKSCREW: TreeDefinition = extendDefinition(stylized.broadleaf, {
  name: 'Extreme Corkscrew',
  trunk: { length: 4.5, bend: 0, twist: 0.8, twists: 2, twistStyle: 'corkscrew', spin: 'clockwise', twistCurve: 0.6 },
  branches: [
    { ...first, ...follow, length: 0.7, twist: 0.9 },
    { ...second, ...follow, twist: 0.8 },
  ],
  leaves: { count: 1, size: 0.6 },
});
