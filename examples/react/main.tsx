// React Three Fiber example: a low-poly Style loaded with useTreeStyle (Suspense), <Tree> and <Wind>;
// with ?scene=forest a <Forest> whose trees are planted and cut by changing its placements.
// Query parameters (used by the Playwright tests):
//   ?scene=forest  a <Forest> of 49 trees instead of two <Tree>s (click a tree to cut it)
//   ?scene=species  one Species tree: <Tree species={oak} style={lowPoly} seed={7} />
//   ?scene=pipeline  stylized trees rendered through <ScenePipeline style="stylized" sun={sun} />
//   ?scene=weather  two low-poly trees, with setters for <SnowCover>, <Wetness>, a <Tree shaderHooks>,
//                   a Wind Burst (useWindBurst) and a foliage-only <TreeEffect> in a <ScenePipeline>
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?growth=<0..1>  Growth of the trees (default 1)
//   ?season=<0..1>  Season (default 0.37, summer)
//   ?wind=<strength>  Wind strength (default 0); ?windTime=<s> pins the Wind clock
import * as THREE from 'three/webgpu';
import { Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { color, mix, uniform, vec3, vec4 } from 'three/tsl';
import {
  Forest,
  ScenePipeline,
  SnowCover,
  Tree,
  TreeEffect,
  Wetness,
  Wind,
  useScenePipeline,
  useTreeStyle,
  useWindBurst,
  type CustomTreeEffect,
  type ForestTreePlacement,
  type TreeShaderHooks,
  type WindBurstOptions,
} from '@casmo/tree.js/react';
import type { Forest as ForestObject } from '@casmo/tree.js';
import { oak } from '@casmo/tree.js/species';

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
      /** ?scene=pipeline: the Scene Effects the pipeline renders with (once it is built). */
      sceneEffects?: string[];
      /** ?scene=weather: the weather and effects to show (React state), and the Wind clock. */
      setWeather?: (weather: WeatherState) => void;
      setWindTime?: (seconds: number) => void;
      burst?: (options: WindBurstOptions) => void;
      /** Waits for this many rendered frames. */
      frames?: (count: number) => Promise<void>;
    };
  }
}

window.reactExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const forceWebGL = params.get('backend') === 'webgl';
const windTime = params.get('windTime');
const scene = (['forest', 'species', 'pipeline', 'weather'] as const).find((name) => name === params.get('scene')) ?? 'trees';

function Trees({ growth, styleName = 'low-poly' }: { growth: number; styleName?: 'low-poly' | 'stylized' }) {
  const style = useTreeStyle(styleName);
  const season = Number(params.get('season') ?? 0.37);
  return (
    <>
      <Tree style={style} form="broadleaf" seed={1} growth={growth} season={season} position={[-2.2, 0, 0]} />
      <Tree style={style} form="conifer" seed={2} growth={growth} season={season} position={[2.2, 0, 0]} />
    </>
  );
}

/** A Species in a Style: an English oak, drawn low-poly. */
function SpeciesTree({ growth }: { growth: number }) {
  const lowPoly = useTreeStyle('low-poly');
  return <Tree species={oak} style={lowPoly} seed={7} growth={growth} season={Number(params.get('season') ?? 0.37)} scale={0.55} />;
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

/** ?scene=weather: what is on. Unset: not mounted. */
interface WeatherState {
  /** <SnowCover amount>. */
  snow?: number;
  /** <Wetness amount>. */
  wetness?: number;
  /** A Tree Shader Hook that tints the leaves of the right tree only (<Tree shaderHooks>). */
  tint?: boolean;
  /** A foliage-only custom Tree Effect (<TreeEffect> in a bare <ScenePipeline>) at this strength. */
  effect?: number;
}

// A plain Tree Shader Hook: the right tree's leaves turn orange. Module scope: one stable hook.
const tinted: TreeShaderHooks = { leaves: ({ color: base }) => mix(base, vec3(1, 0.35, 0), 0.8) };

/** The bare foliage-only custom Tree Effect: leaf pixels turn magenta by `strength` (mask.g is leaves only). */
const foliage: CustomTreeEffect<{ strength: number }> = {
  build(input, options) {
    const strength = uniform(options.strength);
    const node = vec4(mix(input.color.rgb, color('#ff00ff'), input.mask.g.mul(strength)), input.color.a);
    return { node, update: (next) => (strength.value = next.strength) };
  },
};

function WeatherScene({ weather }: { weather: WeatherState }) {
  const lowPoly = useTreeStyle('low-poly');
  const burst = useWindBurst();
  useEffect(() => {
    window.reactExample.burst = burst;
  }, [burst]);
  return (
    <>
      <Tree style={lowPoly} form="broadleaf" seed={1} season={0.37} position={[-3, 0, 2]} />
      <Tree style={lowPoly} form="broadleaf" seed={4} season={0.37} position={[3, 0, -2]} shaderHooks={weather.tint ? tinted : undefined} />
      {weather.snow !== undefined && <SnowCover amount={weather.snow} />}
      {weather.wetness !== undefined && <Wetness amount={weather.wetness} />}
      {weather.effect !== undefined && (
        <ScenePipeline>
          <TreeEffect effect={foliage} options={{ strength: weather.effect }} />
        </ScenePipeline>
      )}
    </>
  );
}

/** Reports the Scene Effects of the enclosing <ScenePipeline> (useScenePipeline: null until it is built). */
function PipelineStatus() {
  const pipeline = useScenePipeline();
  useEffect(() => {
    if (pipeline) window.reactExample.sceneEffects = Object.keys(pipeline.settings.sceneEffects);
  }, [pipeline]);
  return null;
}

/** Mounted once the Suspense boundary resolved: reports the backend after the trees were drawn. */
function Ready() {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer;
  useEffect(() => {
    // Two frames: one to compile and draw, one to be sure the canvas shows it (more for the pipeline).
    let frames = 0;
    let handle = requestAnimationFrame(function tick() {
      if (++frames < (scene === 'pipeline' ? 8 : 3)) handle = requestAnimationFrame(tick);
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
  const [weather, setWeather] = useState<WeatherState>({});
  const [time, setWindTime] = useState(windTime === null ? null : Number(windTime));
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    window.reactExample.setGrowth = setGrowth;
    window.reactExample.setWeather = setWeather;
    window.reactExample.setWindTime = setWindTime;
    window.reactExample.frames = (count) =>
      new Promise((resolve) => {
        const tick = () => (--count <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
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
      <directionalLight ref={sun} position={[5, 8, 3]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#7da05a" />
      </mesh>
      <Wind direction={[1, 0, -0.4]} strength={Number(params.get('wind') ?? 0)} time={time} />
      <Suspense fallback={null}>
        {scene === 'forest' ? <Woods growth={growth} /> : scene === 'species' ? <SpeciesTree growth={growth} /> : scene === 'pipeline' ? <Trees growth={growth} styleName="stylized" /> : scene === 'weather' ? <WeatherScene weather={weather} /> : <Trees growth={growth} />}
        {scene === 'pipeline' && (
          // The stylized Style's suggested Tree Effects and Scene Effects; `sun` (a ref) is there for god rays.
          <ScenePipeline style="stylized" sun={sun}>
            <PipelineStatus />
          </ScenePipeline>
        )}
        <Ready />
      </Suspense>
    </Canvas>
  );
}

addEventListener('error', (e) => {
  window.reactExample = { status: 'error', error: String(e.message) };
});
createRoot(document.getElementById('root')!).render(<App />);
