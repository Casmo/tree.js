import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { getSceneShaderHooks, setSceneShaderHooks, type TreeShaderHook } from '../../src/index';
import { sceneSnow, sceneWetness, Snow, type SnowCoverHooks, type WetnessHooks } from '../../src/weather';
import { SceneShaderHooks, SnowCover, Wetness } from '../../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

const mine: TreeShaderHook = ({ color }) => color.mul(1.1);

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
  setSceneShaderHooks({});
  sceneSnow.amount = 0;
  sceneWetness.amount = 0;
});

describe('<SnowCover>', () => {
  it('puts Snow Cover on every tree while mounted, driven by the scene-wide snow amount', async () => {
    const ref = createRef<SnowCoverHooks>();
    renderer = await ReactThreeTestRenderer.create(<SnowCover ref={ref} amount={0.8} />, { gl });
    const snow = ref.current!;
    expect(snow.snow).toBe(sceneSnow);
    expect(sceneSnow.amount).toBeCloseTo(0.8);
    expect(getSceneShaderHooks()).toEqual({ bark: [snow.bark], leaves: [snow.leaves], fruit: [snow.fruit] });

    await renderer.update(<SnowCover ref={ref} amount={0.3} />);
    expect(ref.current).toBe(snow); // the same hooks: an amount is a uniform write
    expect(sceneSnow.amount).toBeCloseTo(0.3);

    await renderer.unmount();
    renderer = undefined;
    expect(getSceneShaderHooks()).toEqual({});
    expect(sceneSnow.amount).toBe(0); // the amount it found
  });

  it('takes the settings live, and an unset setting goes back to its default', async () => {
    const ref = createRef<SnowCoverHooks>();
    renderer = await ReactThreeTestRenderer.create(<SnowCover ref={ref} color="#ffffff" slope={50} softness={10} strength={{ leaves: 0.5 }} />, { gl });
    const snow = ref.current!;
    expect(snow.settings.color.getHex()).toBe(0xffffff);
    expect(snow.settings).toMatchObject({ slope: 50, softness: 10, strength: { bark: 1, leaves: 0.5, fruit: 1 } });

    await renderer.update(<SnowCover ref={ref} slope={70} />);
    expect(ref.current).toBe(snow);
    expect(snow.settings.color.getHexString()).toBe('f4f8ff');
    expect(snow.settings).toMatchObject({ slope: 70, softness: 25, strength: { bark: 1, leaves: 1, fruit: 1 } });
  });

  it('can follow another Snow than the scene-wide one', async () => {
    const ref = createRef<SnowCoverHooks>();
    const drift = new Snow();
    renderer = await ReactThreeTestRenderer.create(<SnowCover ref={ref} snow={drift} amount={1} />, { gl });
    expect(ref.current!.snow).toBe(drift);
    expect(drift.amount).toBe(1);
    expect(sceneSnow.amount).toBe(0);
  });
});

describe('<Wetness>', () => {
  it('puts Wetness on every tree while mounted, with its amount and settings', async () => {
    const ref = createRef<WetnessHooks>();
    renderer = await ReactThreeTestRenderer.create(<Wetness ref={ref} amount={0.6} darkening={0.5} sheen={0.7} />, { gl });
    const wet = ref.current!;
    expect(sceneWetness.amount).toBeCloseTo(0.6);
    expect(wet.settings).toMatchObject({ darkening: 0.5, sheen: 0.7, slope: 110 });
    expect(getSceneShaderHooks()).toEqual({ bark: [wet.bark], leaves: [wet.leaves], fruit: [wet.fruit] });

    await renderer.update(<Wetness ref={ref} amount={0.6} />);
    expect(wet.settings).toMatchObject({ darkening: 0.4, sheen: 0.6 });
    await renderer.unmount();
    renderer = undefined;
    expect(getSceneShaderHooks()).toEqual({});
  });

  it('stacks with Snow Cover and the app\'s own scene-wide hooks', async () => {
    const snowRef = createRef<SnowCoverHooks>();
    const wetRef = createRef<WetnessHooks>();
    renderer = await ReactThreeTestRenderer.create(
      <>
        <SceneShaderHooks hooks={{ leaves: mine }} />
        <SnowCover ref={snowRef} amount={0.5} />
        <Wetness ref={wetRef} amount={0.5} />
      </>,
      { gl },
    );
    const { leaves } = getSceneShaderHooks();
    expect(leaves).toEqual([mine, snowRef.current!.leaves, wetRef.current!.leaves]);
  });
});
