// What the Stylized Painterly Style writes onto every tree it draws: Enchanted's Snake Twist recipe
// (many Twists, Spin Random, no Twist Curve, no Follow Twist; milder on a conifer's trunk) and nothing
// else, so the Species keeps its own colours and Season. Kept apart from the Style's Definitions so the
// shared `applyStyle` can use it without pulling in the Style chunk.
import type { TreeForm } from '../../definition/types';
import { ENCHANTED } from '../enchanted/recipe';
import type { FantasyTwistRecipe } from '../fantasy';

/** Stylized Painterly's Twist per Form and depth: the Enchanted one. */
export const STYLIZED_PAINTERLY_TWIST: Readonly<Record<TreeForm, FantasyTwistRecipe>> = ENCHANTED.twist;
