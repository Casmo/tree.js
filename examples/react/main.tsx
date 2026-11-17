// React Three Fiber example: a low-poly Style loaded with useTreeStyle (Suspense), <Tree> and <Wind>;
// with ?scene=forest a <Forest> whose trees are planted and cut by changing its placements.
// Query parameters (used by the Playwright tests):
//   ?scene=forest  a <Forest> of 49 trees instead of two <Tree>s (click a tree to cut it)
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?growth=<0..1>  Growth of the trees (default 1)
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?wind=<strength>  Wind strength (default 0); ?windTime=<s> pins the Wind clock
import * as THREE from 'three/webgpu';
import { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Forest, Tree, Wind, useTreeStyle, type ForestTreePlacement } from '@casmo/tree.js/react';
import type { Forest as ForestObject } from '@casmo/tree.js';

declare global {
  interface Window {
    reactExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      setGrowth?: (g: number) => void;
      /** ?scene=forest: the Forest object, and setters for its placements (React state). */
      forest?: ForestObject;
      cutTree?: (id: string) => void;
      plantTree?: (placement: ForestTreePlacement) => void;
    };
  }
}

window.reactExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const forceWebGL = params.get('backend') === 'webgl';
const windTime = params.get('windTime');
const scene = params.get('scene') === 'forest' ? 'forest' : 'trees';

function Trees({ growth }: { growth: number }) {
  const lowPoly = useTreeStyle('low-poly');
  const season = Number(params.get('season') ?? 0.37);
  return (
    <>
      <Tree style={lowPoly} form="broadleaf" seed={1} growth={growth} season={season} position={[-2.2, 0, 0]} />
      <Tree style={lowPoly} form="conifer" seed={2} growth={growth} season={season} position={[2.2, 0, 0]} />
    </>
  );
}

/** A 7 x 7 grid; the middle row grows younger (per-tree Growth). */
function initialPlacements(): ForestTreePlacement[] {
  const out: ForestTreePlacement[] = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      out.push({
        id: `${row}-${col}`,
        position: [(col - 3) * 1.6 + (row % 2) * 0.5, 0, (row - 3) * 1.6],
        rotation: row * 7 + col,
        scale: 0.2,
        ...(row === 3 ? { growth: 0.5 } : {}),
      });
    }
  }
  return out;
}

function Woods({ growth }: { growth: number }) {
  const lowPoly = useTreeStyle('low-poly');
  const season = Number(params.get('season') ?? 0.37);
  const [placements, setPlacements] = useState(initialPlacements);
  const [forest, setForest] = useState<ForestObject | null>(null);
  useEffect(() => {
    if (forest) window.reactExample.forest = forest;
    window.reactExample.cutTree = (id) => setPlacements((ps) => ps.filter((p) => p.id !== id));
    window.reactExample.plantTree = (p) => setPlacements((ps) => [...ps, p]);
  }, [forest]);
  return (
    <Forest
      ref={setForest}
      style={lowPoly}
      form="broadleaf"
      variants={4}
      seed={3}
      placements={placements}
      growth={growth}
      season={season}
      onClick={(e) => {
        e.stopPropagation();
        const tree = forest?.treeAt(e);
        if (tree) window.reactExample.cutTree!(tree.key);
      }}
    />
  );
}

/** Mounted once the Suspense boundary resolved: reports the backend after the trees were drawn. */
function Ready() {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer;
  useEffect(() => {
    // Two frames: one to compile and draw, one to be sure the canvas shows it.
    let frames = 0;
    let handle = requestAnimationFrame(function tick() {
      if (++frames < 3) handle = requestAnimationFrame(tick);
      else {
        const backend = (gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
        document.getElementById('status')!.textContent = `R3F + WebGPURenderer (${backend})`;
        window.reactExample = { ...window.reactExample, status: 'rendered', backend };
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [gl]);
  return null;
}

function App() {
  const [growth, setGrowth] = useState(Number(params.get('growth') ?? 1));
  useEffect(() => {
    window.reactExample.setGrowth = setGrowth;
  }, []);
  return (
    <Canvas
      shadows="percentage"
      dpr={1}
      camera={{ position: [7, 4.5, 9], fov: 45 }}
      onCreated={({ camera }) => camera.lookAt(0, 2.2, 0)}
      // R3F v9: an async factory must init() the WebGPURenderer before returning it.
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({ ...(props as object), antialias: true, forceWebGL });
        await renderer.init();
        return renderer;
      }}
    >
      <color attach="background" args={['#cfe3f0']} />
      <hemisphereLight args={['#ffffff', '#6a7a4a', 1.5]} />
      <directionalLight position={[5, 8, 3]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#7da05a" />
      </mesh>
      <Wind direction={[1, 0, -0.4]} strength={Number(params.get('wind') ?? 0)} time={windTime === null ? null : Number(windTime)} />
      <Suspense fallback={null}>
        {scene === 'forest' ? <Woods growth={growth} /> : <Trees growth={growth} />}
        <Ready />
      </Suspense>
    </Canvas>
  );
}

addEventListener('error', (e) => {
  window.reactExample = { status: 'error', error: String(e.message) };
});
createRoot(document.getElementById('root')!).render(<App />);
