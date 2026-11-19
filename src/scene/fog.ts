import { Color, type ColorRepresentation, type Node, type Scene } from 'three/webgpu';
import { fog, positionWorld, rangeFogFactor, smoothstep, uniform } from 'three/tsl';

/** A far layer of the height mist: a thinner haze over the whole height, far away (all optional). */
export interface SceneMistFarLayerOptions {
  /** Where the far layer starts, in metres from the camera (default 30). */
  near?: number;
  /** Where the far layer reaches its strength, in metres (default 120). */
  far?: number;
  /** Its strength at `far`, 0-1 (default 0.4). */
  strength?: number;
}

/** A height mist: fog that lies low, below `height` (all optional). */
export interface SceneMistOptions {
  /** The mist's top, in metres above y = 0: densest at the ground, gone at this height (default 2). */
  height?: number;
  /** How dense the mist gets far away, 0-1 (default 0.7). */
  strength?: number;
  /** Where the mist starts, in metres from the camera (default 8). */
  near?: number;
  /** Where the mist reaches its strength, in metres from the camera (default 40). */
  far?: number;
  /** A thinner haze far away, over the whole height (`null` / left out = none). */
  farLayer?: SceneMistFarLayerOptions | null;
}

/**
 * Fog settings, in metres, tuned for a small forest scene (all optional; every number and the
 * colour are uniforms). Scale the distances up for large worlds.
 */
export interface SceneFogOptions {
  /** The fog colour. Default: `scene.background` when that is a plain Color, otherwise a pale sky blue. */
  color?: ColorRepresentation;
  /** Where the distance fog starts, in metres from the camera (default 10). */
  near?: number;
  /** Where the distance fog is complete, in metres from the camera (default 80). */
  far?: number;
  /** A low height mist on top of the distance fog (`null` / left out = none). */
  mist?: SceneMistOptions | null;
}

/** The fog colour when neither the settings nor a plain-colour background give one. */
const DEFAULT_COLOR = '#c9d8e2';

/**
 * Scene Effect: distance fog plus an optional low height mist, as a fog node for `scene.fogNode`
 * (three applies it in every material). `background` is the scene's background: when it is a plain
 * Color, that is the default fog colour, so far trees fade into the sky. Pass `scene.background`.
 */
export function sceneFog(options: SceneFogOptions = {}, background?: Scene['background']): Node {
  return liveSceneFog(options, background).node;
}

/** {@link sceneFog} with `update()`: new numbers and colour, the same node (no material recompile). */
export function liveSceneFog(options: SceneFogOptions, background?: Scene['background']) {
  const color = uniform(new Color());
  const near = uniform(0);
  const far = uniform(0);
  const mistHeight = uniform(0);
  const mistStrength = uniform(0);
  const mistNear = uniform(0);
  const mistFar = uniform(0);
  const layerNear = uniform(0);
  const layerFar = uniform(0);
  const layerStrength = uniform(0);
  const update = (o: SceneFogOptions, bg?: Scene['background']): void => {
    color.value.set(o.color ?? (bg instanceof Color ? bg : DEFAULT_COLOR));
    near.value = o.near ?? 10;
    far.value = o.far ?? 80;
    // A mist (or far layer) that is off is a strength of 0: the same graph either way.
    const mist = o.mist ?? null;
    mistHeight.value = Math.max(mist?.height ?? 2, 1e-3);
    mistStrength.value = mist ? (mist.strength ?? 0.7) : 0;
    mistNear.value = mist?.near ?? 8;
    mistFar.value = mist?.far ?? 40;
    const layer = mist?.farLayer ?? null;
    layerNear.value = layer?.near ?? 30;
    layerFar.value = layer?.far ?? 120;
    layerStrength.value = layer ? (layer.strength ?? 0.4) : 0;
  };
  update(options, background);
  const distance = rangeFogFactor(near, far);
  const mist = rangeFogFactor(mistNear, mistFar).mul(smoothstep(mistHeight, 0, positionWorld.y)).mul(mistStrength);
  const layer = rangeFogFactor(layerNear, layerFar).mul(layerStrength);
  // Independent layers: each lets through a part of what the others let through.
  const factor = distance.oneMinus().mul(mist.oneMinus()).mul(layer.oneMinus()).oneMinus().clamp(0, 1);
  return { node: fog(color, factor) as unknown as Node, update };
}
