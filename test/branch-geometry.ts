// Vector and centre-line helpers shared by the Twist tests (src/generator/twist.test.ts, stems.test.ts).
import { expect } from 'vitest';
import type { SkeletonBranch, Vec3 } from '../src/generator';

export const DEG = 180 / Math.PI;
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Angle between two unit vectors, degrees. */
export const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * DEG;
/** The unit direction of every segment of a branch's or Stem's centre line. */
export const segments = (b: SkeletonBranch) => b.points.slice(1).map((p, i) => unit(sub(p.position, b.points[i]!.position)));
/** Signed angle (turns) from `a` to `b` around unit `axis`, both first made perpendicular to it: positive clockwise seen looking along `axis`. */
export const turnAbout = (a: Vec3, b: Vec3, axis: Vec3) => {
  const [x, y] = [a, b].map((v) => sub(v, scale(axis, dot(v, axis))));
  return Math.atan2(dot(cross(x!, y!), axis), dot(x!, y!)) / (2 * Math.PI);
};
/** How far apart two azimuths (degrees) are, 0..180. */
export const apart = (a: number, b: number) => 180 - Math.abs(180 - Math.abs(a - b));
export const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
/**
 * No kinks along `dirs` (segment directions): no step between neighbours turns more than `maxStep`
 * degrees, and no step turns more than `maxChange` degrees more or less than the one before it.
 */
export function expectNoKinks(dirs: Vec3[], maxStep: number, maxChange: number, label?: string): void {
  const steps = dirs.slice(1).map((d, i) => angleBetween(dirs[i]!, d));
  for (const step of steps) expect(step, label).toBeLessThan(maxStep);
  for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!), label).toBeLessThan(maxChange);
}
