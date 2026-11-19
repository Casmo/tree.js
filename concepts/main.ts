/* eslint-disable */
// @ts-nocheck
// TEMPORARY concept renders for the "shaders & post-processing" exploration (PR only, not for main).
// Every concept is a quick hack to get a picture, not a proposed implementation.
//   /concepts/?c=<concept>&v=<variant index>
// The page sets window.concept = { status, variants } once drawn; concepts/capture.mjs screenshots it.
import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, convertToTexture, diffuseColor, directionToColor, dot, float, fog, Fn, fract, hash, max,
  mix, mrt, normalLocal, normalView, output, pass, positionGeometry, positionWorld, rangeFogFactor, renderOutput,
  screenCoordinate, screenSize, screenUV, smoothstep, texture3D, transformNormalToView, uniform, attribute, vec2, vec3, vec4,
  builtinAOContext, perspectiveDepthToViewZ, cameraNear, cameraFar, positionViewDirection, luminance, select, step, emissive, hue, colorToDirection,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { sss } from 'three/addons/tsl/display/SSSNode.js';
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js';
import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js';
import { createForest, createRandom, createTree } from '@casmo/tree.js';
import { createTreeEffects, treeColorGrade, treeEffectsPass, treeMaskMRT, treeOutline } from '@casmo/tree.js/effects';
import lowPoly from '@casmo/tree.js/styles/low-poly';
import stylized from '@casmo/tree.js/styles/stylized';
import realistic from '@casmo/tree.js/styles/realistic';
import { framingBox } from '../examples/framing';

const params = new URLSearchParams(location.search);
const labelEl = document.getElementById('label')!;
window.concept = { status: 'loading' };

// ---------------------------------------------------------------- stage

function makeStage({ sky = '#cfe3f0', sunIntensity = 2.5, sunPos = [5, 8, 3], antialias = false, shadows = false } = {}) {
  const renderer = new THREE.WebGPURenderer({ antialias });
  renderer.setPixelRatio(1);
  const scale = Number(params.get('scale') ?? 1);
  renderer.setSize(Math.round(innerWidth / scale), Math.round(innerHeight / scale), false);
  renderer.shadowMap.enabled = shadows;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  const hemi = new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.4);
  const sun = new THREE.DirectionalLight('#fff4e0', sunIntensity);
  sun.position.set(...sunPos);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -12; c.right = c.top = 12; c.near = 0.5; c.far = 60;
    sun.shadow.bias = -0.0005;
  }
  scene.add(hemi, sun, sun.target);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400);
  return { renderer, scene, camera, sun, hemi };
}

function ground(scene, radius = 40, shadows = false) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }));
  mesh.receiveShadow = shadows;
  scene.add(mesh);
  return mesh;
}

const DIR = new THREE.Vector3(1, 0.35, 1).normalize();
function frame(camera, box, margin = 1.15, direction = DIR) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const vertical = size.y / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const horizontal = Math.max(size.x, size.z) / 2 / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect;
  camera.position.copy(centre).addScaledVector(direction, Math.max(vertical, horizontal) * margin);
  camera.lookAt(centre);
}

async function tree(definition, options = {}, shadows = false) {
  const t = createTree(definition, { seed: 1, season: 0.37, ...options });
  await t.ready;
  t.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  return t;
}

function grid(count, spacing, seed) {
  const side = Math.ceil(Math.sqrt(count));
  const random = createRandom(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = ((i % side) - (side - 1) / 2) * spacing + random.range(-1, 1) * spacing * 0.3;
    const z = (Math.floor(i / side) - (side - 1) / 2) * spacing + random.range(-1, 1) * spacing * 0.3;
    out.push({ id: i, position: [x, 0, z], rotation: random.range(0, Math.PI * 2), scale: random.range(0.85, 1.15) });
  }
  return out;
}

