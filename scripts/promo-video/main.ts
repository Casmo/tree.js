// The promo video: a 30 second loop at 60 fps (1920x1080, or the viewport's size and aspect ratio), captured frame by frame by
// scripts/promo-video/capture.mjs (or played live in a browser).
// One hero tree in the centre on a turntable, a fixed camera, and a backdrop that only sets the mood
// (a ring of Forest trees, a ground disc, weather particles). Six acts, each a Style with its own
// Scene Pipeline, light and weather; the hero tree and the ring shrink back and the next ones grow in.
//   0.0 -  7.2  Stylized: blossom in spring, grows up, summer (petals)
//   6.9 - 13.1  Realistic: an autumn maple in the rain (Wetness, god rays), leaves fall, snow (Snow Cover)
//  12.7 - 17.3  Low-poly: rapid fire through Species (cherry, pine, apple, birch, fir, oak), outlines
//  17.0 - 21.1  Whimsical: a candy Corkscrew, Wind Bursts, confetti, pastel sky
//  20.8 - 26.6  Enchanted: night falls, the Inner Glow and bloom rise, teal turns magenta (fireflies)
//  26.3 - 29.5  Stylized painterly at dawn, then everything shrinks away; the last 0.5 s is the empty stage of
//               frame 0 (Stylized look, spring sky), so the loop is seamless.
// Query parameters:
//   ?live=1      play in real time (loops)
//   ?t=<s>       show one moment (a still)
// The page exposes window.promo: once status is 'ready', `frames` is the frame count and `show(i)`
// sets up and draws frame i. Frames must be shown in order (Wind Bursts start at the Wind time).
import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, uniform } from 'three/tsl';
import {
  createForest,
  createRandom,
  createTree,
  extendDefinition,
  sceneWind,
  Wind,
  setSceneShaderHooks,
  stackShaderHooks,
  type Forest,
  type ForestPlacement,
  type Tree,
  type TreeDefinition,
} from '@casmo/tree.js';
import { SUGGESTED_TREE_EFFECTS } from '@casmo/tree.js/effects';
import { createScenePipeline, SUGGESTED_SCENE_EFFECTS, type ScenePipeline } from '@casmo/tree.js/scene';
import { apple, birch, cherry, douglasFir, maple, oak, pine, spruce } from '@casmo/tree.js/species';
import lowPoly from '@casmo/tree.js/styles/low-poly';
import stylized from '@casmo/tree.js/styles/stylized';
import realistic from '@casmo/tree.js/styles/realistic';
import painterly from '@casmo/tree.js/styles/painterly';
import whimsical from '@casmo/tree.js/styles/whimsical';
import enchanted from '@casmo/tree.js/styles/enchanted';
import stylizedPainterly from '@casmo/tree.js/styles/stylized-painterly';
import { sceneSnow, sceneWetness, snowCoverHooks, wetnessHooks } from '@casmo/tree.js/weather';
import { framingBox } from '../../examples/framing';
import {
  DURATION,
  FPS,
  FRAMES,
  envelope,
  framing,
  loopTime,
  ripple,
  sample,
  sampleColor,
  smoothstep,
  turntable,
  type Key,
} from './timeline';

type StyleName = keyof typeof SUGGESTED_SCENE_EFFECTS;

declare global {
  interface Window {
    promo: { status: 'loading' | 'ready' | 'error'; frames?: number; fps?: number; error?: string; show?: (frame: number) => Promise<void> };
  }
}

window.promo = { status: 'loading' };
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------------------------
// The script: what is on screen when.

/** Height the hero tree is scaled to (m), and the widest it may be. */
const HERO_HEIGHT = 8;
const HERO_WIDTH = 11;

interface HeroSpec {
  definition: TreeDefinition;
  seed: number;
  grow: [number, number];
  shrink: [number, number];
  season: Key<number>[];
  /** Inner Glow over time (Enchanted only). */
  glow?: Key<number>[];
}

/** One act: a Style with its Scene Pipeline, from `from` to `to` (the pipeline switches at `from`). */
interface Act {
  style: StyleName;
  from: number;
  ring: { definitions: TreeDefinition[]; seed: number; season: number; grow: number; shrink: number };
}

