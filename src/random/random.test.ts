import { describe, expect, it } from 'vitest';
import { createRandom, hashString } from './index';

describe('hashString (FNV-1a 32-bit)', () => {
  it('matches the published FNV-1a test vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
});

describe('createRandom', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('gives a different sequence for a different seed', () => {
    const a = createRandom(1);
    const b = createRandom(2);
    expect(Array.from({ length: 5 }, () => a.next())).not.toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('returns floats in [0, 1) spread over the range', () => {
    const r = createRandom(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });

  it('range(min, max) stays within bounds', () => {
    const r = createRandom(3);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  it('fork(key) gives an independent stream that does not depend on how much the parent was used', () => {
    const a = createRandom(9);
    const b = createRandom(9);
    b.next();
    b.next();
    expect(a.fork('trunk').next()).toBe(b.fork('trunk').next());
    expect(a.fork('trunk').next()).not.toBe(a.fork('leaves').next());
  });

  it('is stable across releases (golden values for seed 12345)', () => {
    const r = createRandom(12345);
    expect(Array.from({ length: 3 }, () => r.next())).toMatchSnapshot();
  });
});
