// Preview state that is not part of the Definition: Seed, Growth and Season.
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
        set: (store, seed) => store.set({ seed }),
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
