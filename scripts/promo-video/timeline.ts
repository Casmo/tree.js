// Pure timing helpers of the promo video (scripts/promo-video/main.ts): easing, keyframe tracks,
// grow-and-shrink envelopes, ripples and a variable-speed turntable that always makes exactly one
// turn per loop. No three.js here, so they are unit tested (test/promo-timeline.test.ts).

/** Loop length in seconds: the video is made to play on repeat. */
export const DURATION = 30;
/** Frames per second of the captured video. */
export const FPS = 60;
/** Frames in one loop (the frame at DURATION is frame 0 again). */
export const FRAMES = DURATION * FPS;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 0 before `a`, 1 after `b`, a smooth (cubic Hermite) step in between. */
export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInCubic = (t: number): number => clamp01(t) ** 3;
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A keyframe of a track: the value at time `t` (seconds). */
export interface Key<T> {
  t: number;
  value: T;
}

/**
 * The value of a keyframe track at time `t`: held before the first and after the last key,
 * eased (sine in-out) between two keys. Keys must be sorted by time.
 */
export function sample(keys: readonly Key<number>[], t: number): number {
  const first = keys[0];
  if (!first) throw new Error('A track needs at least one key');
  if (t <= first.t) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      return lerp(a.value, b.value, easeInOutSine((t - a.t) / (b.t - a.t)));
    }
  }
  return keys[keys.length - 1]!.value;
}

/** '#rrggbb' -> [r, g, b] in 0..1 (sRGB, as written). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A colour track sampled like {@link sample}, channel by channel (sRGB). */
export function sampleColor(keys: readonly Key<string>[], t: number): [number, number, number] {
  const rgb = keys.map((key) => ({ t: key.t, value: hexToRgb(key.value) }));
  return [0, 1, 2].map((c) => sample(rgb.map((key) => ({ t: key.t, value: key.value[c]! })), t)) as [number, number, number];
}

/**
 * The Growth of a tree that sprouts at `grow[0]`, is fully grown at `grow[1]`, starts to shrink back
 * at `shrink[0]` and is gone at `shrink[1]` (ease-out up, ease-in down).
 */
export function envelope(t: number, grow: readonly [number, number], shrink: readonly [number, number]): number {
  if (t < grow[0] || t >= shrink[1]) return 0;
  const up = easeOutCubic((t - grow[0]) / (grow[1] - grow[0]));
  const down = 1 - easeInCubic((t - shrink[0]) / (shrink[1] - shrink[0]));
  return Math.min(up, t >= shrink[0] ? down : 1);
}

/**
 * Growth of a tree in a ripple: a wave that starts at the centre at `start` and reaches the outer edge
 * (`distance` 1) `spread` seconds later; each tree takes `duration` seconds to grow once reached.
 * With `shrink`, the same wave runs again from `shrink.start` and takes the trees back.
 */
export function ripple(
  t: number,
  distance: number,
  grow: { start: number; spread: number; duration: number },
  shrink: { start: number; spread: number; duration: number },
): number {
  const g0 = grow.start + clamp01(distance) * grow.spread;
  const s0 = shrink.start + clamp01(distance) * shrink.spread;
  return envelope(t, [g0, g0 + grow.duration], [s0, s0 + shrink.duration]);
}

/**
 * A turntable that makes exactly one full turn per loop at a speed that varies over it: `speed(t)`
 * (any positive function) is integrated and normalised, so the angle at `DURATION` is 2π and the
 * motion is seamless when `speed(0) === speed(DURATION)`.
 */
export function turntable(speed: (t: number) => number, duration = DURATION, steps = 3000): (t: number) => number {
  const cumulative = new Float64Array(steps + 1);
  const dt = duration / steps;
  for (let i = 1; i <= steps; i++) {
    cumulative[i] = cumulative[i - 1]! + 0.5 * (speed((i - 1) * dt) + speed(i * dt)) * dt;
  }
  const total = cumulative[steps]!;
  return (t: number) => {
    const turns = Math.floor(t / duration);
    const local = t - turns * duration;
    const x = local / dt;
    const i = Math.min(Math.floor(x), steps - 1);
    const within = cumulative[i]! + (cumulative[i + 1]! - cumulative[i]!) * (x - i);
    return 2 * Math.PI * (turns + within / total);
  };
}

/** Wraps a time into the loop, [0, DURATION). */
export const loopTime = (t: number, duration = DURATION): number => ((t % duration) + duration) % duration;

/**
 * What the camera must show of the hero tree at its distance, whatever the aspect ratio (m): the
 * hero is at most 8 m tall and 11 m wide (scripts/promo-video/main.ts), with a little room around.
 */
export const HERO_FRAME = { width: 12, height: 10.5 };

/** The camera of the landscape (16:9) video. */
const CAMERA = { fov: 36, position: [0, 3.1, 16.5] as [number, number, number], target: [0, 3.75, 0] as [number, number, number] };

/**
 * The fixed camera for a viewport aspect ratio (width / height): the landscape camera, with a wider
 * (vertical) field of view where the frame is too narrow for the hero tree (square, portrait).
 * `particleTop` is the height weather particles fall from: above the top of the frame.
 */
export function framing(aspect: number): { fov: number; position: [number, number, number]; target: [number, number, number]; particleTop: number } {
  const [, y, z] = CAMERA.position;
  const distance = Math.hypot(y - CAMERA.target[1], z - CAMERA.target[2]);
  const base = Math.tan((CAMERA.fov * Math.PI) / 360);
  const needed = Math.max(HERO_FRAME.height / 2, HERO_FRAME.width / 2 / aspect) / distance;
  const tanHalf = Math.max(base, needed);
  const fov = tanHalf === base ? CAMERA.fov : (360 / Math.PI) * Math.atan(tanHalf);
  // Particles out to 8 m behind the hero still start above the frame.
  const particleTop = Math.max(12, Math.ceil(CAMERA.target[1] + (distance + 8) * tanHalf));
  return { fov, position: [...CAMERA.position], target: [...CAMERA.target], particleTop };
}
