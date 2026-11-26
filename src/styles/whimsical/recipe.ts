// What the Whimsical Fantasy Style writes onto every tree it draws (ADR 0017): its Corkscrew Twist
// recipe and its candy colours. Kept apart from the Style's Definitions so the shared `applyStyle`
// can use it without pulling in the Style chunk.
import type { FantasyLevelTwist, FantasyPalette, FantasyRecipe, FantasyTwist } from '../fantasy';

const corkscrew = { twistStyle: 'corkscrew', spin: 'random' } as const;
const trunk = (twist: number, twistCurve: number): FantasyTwist => ({ ...corkscrew, twist, twists: 2, twistCurve });
const level = (twist: number, twists: number, twistCurve: number): FantasyLevelTwist => ({ ...corkscrew, twist, twists, twistCurve, followTwist: true });

/** Bubblegum pink, mint, lemon, lilac and tangerine: pastel in spring, saturated in summer, warmer in autumn. */
const CANDY: FantasyPalette[] = [
  { spring: '#ffc8e1', summer: '#ff5fa8', autumn: '#ff6a5c', accent: '#ff4f9a' },
  { spring: '#c9f6e2', summer: '#3fd6a0', autumn: '#b9d64a', accent: '#21c08a' },
  { spring: '#fff5b8', summer: '#ffd93b', autumn: '#ffa12e', accent: '#ffc01a' },
  { spring: '#e8d8ff', summer: '#a77bf0', autumn: '#e06cbf', accent: '#9460ee' },
  { spring: '#ffd9ba', summer: '#ff9330', autumn: '#ff4a1c', accent: '#ff7417' },
];

/**
 * Whimsical: every tree corkscrews as one (Spin Random on the trunk, Follow Twist on every level, a
 * strong Twist Curve); conifers milder, so a fir still reads as a fir. Pale cream bark (the `whimsical`
 * shading winds a stripe in the Leaf Palette's accent around it) and five candy Leaf Palettes, the same
 * for evergreens.
 */
export const WHIMSICAL: FantasyRecipe = {
  twist: {
    broadleaf: { trunk: trunk(0.45, 0.35), level1: level(0.6, 2, 0.5), deeper: level(0.5, 1, 0.3) },
    conifer: { trunk: trunk(0.25, 0.1), level1: level(0.6, 2, 0.2), deeper: level(0.5, 1, 0.3) },
  },
  barkColor: '#f7ecd6',
  palettes: () => CANDY,
};
