import { wrapSeason } from './profile';

/** A Season set by the app: must be finite (RangeError otherwise), then wrapped into 0..1. */
export function checkedSeason(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Season must be a finite number, got ${value}`);
  return wrapSeason(value);
}
