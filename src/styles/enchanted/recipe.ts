// What the Enchanted Fantasy Style writes onto every tree it draws (ADR 0017): its Snake Twist recipe,
// its colours and its Inner Glow. Kept apart from the Style's Definitions so the shared `applyStyle` can
// use it without pulling in the Style chunk.
import type { FantasyLevelTwist, FantasyPalette, FantasyRecipe, FantasyTwist } from '../fantasy';

const snake = { twistStyle: 'snake', spin: 'random', twistCurve: 0 } as const;
const trunk = (twist: number): FantasyTwist => ({ ...snake, twist, twists: 3 });
const level = (twist: number, twists: number): FantasyLevelTwist => ({ ...snake, twist, twists, followTwist: false });

/** Three close variants (teal, cyan, blue-violet) that turn magenta / violet in autumn. */
const DECIDUOUS: FantasyPalette[] = [
  { spring: '#8ff0dc', summer: '#1fd0b4', autumn: '#e33fc8', accent: '#5cf7e0' },
  { spring: '#93e6fa', summer: '#20bde0', autumn: '#b23ff0', accent: '#62e3ff' },
  { spring: '#a9d8ff', summer: '#3aa6e8', autumn: '#d24ae6', accent: '#8ab8ff' },
];

/** Evergreens stay teal all year: the same variants, their autumn a deeper shade of their summer. */
const EVERGREEN: FantasyPalette[] = [
  { spring: '#5fe6cc', summer: '#1fd0b4', autumn: '#18b49c', accent: '#5cf7e0' },
  { spring: '#62d8f0', summer: '#20bde0', autumn: '#19a2c4', accent: '#62e3ff' },
  { spring: '#3ee0c8', summer: '#16c2b0', autumn: '#12a898', accent: '#4ff0d8' },
];

/**
 * Enchanted: every tree snakes with many Twists (Spin Random, no Twist Curve, no Follow Twist), the trunk
 * milder for conifers so a fir still reads as a fir. Deep indigo bark, teal Leaf Palettes (magenta in
 * autumn for a source that drops its leaves) and an Inner Glow in the leaves and bark veins.
 */
export const ENCHANTED: FantasyRecipe = {
  twist: {
    broadleaf: { trunk: trunk(0.5), level1: level(0.8, 4), deeper: level(0.6, 3) },
    conifer: { trunk: trunk(0.3), level1: level(0.8, 4), deeper: level(0.6, 3) },
  },
  barkColor: '#2c2458',
  palettes: (evergreen) => (evergreen ? EVERGREEN : DECIDUOUS),
  innerGlow: { leaf: 1, veins: 1 },
};
