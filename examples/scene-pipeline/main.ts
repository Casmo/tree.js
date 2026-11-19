// Scene Pipeline example: one tree of a Style in front of a small Forest, a ground plane, a rock, a
// plain sky colour and a shadow-casting sun, rendered through the opt-in Scene Pipeline
// (`@casmo/tree.js/scene`): the Style's suggested Tree Effects and Scene Effects in one pipeline.
// The trees use the Style's SUGGESTED_MATERIAL_FEATURES.
// Query parameters (used by the Playwright tests):
//   ?style=low-poly|stylized|realistic  the trees' Style (default stylized)
//   ?scene=style  createScenePipeline with { style } (default): the Style's whole suggestion
//   ?scene=none  createScenePipeline without a style or overrides (must equal ?scene=plain)
//   ?scene=plain  no pipeline at all: renderer.render(scene, camera)
//   ?scene=tone-mapping  one Scene Effect alone, through its stand-alone builder (sceneToneMapping)
//                        in a hand-made RenderPipeline, with the Style's suggested settings
//   ?scene=velocity  the Wind-aware velocity channel, shown as colours (red = |x|, green = |y|, NDC
//                    per frame x 200): windVelocityMRT on a hand-made scene pass, or with
//                    ?via=scene-pipeline the channel of createScenePipeline(..., { velocity: true })
//                    (scenePass.velocity); `scenePipelineExample.regions` has the front tree's crown and
//                    a strip of ground to check it in
//   ?scene=motion-blur  motion blur alone (sceneMotionBlur on windVelocityMRT's channel of a hand-made
//                       scene pass), or with ?via=scene-pipeline createScenePipeline with only
//                       { motionBlur: {} } (which requests the velocity channel itself); use a pinned
//                       Wind and/or ?cameraStep for motion
//   ?cameraStep=<m>  the camera slides sideways by <m> metres every frame, ending at the usual view, so
//                    the last frame has one step of camera motion (pinned, for motion blur screenshots)
//   ?velocity=1  with ?scene=none|style: the Scene Pipeline's velocity option (the frame must not change)
//   ?scene=godrays  god rays alone (sceneGodrays on the shadow-casting sun), with the realistic
//                   suggestion's settings (with ?sun=back for visible shafts)
//   ?sun=back  a low sun behind the Forest, shining towards the camera
//   ?scene=gtao  ambient occlusion alone (sceneAO: pre-pass + GTAO + the scene pass's lighting context)
//   ?scene=bloom  bloom alone (sceneBloom), likewise: the Style's suggested bloom or sceneBloom's
//                 defaults (low-poly suggests none), with the renderer's normal output transform
//   ?scene=smaa|fxaa  anti-aliasing alone (sceneAntialias) on the renderer's output transform
//                     (renderOutput), in a hand-made RenderPipeline
//   ?scene=traa  TRAA alone (sceneAntialias(color, 'traa', { depth, velocity, camera })) on a hand-made
//                scene pass with windVelocityMRT, before the renderer's output transform
//   ?frames=<n>  render n frames before reporting `rendered` (default 4), or with ?antialias after each
//                switch (default 3), e.g. for TRAA to settle
//   ?antialias=fxaa,smaa  with ?scene=style: after the first frames, set() the suggestion with each
//                         anti-aliasing mode in turn (smaa|fxaa|none), rendering in between
//   ?scene=fog  fog alone: sceneFog with the Style's suggested settings as the app's scene.fogNode
//   ?appFog=1  the app sets its own scene.fogNode first; ?dispose=1  dispose() the pipeline after
//              rendering: `scenePipelineExample.fog` says whether scene.fogNode was the app's while
//              the pipeline rendered and after dispose() (the pipeline restores the app's value)
//   ?treeEffects=style  with ?scene=none: the Style's suggested Tree Effects only (no Scene Effects)
//   ?via=tree-effects  render ?scene=none&treeEffects=... through createTreeEffects instead (the
//                      Scene Pipeline must give the same image, the same pick and the same highlight)
//   ?selection=tree  outline only the front tree (the `selection` option)
//   ?pick=tree|f0|f1  the Tree ID channel on (`treeId: true`): after rendering, pick() at that tree's
//                     trunk; the result is in `scenePipelineExample.picked`
//   ?highlight=1  with ?pick: the Highlight added to the Tree Effects, marking the picked tree (`highlighted`)
//   ?backend=webgl  force WebGPURenderer's WebGL2 fallback
//   ?wind=<strength>&windTime=<s>  scene-wide Wind; windTime pins its clock (default: no Wind)
import * as THREE from 'three/webgpu';
import { abs, color, fog, mrt, output, pass, rangeFogFactor, renderOutput, vec4 } from 'three/tsl';
import {
  createForest,
  createTree,
  loadStyle,
  sceneWind,
  SUGGESTED_MATERIAL_FEATURES,
  withMaterialFeatures,
  type ForestTree,
  type StyleName,
  type Tree,
} from '@casmo/tree.js';
import { createTreeEffects, SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from '@casmo/tree.js/effects';
import {
  createScenePipeline,
  sceneAO,
  sceneAntialias,
  sceneBloom,
  sceneFog,
  sceneGodrays,
  sceneMotionBlur,
  sceneToneMapping,
  SUGGESTED_SCENE_EFFECTS,
  WIND_VELOCITY,
  windVelocityMRT,
  type SceneAntialiasMode,
  type ScenePipelineOptions,
} from '@casmo/tree.js/scene';
import { framingBox } from '../framing';

/** The renderer settings the pipeline must never change. */
interface RendererState {
  toneMapping: number;
  outputColorSpace: string;
  shadowMap: { enabled: boolean; type: number };
}

declare global {
  interface Window {
    scenePipelineExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** The renderer's settings before the pipeline was created and after it rendered. */
      renderer?: { before: RendererState; after: RendererState };
      /** `?pick=<name>`: the point picked (CSS pixels) and the name of the tree pick() resolved to. */
      picked?: { name: string | null; x: number; y: number };
      /** `?scene=velocity|motion-blur`: where to check the velocity (CSS pixels): the front tree's crown, a strip of ground. */
      regions?: Record<'crown' | 'ground', { x0: number; y0: number; x1: number; y1: number }>;
      /** `?antialias=<modes>`: the anti-aliasing modes set() switched through at runtime. */
      antialias?: string[];
      /** Whether `scene.fogNode` was the app's own value while the pipeline rendered, and after `?dispose=1`. */
      fog?: { during: boolean; after?: boolean };
    };
  }
}