/** A backdrop Enchanted tree glows less than the hero. */
function dim(definition: TreeDefinition): TreeDefinition {
  return extendDefinition(definition, { materials: { innerGlow: { leaf: 0.35, veins: 0.4 } } });
}

const ACTS: Act[] = [
  { style: 'stylized', from: 0, ring: { definitions: [stylized.broadleaf, stylized.conifer], seed: 1, season: 0.3, grow: 0.0, shrink: 6.3 } },
  { style: 'realistic', from: 7.05, ring: { definitions: [realistic.apply(birch), realistic.apply(spruce)], seed: 2, season: 0.6, grow: 6.7, shrink: 12.2 } },
  { style: 'low-poly', from: 12.85, ring: { definitions: [lowPoly.apply(oak), lowPoly.conifer], seed: 3, season: 0.25, grow: 12.5, shrink: 16.4 } },
  { style: 'whimsical', from: 17.1, ring: { definitions: [whimsical.broadleaf, whimsical.conifer], seed: 14, season: 0.35, grow: 16.7, shrink: 20.0 } },
  { style: 'enchanted', from: 20.95, ring: { definitions: [dim(enchanted.apply(oak)), dim(enchanted.conifer)], seed: 5, season: 0.4, grow: 20.6, shrink: 25.7 } },
  { style: 'stylized-painterly', from: 26.45, ring: { definitions: [painterly.apply(maple), painterly.conifer], seed: 6, season: 0.42, grow: 26.0, shrink: 28.3 } },
  // The last half second is an empty stage in the first act's look, so frame 1800 is frame 0 again.
  { style: 'stylized', from: 29.55, ring: { definitions: [], seed: 7, season: 0, grow: 40, shrink: 40 } },
];

/** Low-poly rapid fire: a new Species every 0.72 s. */
const RAPID = [
  { definition: lowPoly.apply(cherry), seed: 3, season: 0.04 },
  { definition: lowPoly.apply(pine), seed: 2, season: 0.3 },
  { definition: lowPoly.apply(apple), seed: 4, season: 0.5 },
  { definition: lowPoly.apply(birch), seed: 6, season: 0.6 },
  { definition: lowPoly.apply(douglasFir), seed: 1, season: 0.3 },
  { definition: lowPoly.broadleaf, seed: 8, season: 0.66 },
];

const HEROES: HeroSpec[] = [
  // Stylized: sprouts with blossom in early spring and grows through to high summer.
  {
    definition: stylized.broadleaf,
    seed: 5,
    grow: [0.25, 4.6],
    shrink: [6.55, 7.3],
    season: [{ t: 0, value: 0.0 }, { t: 4.4, value: 0.12 }, { t: 6.6, value: 0.4 }],
  },
  // Realistic: an autumn maple in the rain, losing its leaves, then snow.
  {
    definition: realistic.apply(maple),
    seed: 3,
    grow: [6.85, 9.0],
    shrink: [12.35, 13.1],
    season: [{ t: 6.8, value: 0.56 }, { t: 9.6, value: 0.63 }, { t: 11.4, value: 0.8 }, { t: 13, value: 0.88 }],
  },
  // Low-poly: rapid fire.
  ...RAPID.map((tree, i): HeroSpec => {
    const start = 12.7 + i * 0.72;
    const last = i === RAPID.length - 1;
    return {
      definition: tree.definition,
      seed: tree.seed,
      grow: [start, start + 0.55],
      shrink: last ? [16.55, 17.25] : [start + 0.72, start + 0.98],
      season: [{ t: 0, value: tree.season }, { t: 17.3, value: tree.season + (last ? 0.06 : 0.02) }],
    };
  }),
  // Whimsical: the Style's own candy Corkscrew, in a gusty wind.
  {
    definition: whimsical.broadleaf,
    seed: 2,
    grow: [16.95, 18.7],
    shrink: [20.4, 21.15],
    season: [{ t: 17, value: 0.04 }, { t: 18.6, value: 0.12 }, { t: 21, value: 0.5 }],
  },
  // Enchanted: grows in the dark, glows brighter and brighter, turns magenta.
  {
    definition: enchanted.broadleaf,
    seed: 1,
    grow: [20.8, 23.2],
    shrink: [25.95, 26.65],
    season: [{ t: 20.8, value: 0.35 }, { t: 23.2, value: 0.45 }, { t: 25.8, value: 0.66 }],
    glow: [{ t: 20.8, value: 0.3 }, { t: 23, value: 1.2 }, { t: 25.2, value: 2.4 }],
  },
  // Stylized painterly at dawn, then back to nothing for the loop.
  {
    definition: stylizedPainterly.broadleaf,
    seed: 1,
    grow: [26.35, 28.3],
    shrink: [28.75, 29.5],
    season: [{ t: 26, value: 0.38 }, { t: 30, value: 0.5 }],
  },
];

