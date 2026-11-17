// React Three Fiber example: a low-poly Style loaded with useTreeStyle (Suspense), <Tree> and <Wind>.
// Query parameters (used by the Playwright tests):
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?growth=<0..1>  Growth of the trees (default 1)
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?wind=<strength>  Wind strength (default 0); ?windTime=<s> pins the Wind clock
import * as THREE from 'three/webgpu';
import { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Tree, Wind, useTreeStyle } from '../../src/react';

declare global {
  interface Window {
    reactExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string; setGrowth?: (g: number) => void };
  }
}

window.reactExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const forceWebGL = params.get('backend') === 'webgl';
const windTime = params.get('windTime');

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
        <Trees growth={growth} />
        <Ready />
      </Suspense>
    </Canvas>
  );
}

addEventListener('error', (e) => {
  window.reactExample = { status: 'error', error: String(e.message) };
});
createRoot(document.getElementById('root')!).render(<App />);