window.scenePipelineExample = { status: 'loading' };
const params = new URLSearchParams(location.search);
const styleName = (params.get('style') ?? 'stylized') as StyleName;
const sceneParam = params.get('scene') ?? 'style';
const statusEl = document.getElementById('status')!;
sceneWind.set({ direction: [1, 0, -0.4], strength: Number(params.get('wind') ?? 0) });
const windTime = params.get('windTime');
if (windTime !== null) sceneWind.time = Number(windTime);

async function main(): Promise<void> {
  const style = await loadStyle(styleName);
  const definition = withMaterialFeatures(style.broadleaf, SUGGESTED_MATERIAL_FEATURES[styleName]);
  const tree = createTree(definition, { seed: 1, season: 0.37 });
  await tree.ready;

  // The front tree, framed from the side; the Forest stands behind it.
  const box = framingBox(tree);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(1, 0.3, 1).normalize();
  const back = new THREE.Vector3(-direction.x, 0, -direction.z).normalize();
  const side = new THREE.Vector3(back.z, 0, -back.x);
  const width = Math.max(size.x, size.z);
  const spots = [-1.6, -0.5, 0.6, 1.7].map((k, i) =>
    centre.clone().addScaledVector(back, width * (1.3 + (i % 2) * 0.7)).addScaledVector(side, width * k),
  );
  const forest = createForest(definition, spots.map((p, i) => ({ id: `f${i}`, position: [p.x, 0, p.z], rotation: i * 1.3 })), {
    variants: 2,
    seed: 1,
    season: 0.37,
  });
  await forest.ready;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b9d2e6');
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.8));
  // The app's own shadow-casting sun: the pipeline never changes lights or shadows.
  const sun = new THREE.DirectionalLight('#fff4e0', 3.5);
  sun.position.copy(centre).add(new THREE.Vector3(6, 10, 2).multiplyScalar(width / 3));
  // ?sun=back: a low sun behind the Forest, shining towards the camera (light shafts for god rays).
  if (params.get('sun') === 'back') sun.position.copy(centre).addScaledVector(back, width * 4).addScaledVector(side, width).setY(width * 2.2);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const reach = width * 3;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: reach * 6 });
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  ground.receiveShadow = true;
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size.y / 7, 1), new THREE.MeshStandardNodeMaterial({ color: '#8a8f99', flatShading: true }));
  rock.position.copy(centre).addScaledVector(direction, width * 0.25).addScaledVector(side, -width * 0.55).setY(size.y / 20);
  rock.castShadow = rock.receiveShadow = true;
  for (const object of [tree, forest]) object.traverse((o) => (o.castShadow = o.receiveShadow = true));
  scene.add(ground, rock, tree, forest);
  // ?appFog=1: the app's own fog node (a thin warm haze), which the pipeline must give back.
  if (params.get('appFog') === '1') scene.fogNode = fog(color('#e0c8a0'), rangeFogFactor(40, 200).mul(0.3));
  const appFogNode = scene.fogNode;

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
  const distance = (size.y / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.5;
  const view = centre.clone().addScaledVector(direction, distance);
  const target = centre.clone().addScaledVector(back, width * 0.4);
  camera.position.copy(view);
  camera.lookAt(target);
  // ?cameraStep=<m>: the camera's sideways offset at the frame `stepsLeft` frames before the last one.
  const cameraStep = Number(params.get('cameraStep') ?? 0);
  const slideCamera = (stepsLeft: number) => {
    const offset = side.clone().multiplyScalar(-cameraStep * stepsLeft);
    camera.position.copy(view).add(offset);
    camera.lookAt(target.clone().add(offset));
  };

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; // the app's choice; the pipeline only reads it
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  statusEl.textContent = `Scene Pipeline (${backend}) - ${styleName} - ${sceneParam}`;
  const rendererState = (): RendererState => ({
    toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace,
    shadowMap: { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type },
  });
  const before = rendererState();

  // Trees by name, each with a point on its trunk to pick at.
  const trunk = (at: THREE.Vector3) => new THREE.Vector3(at.x, size.y * 0.12, at.z);
  const named = new Map<string, { tree: object; at: THREE.Vector3 }>([['tree', { tree, at: trunk(new THREE.Vector3()) }]]);
  for (const [i, at] of spots.entries()) named.set(`f${i}`, { tree: forest.get(`f${i}`)!, at: trunk(at) });
  const onScreen = (at: THREE.Vector3) => {
    const ndc = at.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * renderer.domElement.clientWidth, y: ((1 - ndc.y) / 2) * renderer.domElement.clientHeight };
  };
  const nameOf = (found: object | undefined) => (found === undefined ? null : ([...named].find(([, v]) => v.tree === found)?.[0] ?? 'other'));

  /** The front tree's crown (its leaves' bounds on screen) and a strip of ground at the bottom. */
  const regions = () => {
    const leaves = tree.leaves.geometry.boundingBox ?? (tree.leaves.geometry.computeBoundingBox(), tree.leaves.geometry.boundingBox!);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      onScreen(new THREE.Vector3(i & 1 ? leaves.max.x : leaves.min.x, i & 2 ? leaves.max.y : leaves.min.y, i & 4 ? leaves.max.z : leaves.min.z)),
    );
    const { clientWidth: w, clientHeight: h } = renderer.domElement;
    return {
      crown: { x0: Math.min(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), x1: Math.max(...corners.map((c) => c.x)), y1: Math.max(...corners.map((c) => c.y)) },
      ground: { x0: 0, y0: h * 0.93, x1: w * 0.6, y1: h }, // left of the rock
    };
  };

  const pickName = params.get('pick');
  const highlight = pickName !== null && params.get('highlight') === '1';
  const selection = params.get('selection') === 'tree' ? [tree] : undefined;

  let render: () => void;
  let pick: ((x: number, y: number) => Promise<Tree | ForestTree | undefined>) | undefined;
  let highlighted: (Tree | ForestTree)[] | undefined;
  let switchAntialias: ((mode: SceneAntialiasMode | null) => void) | undefined;
  let dispose: (() => void) | undefined;
  if (sceneParam === 'plain') {
    render = () => renderer.render(scene, camera);
  } else if (sceneParam === 'tone-mapping') {
    // One Scene Effect alone, in a hand-made pipeline: the stand-alone builder on a plain scene pass.
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputNode = sceneToneMapping(pass(scene, camera).getTextureNode(), SUGGESTED_SCENE_EFFECTS[styleName].toneMapping);
    pipeline.outputColorTransform = false; // the builder outputs display colours
    render = () => pipeline.render();
  } else if (sceneParam === 'velocity') {
    // The velocity channel made visible: |x| in red, |y| in green (NDC per frame, scaled up).
    let velocity: THREE.TextureNode;
    if (params.get('via') === 'scene-pipeline') {
      velocity = createScenePipeline(renderer, scene, camera, { velocity: true }).scenePass.velocity!;
    } else {
      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output }).merge(windVelocityMRT()));
      velocity = scenePass.getTextureNode(WIND_VELOCITY);
    }
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputNode = vec4(abs(velocity.xy).mul(200), 0, 1);
    pipeline.outputColorTransform = false;
    render = () => pipeline.render();
  } else if (sceneParam === 'motion-blur') {
    if (params.get('via') === 'scene-pipeline') {
      const pipeline = createScenePipeline(renderer, scene, camera, { sceneEffects: { motionBlur: {} } });
      render = () => pipeline.render();
    } else {
      // Motion blur alone: the scene pass with the Wind-aware velocity channel, blurred along it.
      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output }).merge(windVelocityMRT()));
      const pipeline = new THREE.RenderPipeline(renderer);
      pipeline.outputNode = sceneMotionBlur(scenePass.getTextureNode(), scenePass.getTextureNode(WIND_VELOCITY));
      render = () => pipeline.render();
    }
  } else if (sceneParam === 'godrays') {
    // God rays alone: the app's own shadow-casting sun, the scene pass's colour and depth.
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    pipeline.outputNode = sceneGodrays(scenePass.getTextureNode(), scenePass.getTextureNode('depth'), camera, sun, SUGGESTED_SCENE_EFFECTS.realistic.godrays);
    render = () => pipeline.render();
  } else if (sceneParam === 'gtao') {
    // AO alone: the pre-pass and GTAO feed the scene pass's lighting (only ambient light darkens).
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.contextNode = sceneAO(scene, camera, SUGGESTED_SCENE_EFFECTS[styleName].ao).context;
    pipeline.outputNode = scenePass;
    render = () => pipeline.render();
  } else if (sceneParam === 'smaa' || sceneParam === 'fxaa') {
    // Anti-aliasing alone: it runs on display colours, so on the renderer's own output transform.
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputNode = sceneAntialias(renderOutput(pass(scene, camera).getTextureNode()), sceneParam);
    pipeline.outputColorTransform = false; // renderOutput above already did it
    render = () => pipeline.render();
  } else if (sceneParam === 'traa') {
    // TRAA alone: linear colours (before the output transform), the scene pass's depth and velocity.
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output }).merge(windVelocityMRT()));
    const input = { depth: scenePass.getTextureNode('depth'), velocity: scenePass.getTextureNode(WIND_VELOCITY), camera };
    pipeline.outputNode = sceneAntialias(scenePass.getTextureNode(), 'traa', input);
    render = () => pipeline.render();
  } else if (sceneParam === 'bloom') {
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputNode = sceneBloom(pass(scene, camera).getTextureNode(), SUGGESTED_SCENE_EFFECTS[styleName].bloom);
    render = () => pipeline.render();
  } else if (sceneParam === 'fog') {
    // Fog alone: the stand-alone builder as the app's own scene.fogNode, rendered as usual.
    scene.fogNode = sceneFog(SUGGESTED_SCENE_EFFECTS[styleName].fog, scene.background);
    render = () => renderer.render(scene, camera);
  } else if (sceneParam === 'none' || sceneParam === 'style') {
    // The Style's suggested Tree Effects (with the Highlight for ?highlight=1), or none.
    const suggested = params.get('treeEffects') === 'style' || (sceneParam === 'style' && highlight);
    const treeEffects: TreeEffectsSettings | null = suggested ? { ...SUGGESTED_TREE_EFFECTS[styleName], ...(highlight && { highlight: {} }) } : null;
    const common = { selection, treeId: pickName !== null };
    if (params.get('via') === 'tree-effects') {
      const effects = createTreeEffects(renderer, scene, camera, { ...common, effects: treeEffects });
      render = () => effects.render();
      pick = (x, y) => effects.pick(x, y);
      highlighted = effects.highlighted;
    } else {
      const options: ScenePipelineOptions = { ...common, sun, velocity: params.get('velocity') === '1' };
      if (sceneParam === 'style') options.style = styleName;
      if (treeEffects) options.treeEffects = treeEffects;
      const pipeline = createScenePipeline(renderer, scene, camera, options);
      render = () => pipeline.render();
      pick = (x, y) => pipeline.pick(x, y);
      highlighted = pipeline.highlighted;
      switchAntialias = (antialias) => pipeline.set({ style: styleName, sceneEffects: { ...SUGGESTED_SCENE_EFFECTS[styleName], antialias } });
      dispose = () => pipeline.dispose();
    }
  } else {
    throw new Error(`Unknown scene "${sceneParam}"`);
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Render a few frames so pipelines that build on first use show the settled image.
  const frames = params.get('frames');
  const antialias = params.get('antialias')?.split(',');
  const first = Number((antialias ? null : frames) ?? 4);
  for (let i = 0; i < first; i++) {
    if (cameraStep) slideCamera(first - 1 - i);
    render();
    await new Promise(requestAnimationFrame);
  }
  if (antialias && switchAntialias) {
    for (const mode of antialias) {
      switchAntialias(mode === 'none' ? null : (mode as SceneAntialiasMode));
      for (let i = 0; i < Number(frames ?? 3); i++) {
        render();
        await new Promise(requestAnimationFrame);
      }
    }
  }
  let picked: typeof window.scenePipelineExample.picked;
  if (pickName !== null && pick) {
    const target = named.get(pickName);
    if (!target) throw new Error(`Unknown tree to pick "${pickName}"`);
    const { x, y } = onScreen(target.at);
    const found = await pick(x, y);
    picked = { name: nameOf(found), x, y };
    if (highlight && found && highlighted) {
      highlighted.push(found);
      for (let i = 0; i < 2; i++) {
        render();
        await new Promise(requestAnimationFrame);
      }
    }
  }
  const fogState: NonNullable<typeof window.scenePipelineExample.fog> = { during: scene.fogNode === appFogNode };
  if (params.get('dispose') === '1' && dispose) {
    dispose();
    fogState.after = scene.fogNode === appFogNode;
  }
  window.scenePipelineExample = { status: 'rendered', backend, picked, antialias, fog: fogState, renderer: { before, after: rendererState() } };
  if (sceneParam === 'velocity' || sceneParam === 'motion-blur') window.scenePipelineExample.regions = regions();
  if (sceneWind.strength > 0 && windTime === null) renderer.setAnimationLoop(render);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  statusEl.textContent = message;
  window.scenePipelineExample = { status: 'error', error: message };
  console.error(error);
});