/** Light and air over the loop (the last key matches the first, so the loop is seamless). */
const ENV = {
  sky: [
    { t: 0, value: '#a9d3ef' }, { t: 6.4, value: '#b9dcf0' }, { t: 7.4, value: '#c8c4b6' }, { t: 10.3, value: '#d6c2a3' },
    { t: 11.6, value: '#cfd8e2' }, { t: 12.6, value: '#dfe7ef' }, { t: 13.2, value: '#a9d8f0' }, { t: 16.5, value: '#b2dcf2' },
    { t: 17.3, value: '#ffd6ea' }, { t: 20.2, value: '#ffe2c9' }, { t: 21.4, value: '#1a1636' }, { t: 22.5, value: '#0b0a1c' },
    { t: 25.9, value: '#0b0a1c' }, { t: 26.8, value: '#f3c3a3' }, { t: 28.2, value: '#f6dcc0' }, { t: 29.3, value: '#a9d3ef' }, { t: 29.9, value: '#a9d3ef' },
  ],
  ground: [
    { t: 0, value: '#7da05a' }, { t: 6.4, value: '#6f9a4a' }, { t: 7.6, value: '#8a7a42' }, { t: 10.3, value: '#9a6a36' },
    { t: 11.8, value: '#e6ecf2' }, { t: 12.7, value: '#e6ecf2' }, { t: 13.4, value: '#86b85a' }, { t: 16.6, value: '#86b85a' },
    { t: 17.4, value: '#a6d67c' }, { t: 20.4, value: '#a6d67c' }, { t: 21.6, value: '#1c2030' }, { t: 25.9, value: '#1c2030' },
    { t: 26.9, value: '#7f9a56' }, { t: 29.3, value: '#7da05a' }, { t: 29.9, value: '#7da05a' },
  ],
  sunColor: [
    { t: 0, value: '#fff4e0' }, { t: 7.2, value: '#ffd9a0' }, { t: 10.5, value: '#ffcf8a' }, { t: 11.8, value: '#e8f0ff' },
    { t: 13.2, value: '#ffffff' }, { t: 17.2, value: '#fff0f6' }, { t: 21.5, value: '#8fa0ff' }, { t: 26.4, value: '#ffb27a' },
    { t: 29.9, value: '#fff4e0' },
  ],
  sun: [
    { t: 0, value: 3.0 }, { t: 7.4, value: 2.2 }, { t: 9.8, value: 3.2 }, { t: 11.8, value: 2.2 }, { t: 13.2, value: 3.2 },
    { t: 20.3, value: 3.0 }, { t: 21.6, value: 0.25 }, { t: 25.9, value: 0.25 }, { t: 27.0, value: 2.6 }, { t: 29.9, value: 3.0 },
  ],
  hemi: [
    { t: 0, value: 1.4 }, { t: 7.4, value: 1.1 }, { t: 11.8, value: 1.6 }, { t: 13.2, value: 1.5 }, { t: 20.3, value: 1.6 },
    { t: 21.6, value: 0.12 }, { t: 25.9, value: 0.12 }, { t: 27.0, value: 1.3 }, { t: 29.9, value: 1.4 },
  ],
  wind: [
    { t: 0, value: 0.15 }, { t: 7.2, value: 0.45 }, { t: 10.3, value: 0.55 }, { t: 12.4, value: 0.2 }, { t: 17.2, value: 0.35 },
    { t: 19.5, value: 0.7 }, { t: 21, value: 0.25 }, { t: 26, value: 0.2 }, { t: 29.9, value: 0.15 },
  ],
  wetness: [{ t: 7.0, value: 0 }, { t: 8.4, value: 0.85 }, { t: 10.2, value: 0.7 }, { t: 11.4, value: 0 }],
  snow: [{ t: 10.6, value: 0 }, { t: 12.2, value: 0.95 }, { t: 12.9, value: 0.95 }, { t: 13.4, value: 0 }],
  /** Enchanted bloom, rising to the climax. */
  bloom: [{ t: 21, value: 0.35 }, { t: 23, value: 0.6 }, { t: 25.4, value: 1.0 }],
} satisfies Record<string, Key<number>[] | Key<string>[]>;

