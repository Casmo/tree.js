import { useLayoutEffect } from 'react';
import { sceneWind, type Wind as WindObject, type WindDirection } from '../wind';

export interface WindProps {
  /** World-space direction the wind blows towards (any non-zero length). Unset: leave as is (default +X). */
  direction?: WindDirection;
  /** 0 = calm, 1 = strong wind, more for storms. Unset: leave as is (default 0). */
  strength?: number;
  /** Pins the Wind clock to this many seconds (pause, screenshots). Unset: the renderer clock. */
  time?: number | null;
  /** The Wind to drive. Default: the scene-wide `sceneWind` every `<Tree>` sways with. */
  wind?: WindObject;
}

/**
 * Declares the Wind. Renders nothing; it writes the Wind's uniforms (no recompile), and puts back the
 * direction, strength and clock it found when it unmounts.
 */
export function Wind({ direction, strength, time = null, wind = sceneWind }: WindProps): null {
  // Depend on the components, so a new array literal with the same values does nothing.
  const [x, y, z] = direction === undefined ? [] : Array.isArray(direction) ? direction : (direction as { toArray(): number[] }).toArray();

  useLayoutEffect(() => {
    const previous = { direction: wind.direction, strength: wind.strength, time: wind.time };
    return () => {
      wind.set(previous);
      wind.time = previous.time;
    };
  }, [wind]);

  useLayoutEffect(() => {
    if (x !== undefined) wind.direction = [x, y!, z!];
  }, [wind, x, y, z]);

  useLayoutEffect(() => {
    if (strength !== undefined) wind.strength = strength;
  }, [wind, strength]);

  useLayoutEffect(() => {
    wind.time = time;
  }, [wind, time]);

  return null;
}