/** Bounding ellipsoid of the leaves (tree-local). */
function crown(t) {
  const box = new THREE.Box3().setFromBufferAttribute(t.leaves.geometry.attributes.position);
  return { centre: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
}

/** Points in the crown, 0 at the crown centre .. ~1 at its surface (ellipsoid space). */
function crownDistance(t) {
  const { centre, half } = crown(t);
  return positionGeometry.sub(vec3(centre)).div(vec3(half)).length();
}

// ---------------------------------------------------------------- per-tree material hacks

/** Crown ("spherical") normals: leaf normals bent towards the ellipsoid normal around the crown. */
function applyCrownNormals(t, amount = 0.85) {
  const { centre, half } = crown(t);
  const h2 = vec3(half.x * half.x, half.y * half.y, half.z * half.z);
  const ellipsoidNormal = positionGeometry.sub(vec3(centre)).div(h2).normalize();
  const bent = mix(normalLocal, ellipsoidNormal, amount).normalize();
  t.leaves.material.normalNode = transformNormalToView(bent);
  t.leaves.material.needsUpdate = true;
}

/** Back-lit leaf translucency: leaf colour glows when looking towards the sun, more at the crown rim. */
function applyTranslucency(t, sun, strength = 1.6) {
  const toSun = uniform(sun.position.clone().sub(sun.target.position).normalize());
  const view = positionWorld.sub(cameraPosition).normalize();
  const forward = max(dot(view, toSun), 0).pow(5); // looking into the sun through the leaf
  const rim = smoothstep(0.35, 1.0, crownDistance(t)); // thin edge of the crown lets more light through
  const sunColor = vec3(sun.color.r, sun.color.g, sun.color.b).mul(sun.intensity);
  const m = t.leaves.material;
  m.emissiveNode = diffuseColor.rgb.mul(sunColor).mul(forward.mul(mix(0.25, 1, rim))).mul(strength);
  m.needsUpdate = true;
}

/** Structural AO: darker in the depth of the crown and on the trunk below it, from tree data only. */
function applyCrownAO(t, strength = 0.8) {
  const d = crownDistance(t);
  const leafAO = mix(float(1 - strength), float(1), smoothstep(0.1, 1.0, d));
  const lm = t.leaves.material;
  lm.colorNode = vec4(lm.colorNode).mul(vec4(vec3(leafAO), 1));
  // bark: darker inside the crown, and a soft darkening of the lower trunk by the crown above
  const { centre, half } = crown(t);
  const inside = smoothstep(0.2, 1.0, positionGeometry.sub(vec3(centre)).div(vec3(half)).length());
  const under = smoothstep(0, centre.y - half.y, positionGeometry.y).mul(0.4).add(0.6);
  const bm = t.wood.material;
  bm.colorNode = vec4(bm.colorNode).mul(vec4(vec3(mix(float(1 - strength), float(1), inside).mul(under)), 1));
  lm.needsUpdate = bm.needsUpdate = true;
}

/** Rim light (stylized): fresnel highlight on the crown silhouette. */
function applyRim(t, rimColor = '#fff2c4', strength = 0.9) {
  const nv = abs(dot(normalView, positionViewDirection));
  const rim = smoothstep(0.55, 0.0, nv).mul(strength);
  for (const m of [t.leaves.material]) {
    m.emissiveNode = color(rimColor).mul(rim).mul(diffuseColor.rgb.add(0.25));
    m.needsUpdate = true;
  }
}

/** Dithered LOD cross-fade: the mesh dissolves in a screen-space dither pattern (no transparency sorting). */
function applyDitherFade(t, visible) {
  // interleaved gradient noise
  const ign = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
  for (const m of [t.leaves.material, t.wood.material]) {
    m.opacityNode = step(ign, float(visible));
    m.alphaTest = 0.5;
    m.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- tree id mask (all-trees effects)

/** MRT output: per-object id of the tree being drawn (0 = not a tree), as a float. */
function treeIdNode(trees) {
  return uniform(0).onObjectUpdate((frameData) => {
    for (let o = frameData.object; o; o = o.parent) {
      const i = trees.indexOf(o);
      if (i >= 0) return i + 1;
    }
    return 0;
  });
}

/** 1 where the id differs from a neighbour `px` pixels away (tree vs tree or tree vs background). */
function idEdges(idTex, px = 2) {
  const step = vec2(px, px).div(screenSize);
  const c = idTex.sample(screenUV).r;
  const diff = (o) => select(abs(idTex.sample(screenUV.add(o)).r.sub(c)).greaterThan(0.5), float(1), float(0));
  return max(max(diff(vec2(step.x, 0)), diff(vec2(step.x.negate(), 0))), max(diff(vec2(0, step.y)), diff(vec2(0, step.y.negate()))));
}

// ---------------------------------------------------------------- concepts

const SOFT = { sky: '#cfe3f0' };

const CONCEPTS = {
  // ========== PER TREE (material) ==========
  'crown-normals': {
    variants: ['Stylized · per-card normals (today)', 'Stylized · crown normals', 'Realistic · per-card normals (today)', 'Realistic · crown normals'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(v < 2 ? stylized.broadleaf : realistic.broadleaf);
      if (v % 2) applyCrownNormals(t, v < 2 ? 0.85 : 0.6);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      return s;
    },
  },
  translucency: {
    variants: ['Back-lit · today', 'Back-lit · leaf translucency'],
    async setup(v) {
      const s = makeStage({ sunPos: [-6, 3.5, -6], sunIntensity: 3, sky: '#f3e6cc' });
      const t = await tree(realistic.broadleaf);
      if (v) applyTranslucency(t, s.sun);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.3);
      return s;
    },
  },
  'structural-ao': {
    variants: ['Today', 'Structural AO (from crown shape)'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(stylized.broadleaf);
      if (v) applyCrownAO(t);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      return s;
    },
  },
  rim: {
    variants: ['Crown normals', 'Crown normals + rim light'],
    async setup(v) {
      const s = makeStage({ sky: '#bcd3e6' });
      const t = await tree(stylized.broadleaf);
      applyCrownNormals(t);
      if (v) applyRim(t);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      return s;
    },
  },
  'hue-variation': {
    variants: ['Forest · 4 Variants (today)', 'Forest · + per-instance hue/brightness'],
    async setup(v) {
      const s = makeStage();
      const forest = createForest(stylized.broadleaf, grid(42, 4.2, 7), { variants: 4, seed: 1, season: 0.37 });
      if (v) {
        for (const variant of forest.variants ?? []) {
          // per-instance random from the instance's Wind phase (iState.w), already unique per tree
          const r = hash(attribute('iState', 'vec4').w.mul(97.31));
          const r2 = hash(attribute('iState', 'vec4').w.mul(13.7).add(5.1));
          const m = variant.leafMaterial;
          const shifted = hue(m.colorNode, r.sub(0.5).mul(0.3)).mul(r2.mul(0.35).add(0.8));
          m.colorNode = shifted;
          m.needsUpdate = true;
        }
      }
      s.scene.add(forest); ground(s.scene, 80);
      s.camera.position.set(0, 13, 30);
      s.camera.lookAt(0, 1, 0);
      return s;
    },
  },
  'alpha-to-coverage': {
    variants: ['Leaf cards · alphaTest (today)', 'Leaf cards · alpha-to-coverage (MSAA)'],
    async setup(v) {
      const s = makeStage({ antialias: true });
      const t = await tree(realistic.broadleaf);
      if (v) { t.leaves.material.alphaToCoverage = true; t.leaves.material.needsUpdate = true; }
      s.scene.add(t); ground(s.scene);
      const { centre, half } = crown(t);
      s.camera.fov = 9; s.camera.updateProjectionMatrix();
      s.camera.position.set(centre.x + half.x * 6, centre.y + half.y * 1.2, centre.z + half.z * 6);
      s.camera.lookAt(centre.x + half.x * 0.6, centre.y + half.y * 0.6, centre.z + half.z * 0.6);
      return s;
    },
  },
  lod: {
    variants: ['LOD0 · full mesh', 'LOD0→LOD1 · dithered cross-fade (50%)', 'LOD2 · impostor card (1 quad)'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(lowPoly.broadleaf);
      ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      if (v === 0) s.scene.add(t);
      if (v === 1) { applyDitherFade(t, 0.5); s.scene.add(t); }
      if (v === 2) {
        // bake the tree from this view into a texture (a real impostor would use an octahedral atlas of views)
        const rtScene = new THREE.Scene();
        rtScene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.4));
        const sun2 = s.sun.clone(); rtScene.add(sun2, sun2.target);
        rtScene.add(t);
        const rt = new THREE.RenderTarget(512, 512, { samples: 4 });
        const box = framingBox(t);
        const size = box.getSize(new THREE.Vector3()); const centre = box.getCenter(new THREE.Vector3());
        const r = Math.max(size.x, size.y, size.z) * 0.6;
        const ortho = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 200);
        ortho.position.copy(s.camera.position); ortho.lookAt(centre);
        await s.renderer.init();
        s.renderer.setClearColor(0x000000, 0);
        s.renderer.setRenderTarget(rt);
        await s.renderer.renderAsync(rtScene, ortho);
        s.renderer.setRenderTarget(null);
        s.renderer.setClearColor(0x000000, 1);
        const card = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), new THREE.MeshBasicNodeMaterial({ map: rt.texture, alphaTest: 0.5, transparent: false }));
        card.position.copy(centre); card.quaternion.copy(ortho.quaternion);
        card.scale.y = -1; card.material.side = THREE.DoubleSide;
        s.scene.add(card);
      }
      return s;
    },
  },

  // ========== ALL TREES (tree mask / post) ==========
  'id-outline': {
    variants: ['Outline from tree mask (today)', 'Outline from per-tree ID'],
    async setup(v) {
      const s = makeStage();
      const trees = [];
      for (const [i, x, z] of [[1, -2.2, -1.5], [2, 0.6, 1.2], [3, 2.8, -0.6]]) {
        const t = await tree(lowPoly.broadleaf, { seed: i });
        t.position.set(x, 0, z); trees.push(t); s.scene.add(t);
      }
      ground(s.scene);
      const box = new THREE.Box3(); trees.forEach((t) => { t.updateMatrixWorld(true); box.union(framingBox(t)); });
      frame(s.camera, box, 1.1, new THREE.Vector3(0.3, 0.3, 1).normalize());
      const line = color('#18230f');
      if (v === 0) {
        const fx = createTreeEffects(s.renderer, s.scene, s.camera, { effects: { outline: { color: '#18230f', thickness: 2, strength: 1 } } });
        return { ...s, render: () => fx.render() };
      }
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      p.setMRT(mrt({ output, treeId: treeIdNode(trees) }));
      const edges = idEdges(p.getTextureNode('treeId'), 1.5);
      const isTree = p.getTextureNode('treeId').sample(screenUV).r.greaterThan(0.5);
      pipeline.outputNode = vec4(mix(p.getTextureNode().rgb, line, edges.mul(select(isTree, float(1), float(0)))), 1);
      return { ...s, render: () => pipeline.render() };
    },
  },
  'inner-lines': {
    variants: ['Silhouette outline (today)', '+ inner lines from depth & normal edges'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(lowPoly.broadleaf);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.2);
      const fx = treeEffectsPass(s.scene, s.camera);
      if (v) { fx.pass.setMRT(mrt({ output, normal: directionToColor(normalView) }).merge(treeMaskMRT())); fx.pass.getTexture('treeMask').type = THREE.UnsignedByteType; }
      let out = treeOutline({ color: fx.color, mask: fx.mask }, { color: '#18230f', thickness: 2, strength: 1 });
      if (v) {
        const nTex = fx.pass.getTextureNode('normal');
        const dTex = fx.pass.getTextureNode('depth');
        const vz = (uvn) => perspectiveDepthToViewZ(dTex.sample(uvn).r, cameraNear, cameraFar);
        const px = vec2(1.5, 1.5).div(screenSize);
        const n0 = colorToDirection(nTex.sample(screenUV).rgb);
        const d0 = vz(screenUV);
        let edge = float(0);
        for (const o of [vec2(px.x, 0), vec2(0, px.y), vec2(px.x.negate(), 0), vec2(0, px.y.negate())]) {
          const n = colorToDirection(nTex.sample(screenUV.add(o)).rgb);
          const d = vz(screenUV.add(o));
          edge = max(edge, max(smoothstep(0.35, 0.6, float(1).sub(dot(n0, n))), smoothstep(0.01, 0.03, abs(d.sub(d0)).div(abs(d0)))));
        }
        const inner = edge.mul(fx.mask.sample(screenUV).r);
        out = vec4(mix(out.rgb, color('#18230f'), inner), 1);
      }
      const pipeline = new THREE.RenderPipeline(s.renderer);
      pipeline.outputNode = out;
      return { ...s, render: () => pipeline.render() };
    },
  },
  highlight: {
    variants: ['No selection', 'Hovered tree highlighted (per-tree ID)'],
    async setup(v) {
      const s = makeStage();
      const trees = [];
      for (const [i, x, z] of [[1, -2.2, -1.5], [2, 0.6, 1.2], [3, 2.8, -0.6]]) {
        const t = await tree(stylized.broadleaf, { seed: i });
        t.position.set(x, 0, z); trees.push(t); s.scene.add(t);
      }
      ground(s.scene);
      const box = new THREE.Box3(); trees.forEach((t) => { t.updateMatrixWorld(true); box.union(framingBox(t)); });
      frame(s.camera, box, 1.1, new THREE.Vector3(0.3, 0.3, 1).normalize());
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      p.setMRT(mrt({ output, treeId: treeIdNode(trees) }));
      const idTex = p.getTextureNode('treeId');
      let out = p.getTextureNode();
      if (v) {
        const hovered = 2;
        const isHovered = (uvn) => select(abs(idTex.sample(uvn).r.sub(hovered)).lessThan(0.5), float(1), float(0));
        const me = isHovered(screenUV);
        // outline only on the outside of the hovered tree
        const st = vec2(3, 3).div(screenSize);
        let near = float(0);
        for (const o of [vec2(st.x, 0), vec2(st.x.negate(), 0), vec2(0, st.y), vec2(0, st.y.negate()), st, st.negate()]) near = max(near, isHovered(screenUV.add(o)));
        const ring = near.mul(float(1).sub(me));
        const lifted = out.rgb.mul(1.25).add(color('#ffe9a0').mul(0.12));
        out = vec4(mix(mix(out.rgb, lifted, me), color('#ffd34d'), ring), 1);
      }
      pipeline.outputNode = out;
      return { ...s, render: () => pipeline.render() };
    },
  },
  'season-grade': {
    variants: ['Autumn · no grade', 'Autumn · Season-driven tree grade'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(stylized.broadleaf, { season: 0.72 });
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      const fx = treeEffectsPass(s.scene, s.camera);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      // in a real version the grade settings would be keyframed against Season (like the Season Profile)
      pipeline.outputNode = v ? treeColorGrade(fx, { saturation: 1.12, contrast: 1.15, tint: '#ffd9b0', exposure: 1.0 }) : fx.color;
      return { ...s, render: () => pipeline.render() };
    },
  },

  // ========== WHOLE SCENE (post stack) ==========
  'tone-mapping': {
    variants: ['No tone mapping', 'ACES Filmic', 'AgX', 'Neutral (Khronos PBR)'],
    async setup(v) {
      const s = makeStage({ sunIntensity: 6, sky: '#a8c8e8' });
      s.hemi.intensity = 2.2;
      s.renderer.toneMapping = [THREE.NoToneMapping, THREE.ACESFilmicToneMapping, THREE.AgXToneMapping, THREE.NeutralToneMapping][v];
      const t = await tree(realistic.broadleaf, { season: 0.68 });
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      return s;
    },
  },
  'anti-aliasing': {
    variants: ['No AA', 'FXAA', 'SMAA', 'TRAA (temporal)'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(lowPoly.conifer);
      s.scene.add(t); ground(s.scene);
      const box = framingBox(t);
      frame(s.camera, box, 0.55, new THREE.Vector3(1, 0.1, 1).normalize());
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      let out;
      if (v === 0) out = p;
      else if (v === 1) out = fxaa(renderOutput(p.getTextureNode()));
      else if (v === 2) out = smaa(renderOutput(p.getTextureNode()));
      else {
        p.setMRT(mrt({ output, velocity: (await import('three/tsl')).velocity }));
        out = renderOutput(traa(p.getTextureNode(), p.getTextureNode('depth'), p.getTextureNode('velocity'), s.camera));
      }
      if (v > 0) pipeline.outputColorTransform = false;
      pipeline.outputNode = out;
      return { ...s, render: () => pipeline.render(), frames: v === 3 ? 40 : 4 };
    },
  },
  bloom: {
    variants: ['Off', 'Bloom (sun glare through the leaves)'],
    async setup(v) {
      const s = makeStage({ sky: '#b9d2e6', sunPos: [-4, 6, -6], sunIntensity: 2.5 });
      s.renderer.toneMapping = THREE.AgXToneMapping;
      const t = await tree(realistic.broadleaf);
      s.scene.add(t); ground(s.scene);
      const box = framingBox(t); const centre = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
      frame(s.camera, box, 1.3, new THREE.Vector3(1, 0.05, 1).normalize());
      // an HDR sun disc right behind the upper crown
      const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(size.y * 0.09, 32, 16), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(14, 12, 9) }));
      sunDisc.position.copy(centre).addScaledVector(s.camera.position.clone().sub(centre).normalize(), -30).add(new THREE.Vector3(0, size.y * 0.25 + 3.2, 0));
      s.scene.add(sunDisc);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      const c = p.getTextureNode();
      pipeline.outputNode = v ? c.add(bloom(c, 0.9, 0.5, 1.5)) : c;
      return { ...s, render: () => pipeline.render() };
    },
  },
  gtao: {
    variants: ['Off', 'GTAO (screen-space ambient occlusion)'],
    async setup(v) {
      const s = makeStage();
      s.hemi.intensity = 2.2; s.sun.intensity = 1.6;
      const t = await tree(stylized.broadleaf);
      s.scene.add(t); ground(s.scene);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardNodeMaterial({ color: '#8a8f99', flatShading: true }));
      rock.position.set(1.3, 0.3, 1.2); s.scene.add(rock);
      frame(s.camera, framingBox(t), 1.2);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const scenePass = pass(s.scene, s.camera);
      if (v) {
        const prePass = pass(s.scene, s.camera);
        prePass.setMRT(mrt({ output: normalView }));
        const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), s.camera);
        aoPass.radius.value = 1.2; aoPass.scale.value = 1.6; aoPass.thickness.value = 2;
        scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      }
      pipeline.outputNode = scenePass;
      return { ...s, render: () => pipeline.render() };
    },
  },
  lut: {
    variants: ['Off', '3D LUT colour grade (warm film look)'],
    async setup(v) {
      const s = makeStage();
      s.renderer.toneMapping = THREE.AgXToneMapping;
      const forest = createForest(stylized.broadleaf, grid(30, 4.4, 3), { variants: 4, seed: 1, season: 0.45 });
      s.scene.add(forest); ground(s.scene, 80);
      s.camera.position.set(0, 9, 26); s.camera.lookAt(0, 2, 0);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      if (!v) { pipeline.outputNode = p; return { ...s, render: () => pipeline.render() }; }
      // a procedural LUT: lifted teal shadows, warm highlights, slight desaturation
      const N = 32; const data = new Uint8Array(N * N * N * 4);
      for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
        let R = r / (N - 1), G = g / (N - 1), B = b / (N - 1);
        const l = 0.3 * R + 0.59 * G + 0.11 * B;
        R = R * 0.85 + l * 0.15; G = G * 0.85 + l * 0.15; B = B * 0.85 + l * 0.15;
        const sh = 1 - l, hi = l;
        R += -0.08 * sh + 0.16 * hi; G += 0.03 * sh + 0.05 * hi; B += 0.12 * sh - 0.14 * hi;
        const lift = (x) => 0.05 + x * 0.93;
        const i = (r + g * N + b * N * N) * 4;
        data[i] = Math.max(0, Math.min(255, lift(R) * 255)); data[i + 1] = Math.max(0, Math.min(255, lift(G) * 255));
        data[i + 2] = Math.max(0, Math.min(255, lift(B) * 255)); data[i + 3] = 255;
      }
      const lutTex = new THREE.Data3DTexture(data, N, N, N);
      lutTex.minFilter = lutTex.magFilter = THREE.LinearFilter; lutTex.needsUpdate = true;
      pipeline.outputColorTransform = false;
      pipeline.outputNode = lut3D(renderOutput(p.getTextureNode()), texture3D(lutTex), N, float(1));
      return { ...s, render: () => pipeline.render() };
    },
  },
  godrays: {
    variants: ['Off', 'God rays (light shafts through the canopy)'],
    async setup(v) {
      const s = makeStage({ sky: '#e9dcc0', sunPos: [-16, 11, -16], sunIntensity: 3, shadows: true });
      s.hemi.intensity = 0.5;
      s.sun.shadow.camera.left = s.sun.shadow.camera.bottom = -20; s.sun.shadow.camera.right = s.sun.shadow.camera.top = 20; s.sun.shadow.camera.far = 80;
      s.sun.shadow.camera.updateProjectionMatrix();
      const forest = createForest(realistic.broadleaf, grid(36, 3.2, 4), { variants: 4, seed: 3, season: 0.37 });
      await forest.ready;
      for (const m of forest.variants.flatMap((x) => x.meshes)) { m.castShadow = true; m.receiveShadow = true; }
      s.scene.add(forest);
      ground(s.scene, 60, true);
      s.camera.position.set(12, 2.2, 12); s.camera.lookAt(-6, 5, -6);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      const c = p.getTextureNode(); const depth = p.getTextureNode('depth');
      if (!v) { pipeline.outputNode = c; return { ...s, render: () => pipeline.render() }; }
      const rays = godrays(depth, s.camera, s.sun);
      rays.density.value = 2.2; rays.maxDensity.value = 0.9; rays.distanceAttenuation.value = 0.6;
      pipeline.outputNode = depthAwareBlend(c, rays.getTextureNode(), depth, s.camera, { blendColor: color('#fff0c8'), edgeRadius: 2, edgeStrength: 2 });
      return { ...s, render: () => pipeline.render(), frames: 6 };
    },
  },
  dof: {
    variants: ['Off', 'Depth of field (focus on the front tree)'],
    async setup(v) {
      const s = makeStage();
      const forest = createForest(stylized.broadleaf, grid(36, 4.4, 9), { variants: 4, seed: 1, season: 0.4 });
      s.scene.add(forest); ground(s.scene, 80);
      const front = await tree(stylized.broadleaf, { seed: 11 });
      front.position.set(0, 0, 17); s.scene.add(front);
      s.camera.position.set(1.5, 3, 25); s.camera.lookAt(0, 3, 0);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      pipeline.outputNode = v ? dof(p.getTextureNode(), p.getViewZNode(), 8, 6, 2.5) : p;
      return { ...s, render: () => pipeline.render() };
    },
  },
  fog: {
    variants: ['No fog', 'Distance fog', 'Height fog (low mist)'],
    async setup(v) {
      const s = makeStage({ sky: '#c9d8e2' });
      const forest = createForest(stylized.conifer, grid(120, 4.4, 5), { variants: 4, seed: 2, season: 0.4 });
      s.scene.add(forest); ground(s.scene, 120);
      s.camera.position.set(0, 7, 28); s.camera.lookAt(0, 3, -10);
      const fogColor = color('#c9d8e2');
      if (v === 1) s.scene.fogNode = fog(fogColor, rangeFogFactor(10, 55));
      if (v === 2) s.scene.fogNode = fog(fogColor, rangeFogFactor(0, 40).mul(smoothstep(4.5, 0, positionWorld.y)).add(rangeFogFactor(30, 120).mul(0.5)).clamp(0, 1));
      return s;
    },
  },
  'contact-shadows': {
    variants: ['Shadow map only', '+ screen-space (contact) shadows'],
    async setup(v) {
      const s = makeStage({ sunPos: [6, 4, 2], sunIntensity: 3, shadows: true });
      s.sun.shadow.mapSize.set(512, 512); // coarse on purpose, like a big-world cascade
      const t = await tree(stylized.broadleaf, {}, true);
      s.scene.add(t); ground(s.scene, 40, true);
      const box = framingBox(t);
      frame(s.camera, box, 0.75, new THREE.Vector3(1, 0.25, 0.6).normalize());
      const pipeline = new THREE.RenderPipeline(s.renderer);
      const p = pass(s.scene, s.camera);
      if (!v) { pipeline.outputNode = p; return { ...s, render: () => pipeline.render() }; }
      const shadows = sss(p.getTextureNode('depth'), s.camera, s.sun);
      shadows.maxDistance.value = 0.6;
      pipeline.outputNode = vec4(p.getTextureNode().rgb.mul(mix(0.55, 1, shadows.getTextureNode().r)), 1);
      return { ...s, render: () => pipeline.render() };
    },
  },
  stylize: {
    variants: ['Pixelation (with depth/normal edges)', 'Retro (PS1-style)', 'Film grain', 'Sobel edges as ink lines'],
    async setup(v) {
      const s = makeStage();
      const t = await tree(lowPoly.broadleaf);
      s.scene.add(t); ground(s.scene);
      frame(s.camera, framingBox(t), 1.25);
      const pipeline = new THREE.RenderPipeline(s.renderer);
      if (v === 0) pipeline.outputNode = pixelationPass(s.scene, s.camera, 5, 0.4, 0.6);
      if (v === 1) pipeline.outputNode = retroPass(s.scene, s.camera);
      if (v === 2) pipeline.outputNode = film(pass(s.scene, s.camera), float(0.6));
      if (v === 3) { pipeline.outputColorTransform = false; const c = renderOutput(pass(s.scene, s.camera).getTextureNode()); pipeline.outputNode = vec4(c.rgb.mul(float(1).sub(sobel(c).r.mul(0.8))), 1); }
      return { ...s, render: () => pipeline.render() };
    },
  },
};

async function main() {
  const name = params.get('c');
  const v = Number(params.get('v') ?? 0);
  if (params.get('list') !== null) { window.concept = { status: 'rendered', list: Object.fromEntries(Object.entries(CONCEPTS).map(([k, c]) => [k, c.variants])) }; return; }
  const concept = CONCEPTS[name];
  if (!concept) throw new Error(`Unknown concept "${name}"`);
  labelEl.textContent = concept.variants[v];
  const s = await concept.setup(v);
  await s.renderer.init();
  const render = s.render ?? (() => s.renderer.render(s.scene, s.camera));
  for (let i = 0; i < (s.frames ?? 4); i++) {
    render();
    await new Promise(requestAnimationFrame);
  }
  window.concept = { status: 'rendered', variants: concept.variants };
}

main().catch((error) => {
  console.error(error);
  labelEl.textContent = String(error?.message ?? error);
  window.concept = { status: 'error', error: String(error?.stack ?? error) };
});
