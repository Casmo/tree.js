/**
 * Deterministic maths: the same bits on every machine and JavaScript engine.
 *
 * ECMAScript leaves `Math.sin`, `Math.cos`, `Math.exp`, `Math.log`, `Math.pow`, `Math.hypot`, `**`
 * and friends "implementation-approximated", so engines (and engine versions) may differ in the
 * last bit, which would change a Seed's tree. Everything here is built from `+ - * /`,
 * `Math.sqrt`, `Math.round`/`Math.floor` and exact bit manipulation, which IEEE 754 and the spec
 * pin down exactly. The algorithms are those of fdlibm (sun.com, 1993), accurate to about 1 ulp.
 * ESLint forbids the platform functions in the code that feeds generated geometry and hashes.
 */

const bits = new DataView(new ArrayBuffer(8));

/** 2^k as an exact double, for -1022 <= k <= 1023. */
function powerOfTwo(k: number): number {
  bits.setUint32(0, (k + 1023) << 20);
  bits.setUint32(4, 0);
  return bits.getFloat64(0);
}

// π/2 split into parts with trailing zero bits, so `n * part` is exact (Cody & Waite).
const PIO2_1 = 1.5707963267341256e0; // first 33 bits of π/2
const PIO2_2 = 6.077100506303966e-11; // next 33 bits
const PIO2_3 = 2.0222662487111665e-21; // the rest
const INV_PIO2 = 6.366197723675814e-1;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on |x| <= π/4. */
function kernelSin(x: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + z * x * (S1 + z * r);
}

/** cos on |x| <= π/4. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** `x` reduced to |r| <= ~π/4, and the quadrant (0..3) it came from. Accurate for |x| < 2^20 · π/2. */
function reduce(x: number): [r: number, quadrant: number] {
  if (Math.abs(x) <= Math.PI / 4) return [x, 0];
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  return [r, ((n % 4) + 4) % 4];
}

/** Deterministic `Math.sin`. */
export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (x === 0) return x; // keeps -0
  const [r, q] = reduce(x);
  return q === 0 ? kernelSin(r) : q === 1 ? kernelCos(r) : q === 2 ? -kernelSin(r) : -kernelCos(r);
}

/** Deterministic `Math.cos`. */
export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const [r, q] = reduce(x);
  return q === 0 ? kernelCos(r) : q === 1 ? -kernelSin(r) : q === 2 ? -kernelCos(r) : kernelSin(r);
}

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** Deterministic `Math.exp`. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 709.782712893384) return Number.POSITIVE_INFINITY;
  if (x < -745.1332191019411) return 0;
  if (x === 0) return 1;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  if (k >= -1021) return k === 1024 ? y * 2 * powerOfTwo(1023) : y * powerOfTwo(k);
  return y * powerOfTwo(k + 1000) * powerOfTwo(-1000); // subnormal result
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const TWO54 = 18014398509481984;

/** Deterministic `Math.log` (natural logarithm). */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    x *= TWO54; // subnormal: scale up so the exponent bits are meaningful
    k = -54;
  }
  bits.setFloat64(0, x);
  let high = bits.getUint32(0);
  k += (high >>> 20) - 1023;
  high &= 0x000fffff;
  // Normalise the mantissa m into [√2/2, √2): x = 2^k · m.
  const i = (high + 0x95f64) & 0x100000;
  bits.setUint32(0, high | (i ^ 0x3ff00000));
  k += i >>> 20;
  const f = bits.getFloat64(0) - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const r = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))) + w * (LG2 + w * (LG4 + w * LG6));
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
}

/** Deterministic `Math.pow` (`x ** y`), for the finite values the library uses. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 1) return 1;
  if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  if (x < 0) {
    if (!Number.isInteger(y)) return Number.NaN;
    const p = exp(y * log(-x));
    return y % 2 === 0 ? p : -p;
  }
  return exp(y * log(x));
}

/** Deterministic `Math.hypot` of a 3-vector. */
export function hypot3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Smoothstep from `edge0` to `edge1` (0 below, 1 above, smooth between), as in GLSL. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
