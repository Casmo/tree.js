// Preview state that is not part of the Definition: Seed, Growth and Season.
// Seed changes go through the Sculpt Seed guard (a warning when the current Seed has Sculpts).
import { seedGuard } from '../sculpt/seed-dialog';
import { numberControl } from './controls';
import type { Panel } from './types';

export const previewPanel: Panel = {
  id: 'preview',
  title: 'Preview',
  render(context) {
    const root = document.createElement('div');
    root.append(
      numberControl(context, {
        label: 'Seed',
        id: 'seed',
        min: 0,
        max: 9999,
        step: 1,
        get: (state) => state.seed,
        set: (store, seed) => void seedGuard(store).changeSeed(seed),
      }),
      numberControl(context, {
        label: 'Growth',
        id: 'growth',
        min: 0,
        max: 1,
        step: 0.01,
        get: (state) => state.growth,
        set: (store, growth) => store.set({ growth }),
      }),
      numberControl(context, {
        label: 'Season',
        id: 'season',
        min: 0,
        max: 1,
        step: 0.01,
        get: (state) => state.season,
        set: (store, season) => store.set({ season }),
      }),
    );
    return root;
  },
};
