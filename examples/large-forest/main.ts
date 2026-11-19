// Large-forest example: about 10,000 trees under a slowly orbiting camera, with Forest Detail Levels
// (ADR 0010) on or off. Each run draws a fixed number of frames and reports their average and p95 frame
// time, the draw calls, the triangles and the trees per Detail Level; the panel keeps both runs side by side.
// Query parameters (used by the Playwright tests):
//   ?trees=<n>  number of trees (default 10000)
//   ?lod=0|1  start without or with Detail Levels (default 1; the button rebuilds the Forest the other way)
//   ?frames=<n>  frames per measured run (default 120)
//   ?orbit=<degrees>  pin the camera at that angle of its orbit (no motion, for tests and screenshots)
//   ?variants=<n>  number of Variants (default 4)
//   ?seed=<n>  forest seed (default 1)
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback (every tree in full, with or without lod)
//
// Frame time = from the start of `renderer.render` until the GPU has finished that frame (WebGPU:
// `queue.onSubmittedWorkDone`; on WebGL2 `gl.finish()`, which browsers may return from early), one frame
// per animation frame, after 3 unmeasured warm-up frames. three.js's `renderer.info` does not count
// indirect draws, so the Detail Level draws and triangles are read back from their draw arguments.
import * as THREE from 'three/webgpu';
import { createForest, createRandom, SEASON_PROFILES, type Forest, type ForestPlacement, type TreeDefinitionInput } from '@casmo/tree.js';
import { drawnTriangles, frameStats, type FrameStats } from './stats';

/** One measured run: the Forest with or without Detail Levels. */
interface Run {
  lod: boolean;
  /** Frame time in ms over `frameTime.frames` frames. */
  frameTime: FrameStats;
  /** Draw calls of the last frame (Detail Level meshes issue one indirect draw each, even when empty). */
  drawCalls: number;
  /** Triangles drawn in the last frame (all instances). */
  triangles: number;
  /** Trees per Detail Level in the last frame (a tree in a cross-fade counts at both levels). */
  levels: { full: number; light: number; impostor: number };
}

declare global {
  interface Window {
    largeForestExample: {
      /** 'loading' while the Forest is built, baked or measured. */
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      trees?: number;
      /** Whether the current Forest has Detail Levels. */
      lod?: boolean;
      /** The last run of each kind. */
      runs?: { off?: Run; on?: Run };
      /** Rebuilds the Forest with or without Detail Levels and measures it (status 'loading' until done). */
      setLod?: (lod: boolean) => Promise<void>;
    };
  }
}

window.largeForestExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);
const statusEl = document.getElementById('status')!;
const rowsEl = document.getElementById('rows')!;
const toggle = document.getElementById('toggle') as HTMLButtonElement;

const definition: TreeDefinitionInput = {
  schemaVersion: 2,
  branches: [
    { count: 6, angle: 50 },
    { count: 3, start: 0.25, angle: 40, length: 0.45, sides: 4, sections: 3 },
  ],
  leaves: { count: 6, size: 0.4 },
  season: SEASON_PROFILES.deciduous,
};