/** Weather particles: how many of each are in the air over time (0..1). */
const PARTICLES = {
  petals: { color: '#f7b6cf', keys: [{ t: 0.8, value: 0 }, { t: 2.5, value: 1 }, { t: 5.2, value: 0.6 }, { t: 6.5, value: 0 }] },
  rain: { color: '#c8d6e6', keys: [{ t: 7.2, value: 0 }, { t: 7.9, value: 1 }, { t: 9.6, value: 1 }, { t: 10.4, value: 0 }] },
  leaves: { color: '#d8762a', keys: [{ t: 9.2, value: 0 }, { t: 10.0, value: 1 }, { t: 11.2, value: 0.8 }, { t: 11.9, value: 0 }] },
  snow: { color: '#ffffff', keys: [{ t: 10.6, value: 0 }, { t: 11.6, value: 1 }, { t: 12.7, value: 1 }, { t: 13.3, value: 0 }] },
  confetti: { color: '#ffffff', keys: [{ t: 18.6, value: 0 }, { t: 19.0, value: 1 }, { t: 20.2, value: 0.6 }, { t: 20.8, value: 0 }] },
  fireflies: { color: '#7ff0e0', keys: [{ t: 21.4, value: 0 }, { t: 22.8, value: 1 }, { t: 25.6, value: 1 }, { t: 26.4, value: 0 }] },
};

/** Wind Bursts (Wind time = video time): the Whimsical tree is blown about. */
const BURSTS = [
  { t: 18.9, x: -3, z: 2, strength: 1.4 },
  { t: 19.7, x: 3, z: -1, strength: 1.4 },
  { t: 20.15, x: 0, z: 3, strength: 1 },
];

/** Turntable speed: steady, faster in the rapid fire and the climax (one turn per loop in total). */
const angleAt = turntable((t) => 1 + 0.5 * Math.exp(-(((t - 15) / 1.6) ** 2)) + 0.9 * Math.exp(-(((t - 23.5) / 2.2) ** 2)) - 0.3 * Math.exp(-(((t - 3) / 2) ** 2)));

// ---------------------------------------------------------------------------------------------
// The stage.

/** Uniform scale that makes a tree HERO_HEIGHT tall (or HERO_WIDTH wide, whichever is smaller). */
function heroScale(tree: Tree): number {
  tree.updateMatrixWorld(true);
  const size = framingBox(tree).getSize(new THREE.Vector3());
  return Math.min(HERO_HEIGHT / size.y, HERO_WIDTH / Math.max(size.x, size.z));
}

/** Height (m) of a Definition fully grown (one throwaway tree). */
function heightOf(definition: TreeDefinition, seed: number): number {
  const tree = createTree(definition, { seed });
  tree.updateMatrixWorld(true);
  const height = framingBox(tree).getSize(new THREE.Vector3()).y;
  tree.dispose();
  return height;
}

interface Ring {
  act: Act;
  forests: { forest: Forest; distance: Map<string | number, number> }[];
}

/** The backdrop ring: from INNER to INNER + SPREAD metres (out of the camera's way, 16.5 m out). */
const INNER = 22;
const SPREAD = 40;

/** A ring of backdrop trees around the hero, out of the camera's way, scaled to 5-10 m. */
function createRing(act: Act, group: THREE.Group, wind: Wind): Ring {
  const random = createRandom(act.ring.seed * 101);
  const forests = act.ring.definitions.map((definition, d) => {
    const base = 7 / heightOf(definition, 1);
    const placements: ForestPlacement[] = [];
    const distance = new Map<string | number, number>();
    for (let i = 0; i < 48; i++) {
      const r = INNER + SPREAD * random.next() ** 0.8;
      const a = random.range(0, Math.PI * 2);
      const id = `${d}-${i}`;
      placements.push({ id, position: [Math.cos(a) * r, 0, Math.sin(a) * r], rotation: random.range(0, Math.PI * 2), scale: base * random.range(0.75, 1.25) });
      distance.set(id, (r - INNER) / SPREAD);
    }
    const forest = createForest(definition, placements, { variants: 4, seed: act.ring.seed * 10 + d, growth: 0, season: act.ring.season, wind });
    forest.traverse((child) => (child.castShadow = false));
    group.add(forest);
    return { forest, distance };
  });
  return { act, forests };
}

