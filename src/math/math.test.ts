import { describe, expect, it } from 'vitest';
import { hashBytes } from '../random';
import { cos, exp, log, pow, sin } from './index';

/** Inputs spread over the ranges the Generator uses (angles of many turns, colours, exponents). */
const sweep = (from: number, to: number, n = 2000) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);

/** Relative (or, near zero, absolute) error. */
const error = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe('deterministic maths (same bits on every engine)', () => {
  it('sin and cos agree with the platform within a few ulps, over many turns', () => {
    for (const x of [...sweep(-20 * Math.PI, 20 * Math.PI, 20000), 1e4, -1e4 + 0.3]) {
      expect(error(sin(x), Math.sin(x))).toBeLessThan(1e-15);
      expect(error(cos(x), Math.cos(x))).toBeLessThan(1e-15);
    }
  });

  it('sin and cos are exact where they must be', () => {
    expect(sin(0)).toBe(0);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Math.PI / 2)).toBe(1);
    expect(cos(Math.PI)).toBe(-1);
    expect(sin(Number.NaN)).toBeNaN();
    expect(cos(Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it('exp and log agree with the platform within a few ulps', () => {
    for (const x of sweep(-700, 700, 20000)) expect(Math.abs(exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(1e-15);
    for (const x of [...sweep(1e-6, 4, 20000), 1e-300, 5e-324, 123456.789, 1e300]) {
      expect(error(log(x), Math.log(x))).toBeLessThan(1e-15);
    }
    expect(exp(0)).toBe(1);
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(log(-1)).toBeNaN();
    expect(exp(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(exp(-1000)).toBe(0);
  });

  it('pow agrees with the platform for the bases and exponents the library uses', () => {
    for (const x of sweep(0, 1, 2000)) {
      for (const y of [0.25, 0.5, 1, 1.7, 2, 2.4]) expect(Math.abs(pow(x, y) - Math.pow(x, y))).toBeLessThan(1e-15);
    }
    expect(pow(0, 2)).toBe(0);
    expect(pow(0, 0)).toBe(1);
    expect(pow(1, 2.4)).toBe(1);
    expect(pow(5, 0)).toBe(1);
    expect(pow(-2, 3)).toBeCloseTo(-8, 13);
    expect(pow(-2, 0.5)).toBeNaN();
  });

  it('gives the same bits as recorded (golden fingerprint: never changes across engines or releases)', () => {
    const xs = sweep(-50, 50, 5000);
    const out = new Float64Array(xs.length * 4);
    xs.forEach((x, i) => out.set([sin(x), cos(x), exp(x / 8), pow(Math.abs(x) / 50, 2.4)], i * 4));
    expect(hashBytes(new Uint8Array(out.buffer)).toString(16)).toMatchInlineSnapshot(`"95910a9f"`);
  });
});
