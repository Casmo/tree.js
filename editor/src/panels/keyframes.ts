// Pure edits of a Season Profile keyframe track (leaf colour, coverage, blossom). Every edit returns
// a new track kept sorted by `t` (the schema requires non-decreasing `t`), plus where the edited key ended up.
import type { Keyframe } from '@casmo/tree.js';

export interface TrackEdit<V> {
  track: Keyframe<V>[];
  /** Index of the added/moved keyframe in the new track. */
  index: number;
}

/** Inserts `key` after every keyframe with `t <= key.t` (so equal `t`s keep their order). */
function insert<V>(track: readonly Keyframe<V>[], key: Keyframe<V>): TrackEdit<V> {
  let index = 0;
  while (index < track.length && track[index]!.t <= key.t) index++;
  return { track: [...track.slice(0, index), key, ...track.slice(index)].map((k) => ({ ...k })), index };
}

/** A keyframe at Season `t` with the value in force there (the previous keyframe's, or the first one's). */
export function addKeyframe<V>(track: readonly Keyframe<V>[], t: number): TrackEdit<V> {
  const before = track.filter((key) => key.t <= t).at(-1) ?? track[0];
  if (!before) throw new RangeError('A keyframe track needs at least one keyframe to copy a value from');
  return insert(track, { t, value: before.value });
}

/** Moves keyframe `index` to Season `t`, re-sorting the track. */
export function moveKeyframe<V>(track: readonly Keyframe<V>[], index: number, t: number): TrackEdit<V> {
  const key = track[index];
  if (!key) throw new RangeError(`No keyframe ${index}`);
  return insert(
    track.filter((_, i) => i !== index),
    { ...key, t },
  );
}

/** The track without keyframe `index`. A track keeps at least one keyframe. */
export function removeKeyframe<V>(track: readonly Keyframe<V>[], index: number): Keyframe<V>[] {
  if (track.length <= 1) throw new RangeError('A Season track needs at least one keyframe');
  return track.filter((_, i) => i !== index).map((k) => ({ ...k }));
}

/** Where a new keyframe has most room: the middle of the widest gap between keys, or between a key and 0 / 1. */
export function widestGap<V>(track: readonly Keyframe<V>[]): number {
  const ts = [0, ...track.map((key) => key.t), 1];
  let best = { width: -1, middle: 0.5 };
  for (let i = 1; i < ts.length; i++) {
    const width = ts[i]! - ts[i - 1]!;
    if (width > best.width) best = { width, middle: (ts[i]! + ts[i - 1]!) / 2 };
  }
  return Number(best.middle.toFixed(6));
}
