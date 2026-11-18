// One-click Crown Shapes (ADR 0004): named presets that write a branch level's length and angle
// curves. The name is never stored; the curves are, and can be fine-tuned like any keyframe track.
// Curves are laid out over where the level's branches attach (its start..end on the parent).
import { coneCurve, type BranchLevelDefinition, type Keyframe } from '@casmo/tree.js';

export type CrownShape = 'cone' | 'ball' | 'column' | 'vase' | 'flat-top';

type Curves = Pick<BranchLevelDefinition, 'lengthProfile' | 'angleProfile'>;

/** `at(f)` = the attach position a fraction `f` of the way from the level's start to its end. */
type ShapeCurves = (level: BranchLevelDefinition, at: (f: number) => number) => Curves;

const key = (t: number, value: number): Keyframe<number> => ({ t, value });

export const CROWN_SHAPES: { id: CrownShape; label: string; curves: ShapeCurves }[] = [
  {
    // The conifer cone (as the v2 -> v3 migration writes it): length falls from 1 at the start to 0.1 near the tip.
    id: 'cone',
    label: 'Cone',
    curves: ({ start }) => ({ lengthProfile: coneCurve(start) }),
  },
  {
    id: 'ball',
    label: 'Ball',
    curves: (_, at) => ({
      lengthProfile: [key(at(0), 0.45), key(at(0.5), 1), key(at(1), 0.35)],
      angleProfile: [key(at(0), 1.25), key(at(1), 0.7)],
    }),
  },
  {
    id: 'column',
    label: 'Column',
    curves: () => ({ lengthProfile: [key(0, 0.45)], angleProfile: [key(0, 0.55)] }),
  },
  {
    id: 'vase',
    label: 'Vase',
    curves: (_, at) => ({
      lengthProfile: [key(at(0), 0.35), key(at(1), 1)],
      angleProfile: [key(at(0), 0.5), key(at(1), 0.75)],
    }),
  },
  {
    id: 'flat-top',
    label: 'Flat top',
    curves: (_, at) => ({
      lengthProfile: [key(at(0), 0.3), key(at(0.6), 1)],
      angleProfile: [key(at(0), 0.8), key(at(0.6), 1.5)],
    }),
  },
];

/** The levels with level `index`'s Crown Shape curves replaced by `shape`'s (a curve the shape leaves flat is removed). */
export function applyCrownShape(branches: readonly BranchLevelDefinition[], index: number, shape: CrownShape): BranchLevelDefinition[] {
  const preset = CROWN_SHAPES.find((s) => s.id === shape);
  if (!preset) throw new RangeError(`Unknown Crown Shape "${shape}"`);
  return branches.map((level, i) => {
    if (i !== index) return { ...level };
    const shaped: BranchLevelDefinition = { ...level };
    delete shaped.lengthProfile;
    delete shaped.angleProfile;
    const at = (f: number): number => level.start + f * (level.end - level.start);
    return { ...shaped, ...preset.curves(level, at) };
  });
}
