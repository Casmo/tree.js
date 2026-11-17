// Sculpts are tied to the Seed they were made on (ADR 0003): on another Seed they no longer show.
// Every Seed change made by the designer goes through this guard, which warns first when the
// current Seed has Sculpts. Nothing is deleted: the Sculpts come back on their own Seed.
import type { EditorStore } from '../store';
import { sculptsOn } from './sculpts';

/** Asks the designer; resolves true to go ahead. */
export type ConfirmSeedChange = (message: string) => Promise<boolean>;

export interface SeedGuard {
  /**
   * Changes the store's Seed, after a warning if the current Seed has Sculpts. Requests made while
   * the warning is open update the Seed it will change to. Resolves whether the Seed changed.
   */
  changeSeed(seed: number): Promise<boolean>;
}

export function sculptWarning(count: number, seed: number): string {
  const sculpts = count === 1 ? '1 Sculpt' : `${count} Sculpts`;
  return `This tree has ${sculpts} made on Seed ${seed}. Other Seeds do not show them; they are kept and come back when you return to Seed ${seed}.`;
}

export function createSeedGuard(store: EditorStore, confirm: ConfirmSeedChange): SeedGuard {
  let pending: { seed: number; answer: Promise<boolean> } | null = null;
  return {
    changeSeed(seed) {
      if (pending) {
        pending.seed = seed;
        return pending.answer;
      }
      const { definition, seed: current } = store.state;
      const count = sculptsOn(definition, current).length;
      if (count === 0 || Math.floor(seed) === current) {
        store.set({ seed });
        return Promise.resolve(true);
      }
      const request: { seed: number; answer: Promise<boolean> } = {
        seed,
        answer: confirm(sculptWarning(count, current)).then((ok) => {
          pending = null;
          if (ok) store.set({ seed: request.seed });
          return ok;
        }),
      };
      pending = request;
      return request.answer;
    },
  };
}
