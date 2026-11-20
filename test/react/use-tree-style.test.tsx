import { describe, expect, it, vi } from 'vitest';
import { Suspense } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Tree as TreeObject, TreeStyle } from '../../src/index';
import { Tree, useTreeStyle } from '../../src/react';
import { oak } from '../../src/species';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

// Stand-in for a slow network: the Style chunk only "arrives" when the test calls download().
let download!: () => void;
const downloaded = new Promise<void>((resolve) => (download = resolve));
vi.mock('../../src/styles/low-poly', async (importOriginal) => {
  await downloaded;
  return importOriginal();
});

function Forest() {
  const lowPoly = useTreeStyle('low-poly');
  return (
    <>
      <Tree style={lowPoly} form="conifer" seed={1} />
      <Tree style="low-poly" seed={2} />
    </>
  );
}

const names = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) => r.scene.children.map((c) => c.instance.name);

describe('useTreeStyle', () => {
  it('suspends while the Style downloads, then grows its Definitions', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Suspense fallback={<group name="loading" />}>
        <Forest />
      </Suspense>,
      { gl },
    );
    expect(names(renderer)).toEqual(['loading']);

    download();
    await vi.waitFor(async () => {
      await renderer.update(
        <Suspense fallback={<group name="loading" />}>
          <Forest />
        </Suspense>,
      );
      expect(names(renderer)).toEqual(['Tree', 'Tree']);
    });

    const [conifer, broadleaf] = renderer.scene.children.map((c) => c.instance as TreeObject);
    const lowPoly = (await import('../../src/styles/low-poly')).default as TreeStyle;
    expect(conifer!.definition).toEqual(lowPoly.conifer);
    expect(conifer!.seed).toBe(1);
    expect(broadleaf!.definition).toEqual(lowPoly.broadleaf);
    await renderer.unmount();
  });

  it('returns the same Style object on every render (loaded once)', async () => {
    const seen: TreeStyle[] = [];
    function Probe() {
      seen.push(useTreeStyle('low-poly'));
      return null;
    }
    const renderer = await ReactThreeTestRenderer.create(
      <Suspense fallback={null}>
        <Probe />
      </Suspense>,
      { gl },
    );
    await renderer.update(
      <Suspense fallback={null}>
        <Probe />
      </Suspense>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]!.name).toBe('low-poly');
    await renderer.unmount();
  });

  it("loads Painterly: useTreeStyle('painterly') grows a Painterly Species and Form, and <Tree style=\"painterly\"> too", async () => {
    function Painterly() {
      const painterly = useTreeStyle('painterly');
      return (
        <>
          <Tree species={oak} style={painterly} seed={7} />
          <Tree style="painterly" form="conifer" seed={2} />
        </>
      );
    }
    const renderer = await ReactThreeTestRenderer.create(
      <Suspense fallback={null}>
        <Painterly />
      </Suspense>,
      { gl },
    );
    await vi.waitFor(async () => {
      await renderer.update(
        <Suspense fallback={null}>
          <Painterly />
        </Suspense>,
      );
      expect(names(renderer)).toEqual(['Tree', 'Tree']);
    });

    const painterly = (await import('../../src/styles/painterly')).default as TreeStyle;
    const [species, conifer] = renderer.scene.children.map((c) => c.instance as TreeObject);
    expect(species!.definition).toEqual(painterly.apply(oak));
    expect(species!.definition).toMatchObject({ species: 'oak', materials: { shading: 'painted' }, leaves: { shape: 'mass' } });
    expect(species!.definition.trunk.length).toBeLessThan(oak.trunk.length * 0.5); // drawn at its Painterly size
    expect(conifer!.definition).toEqual(painterly.conifer);
    expect(species!.leaves.geometry.getAttribute('position').count).toBeGreaterThan(0);
    await renderer.unmount();
  });
});
