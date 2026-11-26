import { cameraPosition, hash, mx_noise_float, step, uniform, vec3 } from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';
import { TREE_PARTS, type TreePart } from '../effects/mask';

/** The options of a scene-wide weather amount ({@link WeatherAmount}). */
export interface WeatherAmountOptions {
  /** 0 (none, default) .. 1 (full). */
  amount?: number;
}

/**
 * A scene-wide weather amount (0..1) that ready-made hooks follow, shared like a `Wind`: changing it only
 * writes a uniform (no recompile). The base of `Snow` and `Wetness`.
 */
export abstract class WeatherAmount {
  /** The shared TSL uniforms the hooks read. Write through the setters, not here. */
  readonly uniforms: { readonly amount: UniformNode<'float', number> };

  /** `label`: how errors name the amount, e.g. 'Snow amount'. */
  protected constructor(
    private readonly label: string,
    options: WeatherAmountOptions,
  ) {
    this.uniforms = { amount: uniform(0) };
    this.set(options);
  }

  get amount(): number {
    return this.uniforms.amount.value;
  }

  set amount(value: number) {
    this.uniforms.amount.value = unitValue(this.label, value);
  }

  /** Sets the amount; returns this. */
  set(options: WeatherAmountOptions): this {
    if (options.amount !== undefined) this.amount = options.amount;
    return this;
  }
}

/** `value` if it is in 0..1; throws a RangeError naming `label` otherwise. */
export function unitValue(label: string, value: number): number {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`${label} must be a number in 0..1, got ${value}`);
  return value;
}

/** `value` if it is an angle in 0..`max` degrees; throws a RangeError naming `label` otherwise. */
export function degreesValue(label: string, value: number, max: number): number {
  if (!(value >= 0 && value <= max)) throw new RangeError(`${label} must be 0..${max} degrees, got ${value}`);
  return value;
}

/** `value` if it is a finite number >= 0; throws a RangeError naming `label` otherwise. */
export function softnessValue(label: string, value: number): number {
  if (!(value >= 0 && Number.isFinite(value))) throw new RangeError(`${label} must be a finite number >= 0, got ${value}`);
  return value;
}

/** `current` with the per-part strengths of `next` (each checked to be 0..1, `label` names them in errors). */
export function strengthsWith(label: string, current: Record<TreePart, number>, next: Partial<Record<TreePart, number>> | undefined): Record<TreePart, number> {
  const strength = { ...current };
  for (const part of TREE_PARTS) {
    const value = next?.[part];
    if (value !== undefined) strength[part] = unitValue(`${label} ${part} strength`, value);
  }
  return strength;
}

/**
 * The world normal's y range of a slope setting, shared by Snow Cover and Wetness: `slope` is how far a
 * surface may tilt from level (its normal from straight up, in degrees) and still take any; `softness`
 * the degrees below `slope` over which it fades in. `none`: the normal's y at `slope` (none at or beyond
 * it); `full`: at `slope - softness` (full from there up), always above `none`.
 */
export function slopeRange(slope: number, softness: number): { none: number; full: number } {
  const cosOf = (degrees: number) => Math.cos((Math.min(180, Math.max(0, degrees)) * Math.PI) / 180);
  const none = cosOf(slope);
  return { none, full: Math.max(cosOf(slope - softness), none + 1e-4) };
}

/**
 * Glints: 1 in a few tiny cells of world space (`density` cells per metre, the share `1 - threshold` of
 * them), 0 elsewhere, changing with the view as the eye moves, like light caught by crystals or drops.
 */
export function glints(position: Node<'vec3'>, density: number, threshold: number): Node<'float'> {
  const view = cameraPosition.sub(position).normalize();
  const cell = position.mul(density).floor().add(view.mul(6).floor());
  return step(threshold, hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113)))) as unknown as Node<'float'>;
}

/**
 * Brush strokes in world space for the weather on `'painted'` (painterly) trees: smooth noise (about
 * -1..1) in dabs some 10 cm across, a little flatter than tall, so a painted edge reads as brushed
 * rather than as a clean line. Fixed in the world: it sways with the surface only as far as Wind moves it.
 */
export function paintStrokes(position: Node<'vec3'>): Node<'float'> {
  return mx_noise_float(position.mul(vec3(9, 16, 9))) as unknown as Node<'float'>;
}