// A jittered grid; the jitter comes from the tree.js Random so the forest is reproducible.
const count = number('trees', 10_000);
const side = Math.ceil(Math.sqrt(count));
const spacing = 4;
const extent = side * spacing;
const jitter = createRandom(99);
const placements: ForestPlacement[] = [];
for (let i = 0; i < count; i++) {
  const x = ((i % side) - (side - 1) / 2) * spacing + jitter.range(-1.4, 1.4);
  const z = (Math.floor(i / side) - (side - 1) / 2) * spacing + jitter.range(-1.4, 1.4);
  placements.push({ id: i, position: [x, 0, z], rotation: jitter.range(0, Math.PI * 2), scale: jitter.range(0.8, 1.2) });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe3f0');
scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(5, 8, 3);
scene.add(sun);
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(extent + 80, extent + 80).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' })));

// The camera circles inside the forest's edge, above the crowns, looking down across it.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, extent * 1.5);
const radius = extent * 0.35;
const pinned = params.get('orbit');
let angle = pinned === null ? 0 : (Number(pinned) * Math.PI) / 180;
/** Radians per measured frame: both runs see the same views. */
const STEP = (0.15 * Math.PI) / 180;
function placeCamera(): void {
  camera.position.set(Math.cos(angle) * radius, 24, Math.sin(angle) * radius);
  camera.lookAt(-Math.cos(angle) * radius * 0.3, 0, -Math.sin(angle) * radius * 0.3);
}
placeCamera();

const frames = number('frames', 120);
const WARMUP_FRAMES = 3;
const runs: { off?: Run; on?: Run } = {};
let forest: Forest | null = null;
let lod = params.get('lod') !== '0';

const nextFrame = () => new Promise<number>((done) => requestAnimationFrame(done));

async function main(): Promise<void> {
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const device = (renderer.backend as { device?: GPUDevice }).device;
  const gl = (renderer.backend as { gl?: WebGL2RenderingContext }).gl;
  const backend = device ? 'webgpu' : 'webgl2';

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /** What `renderer.info` counted in the last frame (three resets it on the next animation frame). */
  let counted = { drawCalls: 0, triangles: 0 };

  /** Renders one frame and resolves when the GPU has finished it, with the time that took (ms). */
  async function timedFrame(): Promise<number> {
    const start = performance.now();
    renderer.render(scene, camera);
    counted = { drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles };
    if (device) await device.queue.onSubmittedWorkDone();
    else gl?.finish();
    return performance.now() - start;
  }

  /** Draw calls, triangles and trees per Detail Level of the frame just drawn. */
  async function frameCounts(current: Forest): Promise<Pick<Run, 'drawCalls' | 'triangles' | 'levels'>> {
    let { drawCalls, triangles } = counted;
    const drawsLevels = current.variants.some((v) => v.levels);
    if (!drawsLevels) return { drawCalls, triangles, levels: { full: current.size, light: 0, impostor: 0 } };
    for (const variant of current.variants) {
      if (!variant.levels) continue;
      drawCalls += variant.levels.meshes.length;
      triangles += drawnTriangles(new Uint32Array(await renderer.getArrayBufferAsync(variant.levels.drawArguments)));
    }
    const [full, light, impostor] = await current.detailLevelCounts(renderer);
    return { drawCalls, triangles, levels: { full: full!, light: light!, impostor: impostor! } };
  }

  /** Builds the Forest with or without Detail Levels, draws `frames` frames and records the run. */
  async function build(withLod: boolean): Promise<void> {
    window.largeForestExample.status = 'loading';
    toggle.disabled = true;
    renderer.setAnimationLoop(null);
    if (forest) {
      scene.remove(forest);
      forest.dispose();
    }
    lod = withLod;
    show(`building ${count} trees ${lod ? 'with' : 'without'} Detail Levels...`);
    const current = createForest(definition, placements, { variants: number('variants', 4), seed: number('seed', 1), season: 0.37, lod });
    forest = current;
    await current.ready;
    scene.add(current);
    renderer.render(scene, camera);
    if (lod) {
      // The first frame finds the backend; then the Impostors are baked (lodReady), after which the
      // Detail Levels draw. That one-off cost is not part of the measured frames.
      show('baking Impostors...');
      await current.lodReady;
    }
    // A few unmeasured frames first: the first frames of new meshes compile their pipelines.
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      await nextFrame();
      await timedFrame();
    }
    show(`measuring ${frames} frames...`);
    const startAngle = angle;
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      await nextFrame();
      if (pinned === null) angle = startAngle + i * STEP;
      placeCamera();
      times.push(await timedFrame());
    }
    const run: Run = { lod, frameTime: frameStats(times), ...(await frameCounts(current)) };
    runs[lod ? 'on' : 'off'] = run;
    updatePanel();
    show(`WebGPURenderer (${backend}) - ${current.size} trees, Detail Levels ${lod ? 'on' : 'off'}`);
    window.largeForestExample = { ...window.largeForestExample, status: 'rendered', backend, trees: current.size, lod, runs: { ...runs } };
    toggle.disabled = false;
    if (pinned === null) {
      let last = performance.now();
      renderer.setAnimationLoop((time) => {
        angle += ((time - last) / 1000) * ((2.5 * Math.PI) / 180); // 2.5 degrees per second
        last = time;
        placeCamera();
        renderer.render(scene, camera);
      });
    }
  }

  window.largeForestExample.setLod = build;
  window.largeForestExample.backend = backend;
  toggle.addEventListener('click', () => {
    build(!lod).catch(fail);
  });
  await build(lod);
}

function show(text: string): void {
  statusEl.textContent = text;
}

const ROWS: [string, (run: Run) => string][] = [
  ['frame time, average', (r) => `${r.frameTime.average.toFixed(1)} ms`],
  ['frame time, p95', (r) => `${r.frameTime.p95.toFixed(1)} ms`],
  ['frames measured', (r) => String(r.frameTime.frames)],
  ['draw calls', (r) => r.drawCalls.toLocaleString('en')],
  ['triangles', (r) => r.triangles.toLocaleString('en')],
  ['trees Full', (r) => r.levels.full.toLocaleString('en')],
  ['trees Light', (r) => r.levels.light.toLocaleString('en')],
  ['trees Impostor', (r) => r.levels.impostor.toLocaleString('en')],
];

function updatePanel(): void {
  rowsEl.replaceChildren(
    ...ROWS.map(([label, format]) => {
      const row = document.createElement('tr');
      for (const text of [label, runs.off ? format(runs.off) : '-', runs.on ? format(runs.on) : '-']) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      return row;
    }),
  );
  document.getElementById('head-off')!.classList.toggle('current', !lod);
  document.getElementById('head-on')!.classList.toggle('current', lod);
  toggle.textContent = lod ? 'Rebuild without Detail Levels' : 'Rebuild with Detail Levels';
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  show(message);
  window.largeForestExample = { status: 'error', error: message };
  console.error(error);
}

updatePanel();
main().catch(fail);
