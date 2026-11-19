import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { sceneWind, Wind as WindObject, type WindBurstOptions } from '../../src/index';
import { Tree, Wind, useWindBurst } from '../../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

afterEach(() => {
  sceneWind.set({ direction: [1, 0, 0], strength: 0 });
  sceneWind.time = null;
});

describe('<Wind>', () => {
  it('sets the scene-wide Wind every tree sways with, and follows prop changes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Wind direction={[0, 0, 2]} strength={0.6} />, { gl });
    expect(sceneWind.direction.toArray()).toEqual([0, 0, 1]);
    expect(sceneWind.strength).toBe(0.6);

    await renderer.update(<Wind direction={[-1, 0, 0]} strength={1.5} time={3} />);
    expect(sceneWind.direction.toArray()).toEqual([-1, 0, 0]);
    expect(sceneWind.strength).toBe(1.5);
    expect(sceneWind.time).toBe(3);
    await renderer.unmount();
  });

  it('goes back to the Wind it found when it unmounts', async () => {
    sceneWind.set({ direction: [0, 0, -1], strength: 0.2 });
    const renderer = await ReactThreeTestRenderer.create(<Wind direction={[1, 0, 0]} strength={1} time={5} />, { gl });
    await renderer.unmount();
    expect(sceneWind.direction.toArray()).toEqual([0, 0, -1]);
    expect(sceneWind.strength).toBe(0.2);
    expect(sceneWind.time).toBeNull();
  });

  it('can drive a separate Wind that only some trees listen to', async () => {
    const gusts = new WindObject();
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Wind wind={gusts} strength={2} />
        <Tree definition={{ schemaVersion: 2 }} wind={gusts} />
      </>,
      { gl },
    );
    const tree = renderer.scene.children.find((c) => c.instance.name === 'Tree')!.instance as unknown as { wind: WindObject };
    expect(tree.wind).toBe(gusts);
    expect(gusts.strength).toBe(2);
    expect(sceneWind.strength).toBe(0);
    await renderer.unmount();
  });
});

describe('useWindBurst', () => {
  let burst: ((options: WindBurstOptions) => void) | undefined;
  function Placer({ wind }: { wind?: WindObject }) {
    burst = useWindBurst(wind);
    return null;
  }

  it('triggers a Wind Burst on the scene-wide Wind', async () => {
    sceneWind.time = 2;
    const renderer = await ReactThreeTestRenderer.create(<Placer />, { gl });
    const first = burst!;
    first({ x: 3, z: -1, strength: 0.5, radius: 6 });
    expect(sceneWind.bursts).toEqual([{ x: 3, z: -1, strength: 0.5, radius: 6, start: 2 }]);

    await renderer.update(<Placer />);
    expect(burst).toBe(first); // a stable function, safe in effect deps
    await renderer.unmount();
  });

  it('triggers it on another Wind when given one', async () => {
    const gusts = new WindObject();
    gusts.time = 1;
    const renderer = await ReactThreeTestRenderer.create(<Placer wind={gusts} />, { gl });
    burst!({ x: 0, z: 0 });
    expect(gusts.bursts).toHaveLength(1);
    expect(sceneWind.bursts).toHaveLength(0);
    await renderer.unmount();
  });
});
