import { describe, expect, it } from 'vitest';
import { addKeyframe, moveKeyframe, removeKeyframe } from './keyframes';

const track = [
  { t: 0, value: 0.3 },
  { t: 0.5, value: 1 },
  { t: 1, value: 0 },
];

describe('Season Profile keyframe editing', () => {
  it('adds a keyframe at a Season, in order, holding the value in force there', () => {
    expect(addKeyframe(track, 0.7)).toEqual({
      track: [{ t: 0, value: 0.3 }, { t: 0.5, value: 1 }, { t: 0.7, value: 1 }, { t: 1, value: 0 }],
      index: 2,
    });
  });

  it('adds before the first keyframe with the first value', () => {
    const late = [{ t: 0.4, value: '#336633' }];
    expect(addKeyframe(late, 0.1)).toEqual({ track: [{ t: 0.1, value: '#336633' }, { t: 0.4, value: '#336633' }], index: 0 });
  });

  it('moves a keyframe in time and keeps the track sorted', () => {
    expect(moveKeyframe(track, 0, 0.8)).toEqual({
      track: [{ t: 0.5, value: 1 }, { t: 0.8, value: 0.3 }, { t: 1, value: 0 }],
      index: 1,
    });
  });

  it('removes a keyframe but never the last one', () => {
    expect(removeKeyframe(track, 1)).toEqual([{ t: 0, value: 0.3 }, { t: 1, value: 0 }]);
    expect(() => removeKeyframe([{ t: 0, value: 1 }], 0)).toThrow(/at least one keyframe/);
  });

  it('never mutates the given track', () => {
    const copy = structuredClone(track);
    addKeyframe(track, 0.2);
    moveKeyframe(track, 2, 0.1);
    removeKeyframe(track, 0);
    expect(track).toEqual(copy);
  });
});