/** One kind of weather particle: an instanced mesh whose instances move as a pure function of time. */
interface Particles {
  mesh: THREE.InstancedMesh;
  keys: Key<number>[];
  update(t: number, amount: number): void;
}

function createParticles(kind: keyof typeof PARTICLES, group: THREE.Group, top: number): Particles {
  const spec = PARTICLES[kind];
  const random = createRandom(kind.length * 977 + kind.charCodeAt(0));
  const count = kind === 'rain' ? 900 : kind === 'fireflies' ? 90 : 420;
  let geometry: THREE.BufferGeometry;
  let material: THREE.Material;
  if (kind === 'rain') {
    geometry = new THREE.BoxGeometry(0.012, 0.5, 0.012);
    material = new THREE.MeshBasicNodeMaterial({ color: spec.color, transparent: true, opacity: 0.45, depthWrite: false });
  } else if (kind === 'snow') {
    geometry = new THREE.IcosahedronGeometry(0.045, 0);
    material = new THREE.MeshBasicNodeMaterial({ color: spec.color });
  } else if (kind === 'fireflies') {
    geometry = new THREE.IcosahedronGeometry(0.035, 1);
    // White base: the instance colours (HDR, see below) make them bright enough for the Enchanted bloom.
    material = new THREE.MeshBasicNodeMaterial();
  } else {
    geometry = new THREE.PlaneGeometry(kind === 'confetti' ? 0.12 : 0.1, kind === 'confetti' ? 0.06 : 0.07);
    // Unlit: petals, leaves and confetti read as flecks of colour against the sky from any side.
    material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  }
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const palette = kind === 'confetti' ? ['#ff8fc7', '#7fe0c0', '#ffe066', '#c9a2ff', '#ffab5e'] : kind === 'leaves' ? ['#d8762a', '#b8401f', '#e8a83a'] : kind === 'fireflies' ? ['#59ffe4', '#ff5ce0', '#8aa8ff'] : [spec.color];
  const seeds = Array.from({ length: count }, (_, i) => {
    const c = new THREE.Color(palette[i % palette.length]!);
    if (kind === 'fireflies') c.multiplyScalar(6);
    mesh.setColorAt(i, c);
    return {
      r: kind === 'fireflies' ? random.range(2, 13) : random.range(0.5, 16),
      a: random.range(0, Math.PI * 2),
      y: random.range(0, 1),
      speed: random.range(0.7, 1.3),
      phase: random.range(0, Math.PI * 2),
      spin: new THREE.Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).normalize(),
      threshold: random.next(),
    };
  });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const fall = { petals: 0.9, rain: 16, leaves: 1.3, snow: 1.1, confetti: 1.6, fireflies: 0 }[kind];
  group.add(mesh);
  return {
    mesh,
    keys: spec.keys,
    update(t, amount) {
      mesh.visible = amount > 0.001;
      if (!mesh.visible) return;
      seeds.forEach((s, i) => {
        // Particles fade in and out one by one (by their threshold), and shrink as they go.
        const on = smoothstep(s.threshold, s.threshold + 0.15, amount * 1.15);
        let x = Math.cos(s.a) * s.r;
        let z = Math.sin(s.a) * s.r;
        let y: number;
        if (kind === 'fireflies') {
          y = 0.6 + s.y * 7 + 0.5 * Math.sin(t * 0.9 * s.speed + s.phase);
          x += 0.7 * Math.sin(t * 0.6 * s.speed + s.phase * 2);
          z += 0.7 * Math.cos(t * 0.5 * s.speed + s.phase);
        } else {
          y = top - ((s.y * top + t * fall * s.speed) % top);
          const sway = kind === 'rain' ? 0 : 0.6;
          x += sway * Math.sin(t * 1.3 * s.speed + s.phase);
          z += sway * Math.cos(t * 1.1 * s.speed + s.phase);
        }
        position.set(x, y, z);
        if (kind === 'rain' || kind === 'snow' || kind === 'fireflies') quaternion.identity();
        else quaternion.setFromAxisAngle(s.spin, t * 3 * s.speed + s.phase);
        const pulse = kind === 'fireflies' ? 0.6 + 0.4 * Math.sin(t * 3 * s.speed + s.phase) : 1;
        scale.setScalar(on * pulse + 1e-4);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** The Scene Effects of a Style at time t: the suggestion, with fog fitted to this stage. */
function sceneEffectsAt(style: StyleName, t: number) {
  const suggested = SUGGESTED_SCENE_EFFECTS[style];
  const fog = { ...suggested.fog, near: 26, far: 110 };
  if (style === 'enchanted') {
    const bloom = { ...suggested.bloom!, strength: sample(ENV.bloom, t) };
    return { ...suggested, bloom, fog: { ...fog, far: 85, color: '#3a2266' } };
  }
  // In the open under a clear sky: a lighter mist than suggested, and Neutral instead of AgX (which
  // greys a plain sky), so the loop's first act is as bright as the painterly dawn that leads into it.
  if (style === 'stylized') {
    return { ...suggested, toneMapping: { mapping: 'neutral' as const, exposure: 1.05 }, fog: { ...fog, mist: { ...suggested.fog!.mist!, strength: 0.2 } } };
  }
  if (style === 'whimsical') return { ...suggested, fog: { ...fog, near: 30, far: 130 } };
  return { ...suggested, fog };
}

async function main(): Promise<void> {
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  // Snow and rain on every tree (both at 0 most of the time: then they draw exactly as without).
  setSceneShaderHooks(stackShaderHooks(snowCoverHooks(), wetnessHooks({ darkening: 0.45, sheen: 0.7 })));

  const scene = new THREE.Scene();
  const sky = new THREE.Color();
  scene.background = sky;
  const hemi = new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.4);
  scene.add(hemi);
  // The sun stays with the camera (the world turns under it), from the upper left, a little behind.
  const sun = new THREE.DirectionalLight('#fff4e0', 3);
  sun.position.set(-9, 14, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -4, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // Fixed camera: a little below the crown centre, so the trees tower a bit (a wider view in a
  // square or portrait frame, so the hero still fits: see framing()).
  const frame = framing(innerWidth / innerHeight);
  const camera = new THREE.PerspectiveCamera(frame.fov, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);

  // The world turns; the camera and the sun don't.
  const world = new THREE.Group();
  scene.add(world);

  const groundColor = uniform(new THREE.Color('#7da05a'));
  const groundMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  // A darker patch under the tree, fading out: the ground reads as a little clearing.
  const r = positionLocal.xz.length();
  groundMaterial.colorNode = groundColor.mul(mix(float(0.78), float(1), r.div(9).clamp(0, 1)));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 96).rotateX(-Math.PI / 2), groundMaterial);
  ground.receiveShadow = true;
  world.add(ground);
  // A few rocks around the trunk, so the turning reads even while the tree is small.
  const rockRandom = createRandom(42);
  const rockMaterial = new THREE.MeshStandardNodeMaterial({ color: '#8c8a86', flatShading: true, roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rockRandom.range(0.15, 0.45), 0), rockMaterial);
    const a = rockRandom.range(0, Math.PI * 2);
    const d = rockRandom.range(2.6, 6.5);
    rock.position.set(Math.cos(a) * d, 0.05, Math.sin(a) * d);
    rock.rotation.set(rockRandom.range(0, 3), rockRandom.range(0, 3), 0);
    rock.scale.y = 0.6;
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
  }

  const heroes = HEROES.map((spec) => {
    const tree = createTree(spec.definition, { seed: spec.seed, growth: 0, season: spec.season[0]!.value });
    tree.scale.setScalar(heroScale(tree));
    tree.visible = false;
    world.add(tree);
    return { spec, tree };
  });
  // The backdrop sways with a Wind of its own that has no Wind Bursts (those are for the hero).
  const ringWind = new Wind();
  const rings = ACTS.map((act) => createRing(act, world, ringWind));
  const particles = (Object.keys(PARTICLES) as (keyof typeof PARTICLES)[]).map((kind) => createParticles(kind, world, frame.particleTop));
  await Promise.all([...heroes.map(({ tree }) => tree.ready), ...rings.flatMap((ring) => ring.forests.map(({ forest }) => forest.ready))]);

  const pipeline: ScenePipeline = createScenePipeline(renderer, scene, camera, { style: 'stylized', sun });
  let currentStyle: StyleName | null = null;

  // Wind Bursts are started up front at their own Wind time, so they replay on every loop (a burst
  // only shows from its start time on). The first burst also builds the trees' burst nodes once.
  for (const burst of BURSTS) {
    sceneWind.time = burst.t;
    sceneWind.burst({ x: burst.x, z: burst.z, strength: burst.strength });
  }
  sceneWind.set({ direction: [1, 0, -0.35] });
  ringWind.set({ direction: [1, 0, -0.35] });

  const sunColor = new THREE.Color();
  const groundTint = new THREE.Color();

  /** Sets every uniform, visibility and transform for time t (seconds in the loop). */
  function setUp(time: number): void {
    const t = loopTime(time);
    sceneWind.time = t;
    sceneWind.strength = sample(ENV.wind, t);
    ringWind.time = t;
    ringWind.strength = sceneWind.strength;
    sceneWetness.amount = sample(ENV.wetness, t);
    sceneSnow.amount = sample(ENV.snow, t);

    sky.setRGB(...sampleColor(ENV.sky, t), THREE.SRGBColorSpace);
    groundTint.setRGB(...sampleColor(ENV.ground, t), THREE.SRGBColorSpace);
    groundColor.value.copy(groundTint);
    sun.color.setRGB(...sampleColor(ENV.sunColor, t), THREE.SRGBColorSpace);
    sun.intensity = sample(ENV.sun, t);
    hemi.intensity = sample(ENV.hemi, t);
    hemi.color.copy(sky).lerp(sunColor.set('#ffffff'), 0.5);
    hemi.groundColor.copy(groundTint).multiplyScalar(0.8);

    world.rotation.y = angleAt(t);

    for (const { spec, tree } of heroes) {
      const growth = envelope(t, spec.grow, spec.shrink);
      tree.visible = growth > 0;
      if (!tree.visible) continue;
      tree.growth = growth;
      tree.season = sample(spec.season, t);
      if (spec.glow) tree.innerGlow = { leaf: sample(spec.glow, t), veins: sample(spec.glow, t) * 1.2 };
    }

    for (const ring of rings) {
      for (const { forest, distance } of ring.forests) {
        let any = false;
        for (const tree of forest.trees) {
          const growth = ripple(t, distance.get(tree.placement.id!) ?? 1, { start: ring.act.ring.grow, spread: 1.6, duration: 1.4 }, { start: ring.act.ring.shrink, spread: 0.6, duration: 0.6 });
          tree.growth = growth;
          any ||= growth > 0;
        }
        forest.visible = any;
      }
    }

    for (const p of particles) p.update(t, sample(p.keys, t));

    // The Style's Scene Pipeline (the same parts on within an act: only uniforms change).
    let act = ACTS[0]!;
    for (const candidate of ACTS) if (t >= candidate.from) act = candidate;
    if (act.style !== currentStyle || act.style === 'enchanted') {
      pipeline.set({ treeEffects: SUGGESTED_TREE_EFFECTS[act.style], sceneEffects: sceneEffectsAt(act.style, t) });
      currentStyle = act.style;
    }
  }

  // Compile everything once (every act's pipeline and materials) before the first real frame.
  for (const time of [0.3, 3, 8.5, 12, 13.2, 18.5, 23, 27.5]) {
    setUp(time);
    pipeline.render();
    await new Promise(requestAnimationFrame);
  }

  window.promo = {
    status: 'ready',
    frames: FRAMES,
    fps: FPS,
    async show(frame) {
      setUp(frame / FPS);
      pipeline.render();
      await new Promise(requestAnimationFrame);
    },
  };

  if (params.has('t')) {
    setUp(Number(params.get('t')));
    pipeline.render();
  } else if (params.get('live') === '1') {
    const start = performance.now();
    renderer.setAnimationLoop(() => {
      setUp(((performance.now() - start) / 1000) % DURATION);
      pipeline.render();
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.promo = { status: 'error', error: message };
  console.error(error);
});
