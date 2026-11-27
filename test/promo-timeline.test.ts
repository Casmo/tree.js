// The promo video's timing helpers (scripts/promo-video/timeline.ts): the loop must be seamless.
import { describe, expect, it } from 'vitest';
import { DURATION, envelope, FPS, FRAMES, loopTime, ripple, sample, sampleColor, smoothstep, turntable } from '../scripts/promo-video/timeline';

describe('promo video timeline', () => {
  it('is 30 seconds at 60 fps', () => {
    expect(DURATION).toBe(30);
    expect(FPS).toBe(60);
    expect(FRAMES).toBe(1800);
  });

  it('samples tracks: held outside, eased between keys', () => {
    const keys = [{ t: 1, value: 0 }, { t: 3, value: 10 }];
    expect(sample(keys, 0)).toBe(0);
    expect(sample(keys, 2)).toBeCloseTo(5);
    expect(sample(keys, 5)).toBe(10);
    expect(sampleColor([{ t: 0, value: '#000000' }, { t: 1, value: '#ffffff' }], 0.5)).toEqual([0.5, 0.5, 0.5].map((v) => expect.closeTo(v)));
  });

  it('grows and shrinks a tree: 0 outside, 1 when fully grown', () => {
    expect(envelope(0.5, [1, 2], [4, 5])).toBe(0);
    expect(envelope(3, [1, 2], [4, 5])).toBe(1);
    expect(envelope(1.5, [1, 2], [4, 5])).toBeGreaterThan(0.5);
    expect(envelope(4.5, [1, 2], [4, 5])).toBeLessThan(1);
    expect(envelope(5, [1, 2], [4, 5])).toBe(0);
  });

  it('ripples outward: near trees grow first', () => {
    const grow = { start: 0, spread: 2, duration: 1 };
    const shrink = { start: 10, spread: 1, duration: 1 };
    expect(ripple(1, 0, grow, shrink)).toBe(1);
    expect(ripple(1, 1, grow, shrink)).toBe(0);
  });

  it('turns exactly once per loop, seamlessly, whatever the speed', () => {
    const angle = turntable((t) => 1 + Math.sin(t) ** 2);
    expect(angle(0)).toBe(0);
    expect(angle(DURATION - 1e-9)).toBeCloseTo(2 * Math.PI, 5);
    expect(angle(DURATION + 1)).toBeCloseTo(angle(1) + 2 * Math.PI, 9);
    for (let t = 0.1; t < DURATION; t += 0.1) expect(angle(t)).toBeGreaterThan(angle(t - 0.1));
  });

  it('wraps time into the loop and steps smoothly', () => {
    expect(loopTime(31)).toBeCloseTo(1);
    expect(loopTime(-1)).toBeCloseTo(29);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
