import { describe, expect, it } from 'vitest';
import { DetailLevel, selectDetailLevel } from '../src/index';

// light 10, impostor 40, fade 0.2: bands 9..11 (Full -> Light) and 36..44 (Light -> Impostor).
const settings = { light: 10, impostor: 40, fade: 0.2 };
const select = (distance: number, scale = 1, growth = 1) => selectDetailLevel(distance, scale, growth, settings);

describe('selectDetailLevel', () => {
  it('draws near trees Full, middle trees Light and far trees as an Impostor', () => {
    expect(select(0)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(5)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(20)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(100)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('cross-fades in a band of `fade` times the switch distance, centred on it', () => {
    // Band edges: 9 and 11 for Light, 36 and 44 for Impostor.
    expect(select(9)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(9.5).level).toBe(DetailLevel.Full);
    expect(select(9.5).fade).toBeCloseTo(0.25);
    expect(select(10).fade).toBeCloseTo(0.5);
    expect(select(10.5).fade).toBeCloseTo(0.75);
    expect(select(11)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(36)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(38)).toEqual({ level: DetailLevel.Light, fade: 0.25 });
    expect(select(40)).toEqual({ level: DetailLevel.Light, fade: 0.5 });
    expect(select(44)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('gives a tree in a band complementary amounts for both neighbouring levels', () => {
    const { level, fade } = select(38);
    // `level` draws with 1 - fade and the next level with fade: together always one tree.
    expect(level).toBe(DetailLevel.Light);
    expect(1 - fade).toBeCloseTo(0.75);
    expect(fade).toBeCloseTo(0.25);
  });

  it('switches without a band when fade is 0', () => {
    const hard = { light: 10, impostor: 40, fade: 0 };
    expect(selectDetailLevel(9.999, 1, 1, hard)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(selectDetailLevel(10, 1, 1, hard)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(selectDetailLevel(39.999, 1, 1, hard)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(selectDetailLevel(40, 1, 1, hard)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });

  it('divides the distance by the placement scale: bigger trees switch later', () => {
    // A tree at scale 2 switches at twice the distance: 18 / 2 = 9, 22 / 2 = 11, 80 / 2 = 40.
    expect(select(18, 2)).toEqual({ level: DetailLevel.Full, fade: 0 });
    expect(select(20, 2).fade).toBeCloseTo(0.5);
    expect(select(22, 2)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(80, 2)).toEqual({ level: DetailLevel.Light, fade: 0.5 });
    // ...and a small one sooner (6 / 0.5 = 12).
    expect(select(6, 0.5)).toEqual({ level: DetailLevel.Light, fade: 0 });
  });

  it('caps a tree that is not fully grown at Light', () => {
    expect(select(100, 1, 0.99)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(40, 1, 0.5)).toEqual({ level: DetailLevel.Light, fade: 0 });
    expect(select(10, 1, 0.5).fade).toBeCloseTo(0.5); // Full -> Light still fades
    expect(select(100, 1, 1)).toEqual({ level: DetailLevel.Impostor, fade: 0 });
  });
});
