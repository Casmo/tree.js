import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION } from '@casmo/tree.js';
import { createEditorStore } from '../store';
import { createSeedGuard } from './seed-guard';
import { deleteBranch } from './sculpts';

function setup(sculptSeed: number | null) {
  const definition = sculptSeed === null ? DEFAULT_DEFINITION : deleteBranch(DEFAULT_DEFINITION, sculptSeed, '0.1');
  const store = createEditorStore({ definition, seed: 5 });
  const asked: string[] = [];
  let answer: (ok: boolean) => void = () => {};
  const guard = createSeedGuard(store, (message) => {
    asked.push(message);
    return new Promise<boolean>((resolve) => (answer = resolve));
  });
  return { store, asked, guard, answer: (ok: boolean) => answer(ok) };
}

describe('changing Seed while Sculpts exist', () => {
  it('changes Seed straight away when the current Seed has no Sculpts', async () => {
    const { store, asked, guard } = setup(9);
    await guard.changeSeed(6);
    expect(store.state.seed).toBe(6);
    expect(asked).toEqual([]);
  });

  it('warns first; cancelling keeps the Seed and its Sculpts', async () => {
    const { store, asked, guard, answer } = setup(5);
    const done = guard.changeSeed(6);
    expect(store.state.seed).toBe(5);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/1 Sculpt.*Seed 5/);
    answer(false);
    expect(await done).toBe(false);
    expect(store.state.seed).toBe(5);
  });

  it('confirming changes to the latest requested Seed; the Sculpts stay for their own Seed', async () => {
    const { store, asked, guard, answer } = setup(5);
    const first = guard.changeSeed(6);
    const second = guard.changeSeed(8); // the slider kept moving while the warning was open
    expect(asked).toHaveLength(1);
    answer(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(store.state.seed).toBe(8);
    expect(store.state.definition.sculpts).toEqual([{ seed: 5, path: '0.1', action: 'delete' }]);
  });
});
