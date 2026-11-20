/**
 * Random: the only source of randomness in tree.js.
 *
 * Determinism contract: the same Seed gives the same numbers on every machine
 * and across releases within a major version. `Math.random` is never used
 * (enforced by ESLint). Everything here is plain 32-bit integer math.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash of a string (UTF-16 code units, low byte then high byte). */
export function hashString(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, FNV_PRIME);
    if (c > 0xff) {
      h ^= c >>> 8;
      h = Math.imul(h, FNV_PRIME);
    }
  }
  return h >>> 0;
}

/** FNV-1a 32-bit hash over raw bytes; `h` continues a previous hash. */
export function hashBytes(bytes: Uint8Array, h: number = FNV_OFFSET): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Mixes any number of 32-bit values into one well-distributed 32-bit hash. */
export function hashCombine(...values: number[]): number {
  let h = FNV_OFFSET;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), FNV_PRIME);
    h = fmix32(h);
  }
  return h >>> 0;
}

/** Scratch for {@link seedToUint32} (called for every branch, leaf and Fruit): no allocation per call. */
const SEED_VIEW = new DataView(new ArrayBuffer(8));

/** Converts any finite number (including fractions and negatives) to a 32-bit seed. */
export function seedToUint32(seed: number): number {
  if (!Number.isFinite(seed)) throw new TypeError(`Seed must be a finite number, got ${seed}`);
  SEED_VIEW.setFloat64(0, seed, true);
  return hashCombine(SEED_VIEW.getUint32(0, true), SEED_VIEW.getUint32(4, true));
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Random {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /**
   * An independent stream derived from this stream's seed and `key`.
   * It does not depend on how many numbers this stream has produced, so
   * adding a draw in one part of the generator never shifts another part.
   */
  fork(key: string | number): Random;
}

/** Seeded PRNG (mulberry32). */
export function createRandom(seed: number): Random {
  return fromState(seedToUint32(seed));
}

function fromState(origin: number): Random {
  let state = origin;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    fork: (key) =>
      fromState(hashCombine(origin, typeof key === 'number' ? seedToUint32(key) : hashString(key))),
  };
}

/**
 * A stable 0..1 (exclusive) number from a Seed and a key (a branch path, leaf id, purpose...).
 * It makes no stream draws (ADR 0003), so it never shifts or is shifted by other random numbers.
 */
export function seedRandom(seed: number, key: string): number {
  return hashCombine(seedToUint32(seed), hashString(key)) / 4294967296;
}
