/* eslint-disable */
// @ts-nocheck
// TEMPORARY concept renders for the Painterly Style (#108 / #109). Draft PR only, never for main.
// Every concept is a quick hack to get a picture, not a proposed implementation.
//   /concepts/?c=<concept>&v=<variant index>[&view=<view index>]
// The page sets window.concept = { status, variants, views } once drawn and exposes
// window.showView(i) (re-frames and re-renders); concepts/capture.mjs screenshots every view.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, BRDF_Lambert, cameraWorldMatrix, clamp, color, convertToTexture, diffuseColor, dot, float, Fn, fract, frontFacing,
  max, min, mix, normalize, normalLocal, normalView, positionLocal, positionViewDirection, positionWorld, screenSize,
  screenUV, select, smoothstep, texture, transformNormalToView, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom, createTree } from '@casmo/tree.js';
import { createTreeEffects } from '@casmo/tree.js/effects';
import stylized from '@casmo/tree.js/styles/stylized';
import realistic from '@casmo/tree.js/styles/realistic';
import { birch, cedar, cherry, douglasFir, elm, maple, oak, olive, pine, redwood, spruce } from '@casmo/tree.js/species';
import { generateTree } from '../src/generator';

const params = new URLSearchParams(location.search);
const labelEl = document.getElementById('label')!;
window.concept = { status: 'loading' };

const SEED = 3;
const SEASON = 0.37; // summer
const SUN_DIR = new THREE.Vector3(-0.35, 0.78, 0.52).normalize();

// ================================================================ small helpers

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Trilinear value noise, 0..1. */
function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm3 = (x, y, z, seed) => (noise3(x, y, z, seed) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1, seed + 7) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3, seed + 13) * 0.1);

/** A Season Profile colour track sampled at `t` (linear RGB). */
function trackColor(track, t) {
  let a = track[0], b = track[track.length - 1];
  for (let i = 0; i < track.length - 1; i++) if (track[i].t <= t && track[i + 1].t >= t) { a = track[i]; b = track[i + 1]; break; }
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return new THREE.Color(a.value).lerp(new THREE.Color(b.value), f);
}

// ================================================================ painted textures (runtime canvas, seeded)
// A real Painterly Style would bake these in scripts/generate-textures.mjs (see README).

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

/** RGBA DataTexture from a value canvas (r) and a coverage canvas (a). */
function valueAlphaTexture(valueCanvas, alphaCanvas, repeat = true) {
  const w = valueCanvas.width, h = valueCanvas.height;
  const v = valueCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const a = alphaCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = v[i * 4]; data[i * 4 + 1] = v[i * 4 + 1]; data[i * 4 + 2] = v[i * 4 + 2]; data[i * 4 + 3] = a[i * 4]; }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** A pointed leaf blade path centred on (0,0), pointing along +y. */
function bladePath(g, len, wid) {
  g.beginPath();
  g.moveTo(0, -len / 2);
  g.quadraticCurveTo(wid, -len * 0.1, 0, len / 2);
  g.quadraticCurveTo(-wid, -len * 0.1, 0, -len / 2);
  g.closePath();
}
const grey = (v, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

/**
 * Tileable painted leaf-mass texture (for world-space / triplanar projection on Leaf Masses):
 * r = paint value (dark gaps .. light leaf edges), a = leaf coverage (for the ragged edge cut).
 */
function leafMassTexture(size = 512, seed = 11) {
  const r = createRandom(seed);
  const [vc, vg] = canvas(size, size);
  const [ac, ag] = canvas(size, size);
  vg.fillStyle = grey(0.12); vg.fillRect(0, 0, size, size);
  ag.fillStyle = '#000'; ag.fillRect(0, 0, size, size);
  const leaves = 700;
  for (let i = 0; i < leaves; i++) {
    const x = r.range(0, size), y = r.range(0, size);
    const len = r.range(34, 58), wid = len * r.range(0.4, 0.55);
    const rot = r.range(0, Math.PI * 2);
    const depth = i / leaves; // later leaves lie on top: lighter
    const value = 0.25 + 0.6 * depth * r.range(0.6, 1.0) + r.range(0, 0.15);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox < -50 || x + ox > size + 50 || y + oy < -50 || y + oy > size + 50) continue;
      for (const [g, fill] of [[vg, null], [ag, '#fff']]) {
        g.save(); g.translate(x + ox, y + oy); g.rotate(rot);
        bladePath(g, len, wid);
        if (fill) { g.fillStyle = fill; g.fill(); }
        else {
          // painted: lit edge on one side, darker on the other
          const grad = g.createLinearGradient(-wid / 2, 0, wid / 2, 0);
          grad.addColorStop(0, grey(value * 0.7)); grad.addColorStop(1, grey(Math.min(1, value * 1.15)));
          g.fillStyle = grad; g.fill();
        }
        g.restore();
      }
    }
  }
  return valueAlphaTexture(vc, ac);
}

/**
 * Jagged painted leaf-spray card: a stem from the bottom centre with leaves fanning out, tips at the top.
 * r = paint value, a = coverage. UV (0..1)^2, v = 0 at the stem (flipY false: canvas row 0 is v = 0).
 */
function sprayTexture(size = 256, seed = 5, needle = false) {
  const r = createRandom(seed);
  const [vc, vg] = canvas(size, size);
  const [ac, ag] = canvas(size, size);
  vg.fillStyle = grey(0.15); vg.fillRect(0, 0, size, size);
  ag.fillStyle = '#000'; ag.fillRect(0, 0, size, size);
  const cx = size / 2;
  const blades = needle ? 260 : 70;
  for (let i = 0; i < blades; i++) {
    const t = Math.pow(r.range(0, 1), 0.8); // along the stem
    const y = size * (0.08 + 0.8 * t);
    const side = r.range(-1, 1);
    const spread = (1 - t * 0.6) * size * 0.32;
    const x = cx + side * spread * r.range(0.2, 1);
    const len = needle ? size * r.range(0.12, 0.22) : size * r.range(0.13, 0.22) * (1 - 0.4 * t);
    const wid = needle ? len * 0.09 : len * r.range(0.38, 0.5);
    const rot = Math.PI + side * r.range(0.5, 1.2) * (needle ? 1.1 : 0.9); // pointing away from the stem, up (canvas y down = v up)
    const value = 0.35 + 0.55 * t * r.range(0.6, 1.1) + r.range(0, 0.15);
    for (const [g, fill] of [[vg, null], [ag, '#fff']]) {
      g.save(); g.translate(x, y); g.rotate(rot + Math.PI);
      bladePath(g, len, wid);
      if (fill) { g.fillStyle = fill; g.fill(); }
      else {
        const grad = g.createLinearGradient(-wid / 2, 0, wid / 2, 0);
        grad.addColorStop(0, grey(value * 0.7)); grad.addColorStop(1, grey(Math.min(1, value * 1.15)));
        g.fillStyle = grad; g.fill();
      }
      g.restore();
    }
  }
  // the stem
  for (const g of [vg, ag]) {
    g.strokeStyle = g === vg ? grey(0.2) : '#fff'; g.lineWidth = size * 0.025;
    g.beginPath(); g.moveTo(cx, 0); g.quadraticCurveTo(cx + size * 0.04, size * 0.5, cx, size * 0.88); g.stroke();
  }
  return valueAlphaTexture(vc, ac, false);
}

/**
 * Round 3 (smooth): a smooth, round card instead of a brushy spray. A main circle plus `lobes` round lobes on
 * its rim (a scalloped circular outline); r = a smooth dome value (light in the middle and towards the top,
 * darker at the rim), a = coverage (1 px soft edge). No brush marks. UV like sprayTexture (row 0 = v = 0).
 */
function discTexture(size = 256, seed = 31, lobes = 6) {
  const r = createRandom(seed);
  const circles = [[0.5, 0.5, 0.3, 1]];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + r.range(-0.25, 0.25);
    const rad = r.range(0.15, 0.19), dc = 0.48 - rad - r.range(0, 0.02);
    circles.push([0.5 + Math.cos(a) * dc, 0.5 + Math.sin(a) * dc, rad, 0.85]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    let dome = 0, cover = 0;
    for (const [cx, cy, rad, w] of circles) {
      const d = Math.hypot(u - cx, v - cy);
      cover = Math.max(cover, clamp01((rad - d) * size + 0.5));
      if (d < rad) dome = Math.max(dome, Math.sqrt(1 - (d / rad) ** 2) * w);
    }
    const value = clamp01(0.3 + 0.5 * dome + 0.2 * v);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(value * 255);
    data[i + 3] = Math.round(cover * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Painted Tier (conifer layer) texture: u across the fan (0..1), v from the trunk (0) to the tip (1).
 * Needle strokes radiate outward; the outer edge is ragged with drooping spikes.
 */
function tierTexture(w = 512, h = 256, seed = 17) {
  const r = createRandom(seed);
  const [vc, vg] = canvas(w, h);
  const [ac, ag] = canvas(w, h);
  vg.fillStyle = grey(0.18); vg.fillRect(0, 0, w, h);
  ag.fillStyle = '#000'; ag.fillRect(0, 0, w, h);
  // ragged outline: spikes along the tip and sides
  const spikes = 9;
  const outline = [];
  for (let i = 0; i <= 120; i++) {
    const u = i / 120;
    const s = Math.abs(Math.sin(u * Math.PI * spikes + 0.4)) ;
    const v = 0.72 + 0.24 * Math.pow(s, 2.5) + r.range(-0.03, 0.03);
    const sideFade = smooth(0, 0.12, u) * smooth(1, 0.88, u);
    outline.push([u * w, v * sideFade * h + (1 - sideFade) * 0.15 * h]);
  }
  ag.fillStyle = '#fff';
  ag.beginPath(); ag.moveTo(0, 0);
  for (const [x, y] of outline) ag.lineTo(x, y);
  ag.lineTo(w, 0); ag.closePath(); ag.fill();
  // needle strokes, painted value: dark at the base, light at the tips
  for (let i = 0; i < 2600; i++) {
    const u = r.range(0, 1), v = Math.pow(r.range(0, 1), 0.7);
    const len = h * r.range(0.06, 0.14);
    const ang = r.range(-0.35, 0.35) + (u - 0.5) * 0.4;
    const value = 0.25 + 0.65 * v * r.range(0.6, 1.1) + r.range(0, 0.1);
    vg.strokeStyle = grey(Math.min(1, value)); vg.lineWidth = r.range(1.5, 3.5); vg.lineCap = 'round';
    const x = u * w, y = v * h;
    vg.beginPath(); vg.moveTo(x, y); vg.lineTo(x + Math.sin(ang) * len, y + Math.cos(ang) * len); vg.stroke();
  }
  // bristly needles poking out of the outline
  ag.strokeStyle = '#fff'; ag.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    const k = r.int(0, outline.length - 2);
    const [x, y] = outline[k];
    const len = h * r.range(0.03, 0.08), ang = r.range(-0.6, 0.6);
    ag.lineWidth = r.range(1.2, 2.5);
    ag.beginPath(); ag.moveTo(x, y - len * 0.5); ag.lineTo(x + Math.sin(ang) * len, y + Math.cos(ang) * len * 0.8); ag.stroke();
  }
  return valueAlphaTexture(vc, ac, false);
}

/** Painted bark colour per Bark Type (sRGB colour texture). */
function barkTexture(type, seed = 23) {
  const r = createRandom(seed);
  const [c, g] = canvas(128, 256);
  const base = { furrowed: '#6a523f', papery: '#e9e4d8', plated: '#9a5838' }[type] ?? '#6a523f';
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  if (type === 'papery') {
    for (let i = 0; i < 90; i++) {
      const x = r.range(0, 128), y = r.range(0, 256), len = r.range(6, 26);
      g.fillStyle = `rgba(40,34,30,${r.range(0.6, 0.95)})`;
      g.beginPath(); g.ellipse(x, y, len / 2, r.range(1, 2.6), 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x - 128, y, len / 2, 2, 0, 0, Math.PI * 2); g.ellipse(x + 128, y, len / 2, 2, 0, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(190,180,165,0.5)`; g.fillRect(r.range(0, 128), r.range(0, 256), r.range(6, 20), r.range(3, 10)); }
  } else {
    const dark = type === 'plated' ? 'rgba(60,28,18,0.75)' : 'rgba(40,30,22,0.6)';
    const light = type === 'plated' ? 'rgba(200,120,80,0.45)' : 'rgba(150,125,100,0.4)';
    for (let i = 0; i < 70; i++) {
      const x = r.range(0, 128), y = r.range(-20, 256), len = type === 'plated' ? r.range(15, 40) : r.range(40, 120);
      g.strokeStyle = r.next() < 0.6 ? dark : light; g.lineWidth = r.range(2, 5); g.lineCap = 'round';
      for (const ox of [-128, 0, 128]) { g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + r.range(-4, 4), y + len); g.stroke(); }
    }
    if (type === 'plated') for (let i = 0; i < 30; i++) { g.strokeStyle = dark; g.lineWidth = 2; const y = r.range(0, 256), x = r.range(0, 128); g.beginPath(); g.moveTo(x, y); g.lineTo(x + r.range(10, 28), y + r.range(-3, 3)); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ================================================================ Painted lighting (soft, warm, wrap)

const lighting = { wrap: 0.5 };

/** Soft wrap-diffuse lighting: no toon bands, no specular. */
class PaintedLightingModel extends THREE.LightingModel {
  constructor(wrap = lighting.wrap) { super(); this.wrap = wrap; }
  direct({ lightDirection, lightColor, reflectedLight }) {
    const w = float(this.wrap);
    const ndl = normalView.dot(lightDirection);
    const wrapped = ndl.add(w).div(w.add(1)).clamp(0, 1);
    const soft = wrapped.mul(wrapped).mul(float(3).sub(wrapped.mul(2))); // smooth, no band
    reflectedLight.directDiffuse.addAssign(lightColor.mul(soft).mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
  }
  indirect(builder) {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}
class PaintedMaterial extends THREE.MeshStandardNodeMaterial {
  setupLightingModel() { return new PaintedLightingModel(this.userData.wrap ?? lighting.wrap); }
}

// ================================================================ the cluster

const CLUSTER = [
  { species: oak, height: 3.0, position: [0.4, 0, 1.2] },
  { species: birch, height: 3.4, position: [-2.0, 0, 0.3] },
  { species: pine, height: 3.8, position: [1.5, 0, -1.4] },
];

/** More Species (one per pane, or all together in the grove), at Painterly heights (2–4 m, ADR 0013). */
const SPECIES_ROWS = [
  { species: maple, height: 3.4 }, { species: cherry, height: 3.1 }, { species: olive, height: 2.6 }, { species: elm, height: 3.5 },
  { species: cedar, height: 3.4 }, { species: spruce, height: 3.6 }, { species: douglasFir, height: 3.8 }, { species: redwood, height: 4.0 },
];
const GROVE = SPECIES_ROWS.map((e, i) => ({ ...e, position: [((i % 3) - 1) * 3.1 + (Math.floor(i / 3) % 2 ? 0.8 : -0.3), 0, (Math.floor(i / 3) - 1) * 3.0] }));

/** Leaf centres of a Species (from the realistic look's many cards: a dense sample of the crown). */
function leafCloud(species) {
  const data = generateTree(realistic.apply(species), SEED);
  return data.skeleton.leaves.map((l) => [l.position[0] + l.direction[0] * l.size * 0.45, l.position[1] + l.direction[1] * l.size * 0.45, l.position[2] + l.direction[2] * l.size * 0.45]);
}

/** k-means into Leaf Masses: centre and ellipsoid radii (tree space, unscaled). */
function leafMasses(points, k, seed, yWeight = 1) {
  const r = createRandom(seed);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * yWeight) ** 2 + (a[2] - b[2]) ** 2;
  // farthest-point init from the highest point
  const centres = [points.reduce((a, b) => (b[1] > a[1] ? b : a)).slice()];
  while (centres.length < k) {
    let best = null, bestD = -1;
    for (let i = 0; i < points.length; i += 3) {
      const d = Math.min(...centres.map((c) => d2(c, points[i]))) * r.range(0.8, 1);
      if (d > bestD) { bestD = d; best = points[i]; }
    }
    centres.push(best.slice());
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < 15; it++) {
    assign = points.map((p) => { let bi = 0, bd = Infinity; centres.forEach((c, i) => { const d = d2(c, p); if (d < bd) { bd = d; bi = i; } }); return bi; });
    centres.forEach((c, i) => {
      const own = points.filter((_, j) => assign[j] === i);
      if (!own.length) return;
      for (let a = 0; a < 3; a++) c[a] = own.reduce((s, p) => s + p[a], 0) / own.length;
    });
  }
  return centres.map((c, i) => {
    const own = points.filter((_, j) => assign[j] === i);
    const sd = [0, 1, 2].map((a) => Math.sqrt(own.reduce((s, p) => s + (p[a] - c[a]) ** 2, 0) / Math.max(1, own.length)));
    const h = Math.max(sd[0], sd[2]);
    const radii = [Math.max(sd[0], h * 0.75) * 2.0, sd[1] * 2.0, Math.max(sd[2], h * 0.75) * 2.0];
    radii[1] = Math.min(Math.max(radii[1], radii[0] * 0.6), radii[0] * 1.1);
    return { centre: c, radii, count: own.length };
  }).filter((m) => m.count > 4);
}

const ellipsoidDistance = (m, p) => Math.hypot((p[0] - m.centre[0]) / m.radii[0], (p[1] - m.centre[1]) / m.radii[1], (p[2] - m.centre[2]) / m.radii[2]);
const ellipsoidNormal = (m, p) => {
  const n = new THREE.Vector3((p[0] - m.centre[0]) / m.radii[0] ** 2, (p[1] - m.centre[1]) / m.radii[1] ** 2, (p[2] - m.centre[2]) / m.radii[2] ** 2);
  return n.lengthSq() > 1e-10 ? n.normalize() : new THREE.Vector3(0, 1, 0);
};

/** Lumpy surface radius multiplier of a Leaf Mass in unit direction d. */
const lump = (d, seed, amount) => 1 + (fbm3(d[0] * 1.7 + 5, d[1] * 1.7, d[2] * 1.7, seed) - 0.5) * 2 * amount + (noise3(d[0] * 5 + 1, d[1] * 5, d[2] * 5, seed + 3) - 0.5) * amount * 0.7;

/** Occlusion (0 open .. 1 buried) of a point: inside / near other masses, and near the trunk core. */
function occlusionAt(p, masses, self, crown) {
  let occ = 0;
  masses.forEach((m, i) => { if (i !== self) occ += smooth(1.35, 0.7, ellipsoidDistance(m, p)) * 0.55; });
  const axis = Math.hypot(p[0] - crown.cx, p[2] - crown.cz) / crown.r;
  occ += smooth(0.75, 0.1, axis) * 0.35 * smooth(crown.top, crown.bottom, p[1]);
  occ += smooth(crown.mid, crown.bottom, p[1]) * 0.3;
  return clamp01(occ);
}

function crownStats(masses) {
  let bottom = Infinity, top = -Infinity, cx = 0, cz = 0, r = 0;
  for (const m of masses) { bottom = Math.min(bottom, m.centre[1] - m.radii[1]); top = Math.max(top, m.centre[1] + m.radii[1]); cx += m.centre[0] / masses.length; cz += m.centre[2] / masses.length; }
  for (const m of masses) r = Math.max(r, Math.hypot(m.centre[0] - cx, m.centre[2] - cz) + Math.max(m.radii[0], m.radii[2]));
  return { bottom, top, mid: (bottom + top) / 2, cx, cz, r };
}

/** One paint attribute per vertex: x = height in crown, y = occlusion, z = tip / lump light, w = per-mass random. */
function paintAttr(arr, i, p, masses, self, crown, tip, rnd) {
  arr[i * 4] = clamp01((p[1] - crown.bottom) / (crown.top - crown.bottom));
  arr[i * 4 + 1] = occlusionAt(p, masses, self, crown);
  arr[i * 4 + 2] = tip;
  arr[i * 4 + 3] = rnd;
}

/** Concept A / B core / C: one lumpy icosphere per Leaf Mass. */
function massGeometry(masses, crown, { scale = 1, lumpAmount = 0.2, seed = 1, detail = 4 } = {}) {
  const parts = masses.map((m, mi) => {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const pos = g.attributes.position;
    const paint = new Float32Array(pos.count * 4);
    const rnd = hash3(mi, seed, 3, 9);
    for (let i = 0; i < pos.count; i++) {
      const d = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const l = lump(d, seed * 31 + mi, lumpAmount);
      const flat = d[1] < -0.25 ? 0.82 : 1; // flatter underside
      const p = [m.centre[0] + d[0] * m.radii[0] * l * scale, m.centre[1] + d[1] * m.radii[1] * l * scale * flat, m.centre[2] + d[2] * m.radii[2] * l * scale];
      pos.setXYZ(i, ...p);
      paintAttr(paint, i, p, masses, mi, crown, clamp01((l - 1) / (2 * lumpAmount) + 0.5), rnd);
    }
    g.setAttribute('aPaint', new THREE.BufferAttribute(paint, 4));
    g.computeVertexNormals();
    return g;
  });
  return mergeGeometries(parts);
}

/**
 * Round 3 (smooth): one smooth Leaf Mass per cluster whose surface is a union of round lobes (spherical caps
 * pushed out of the ellipsoid), so the silhouette is a scalloped circular edge, not a noisy one. Vertex
 * normals are mixed `bend` towards the ellipsoid normal: one continuous, soft gradient over the mass.
 */
function scallopMassGeometry(masses, crown, { scale = 1, lobes = 16, amount = 0.2, spread = 0.62, seed = 1, detail = 14, bend = 0.5 } = {}) {
  const parts = masses.map((m, mi) => {
    const r = createRandom(seed * 97 + mi);
    const dirs = [];
    for (let i = 0; i < lobes; i++) {
      // fibonacci sphere + jitter: evenly spread lobes, fewer underneath
      const y = 1 - ((i + 0.5) / lobes) * 1.6, rr = Math.sqrt(1 - y * y), a = i * 2.39996 + r.range(-0.3, 0.3);
      dirs.push([Math.cos(a) * rr, y, Math.sin(a) * rr, spread * r.range(0.8, 1.2), r.range(0.7, 1)]);
    }
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const pos = g.attributes.position;
    const paint = new Float32Array(pos.count * 4);
    const rnd = hash3(mi, seed, 3, 9);
    const lobeAt = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const d = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      let bump = 0;
      for (const [x, y, z, a, h] of dirs) {
        const ang = Math.acos(Math.min(1, d[0] * x + d[1] * y + d[2] * z));
        if (ang < a) bump = Math.max(bump, Math.sqrt(1 - (ang / a) ** 2) * h);
      }
      lobeAt[i] = bump;
      const l = 1 - amount * 0.6 + amount * bump;
      const flat = d[1] < -0.25 ? 0.85 : 1;
      const p = [m.centre[0] + d[0] * m.radii[0] * l * scale, m.centre[1] + d[1] * m.radii[1] * l * scale * flat, m.centre[2] + d[2] * m.radii[2] * l * scale];
      pos.setXYZ(i, ...p);
      paintAttr(paint, i, p, masses, mi, crown, 0.3 + bump * 0.4, rnd);
    }
    g.setAttribute('aPaint', new THREE.BufferAttribute(paint, 4));
    g.computeVertexNormals();
    const n = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const en = ellipsoidNormal(m, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      const own = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).lerp(en, bend).normalize();
      n.setXYZ(i, own.x, own.y, own.z);
    }
    return g;
  });
  return mergeGeometries(parts);
}

function mergeGeometries(parts) {
  let vCount = 0, iCount = 0;
  for (const g of parts) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const out = new THREE.BufferGeometry();
  const names = Object.keys(parts[0].attributes);
  for (const name of names) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(vCount * size);
    let o = 0;
    for (const g of parts) { const a = g.attributes[name]; for (let i = 0; i < a.count * size; i++) arr[o + i] = a.array[i]; o += a.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = new Uint32Array(iCount);
  let io = 0, vo = 0;
  for (const g of parts) { for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.array[i] + vo; io += g.index.count; vo += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * Leaf-spray cards around / inside Leaf Masses (B shell, D clumps). Each card's vertex normals are the
 * normal of its mass's ellipsoid at that vertex (bent fully), `bend` mixes in the card's own normal.
 */
function cardGeometry(masses, crown, { perMass = 60, shell = 0.95, depth = 0.0, size = 0.55, seed = 2, bend = 0.9, minCards = 14, maxCards = 200, outward = 0.6, billboard = false, cardTip = 0.4 } = {}) {
  const r = createRandom(seed);
  const pos = [], nor = [], uvs = [], paint = [], idx = [], centres = [], offsets = [];
  const meanOf = (m) => (m.radii[0] + m.radii[1] + m.radii[2]) / 3;
  const avg = masses.reduce((s, m) => s + meanOf(m), 0) / masses.length;
  masses.forEach((m, mi) => {
    const mean = meanOf(m);
    const n = Math.round(Math.min(maxCards, Math.max(minCards, perMass * (mean / avg) ** 2)));
    const rnd = hash3(mi, seed, 5, 2);
    for (let c = 0; c < n; c++) {
      // direction on the sphere, fewer underneath
      let d;
      do { d = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)); } while (d.lengthSq() > 1 || d.lengthSq() < 0.01);
      d.normalize();
      if (d.y < -0.4 && r.next() < 0.6) d.y = -d.y * 0.5;
      d.normalize();
      const rad = depth > 0 ? shell - depth * Math.pow(r.next(), 0.6) : shell;
      const l = lump([d.x, d.y, d.z], seed * 31 + mi, 0.18);
      const p = new THREE.Vector3(m.centre[0] + d.x * m.radii[0] * rad * l, m.centre[1] + d.y * m.radii[1] * rad * l, m.centre[2] + d.z * m.radii[2] * rad * l);
      const en = ellipsoidNormal(m, p.toArray());
      // card plane: its normal half towards the mass normal, half random
      const cn = en.clone().multiplyScalar(outward).add(new THREE.Vector3(r.range(-1, 1), r.range(-0.6, 1), r.range(-1, 1)).multiplyScalar(1 - outward * 0.6)).normalize();
      // tip direction: outward + up, projected into the card plane
      let tip = en.clone().add(new THREE.Vector3(0, 0.6, 0)).add(new THREE.Vector3(r.range(-0.8, 0.8), r.range(-0.4, 0.4), r.range(-0.8, 0.8)));
      tip.addScaledVector(cn, -tip.dot(cn));
      if (tip.lengthSq() < 1e-4) tip = new THREE.Vector3().crossVectors(cn, new THREE.Vector3(1, 0, 0));
      tip.normalize();
      const side = new THREE.Vector3().crossVectors(tip, cn).normalize();
      const s = mean * size * r.range(0.75, 1.25);
      const base = p.clone().addScaledVector(tip, -s * 0.35);
      const corners = [
        base.clone().addScaledVector(side, -s * 0.5), base.clone().addScaledVector(side, s * 0.5),
        base.clone().addScaledVector(side, s * 0.5).addScaledVector(tip, s), base.clone().addScaledVector(side, -s * 0.5).addScaledVector(tip, s),
      ];
      const cuv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const v0 = pos.length / 3;
      // billboard (round 3): the card centre + its corner offset, turned to the camera in the vertex shader
      const centre = base.clone().addScaledVector(tip, s * 0.5);
      for (const [cu, cv] of cuv) { centres.push(centre.x, centre.y, centre.z); offsets.push((cu - 0.5) * s, (cv - 0.5) * s); }
      const depthLight = clamp01(ellipsoidDistance(m, p.toArray()));
      corners.forEach((q, k) => {
        pos.push(q.x, q.y, q.z);
        const vn = ellipsoidNormal(m, q.toArray()).multiplyScalar(bend).addScaledVector(cn, 1 - bend).normalize();
        nor.push(vn.x, vn.y, vn.z);
        uvs.push(...cuv[k]);
        const pa = new Float32Array(4);
        paintAttr(pa, 0, q.toArray(), masses, mi, crown, depthLight * (1 - cardTip) + cuv[k][1] * cardTip, rnd);
        pa[1] = clamp01(pa[1] + (1 - depthLight) * 0.6);
        paint.push(...pa);
      });
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  if (billboard) {
    g.setAttribute('aCentre', new THREE.Float32BufferAttribute(centres, 3));
    g.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 2));
  }
  g.setIndex(idx);
  return g;
}

/** Camera-facing cards (trees are not rotated, so camera right / up in world = tree space directions). */
function billboardPosition() {
  const c = attribute('aCentre', 'vec3'), o = attribute('aOffset', 'vec2');
  return c.add(cameraWorldMatrix[0].xyz.mul(o.x)).add(cameraWorldMatrix[1].xyz.mul(o.y));
}

/**
 * Tier: one drooping fan-shaped spray per first-level conifer branch (tree space, unscaled).
 * u across the fan, v from the trunk out to the tip.
 */
function tierGeometry(data, leafData, crownTop, { span = 2.3, droop = 0.35, reachScale = 1.1, cup = 0.18, seed = 4, layers = 1 } = {}) {
  const r = createRandom(seed);
  const pos = [], uvs = [], paint = [], idx = [];
  const branches = data.skeleton.branches.filter((b) => b.level === 1);
  const trunk = data.skeleton.branches.find((b) => b.level === 0);
  const trunkTop = trunk.points[trunk.points.length - 1].position[1];
  const heights = branches.map((b) => b.points[0].position[1]);
  const lo = Math.min(...heights);
  const U = 10, V = 7;
  /** A fan from `p0` outward along azimuth `ang0`, `len` long, its tips `rise` higher than its base (before droop). */
  const fan = (p0, ang0, len, rise, spanMul, droopMul) => {
    const hRel = clamp01((p0.y - lo) / (trunkTop - lo));
    const sp = span * spanMul;
    const v0 = pos.length / 3;
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      for (let i = 0; i <= U; i++) {
        const u = i / U;
        const a = ang0 + (u - 0.5) * sp;
        const rr = 0.02 + v * len;
        const y = p0.y + rise * v - droop * droopMul * len * v * v - cup * len * v * (2 * (u - 0.5)) ** 2;
        pos.push(p0.x + Math.cos(a) * rr, y, p0.z + Math.sin(a) * rr);
        uvs.push(u, v);
        paint.push(clamp01((y - lo) / (crownTop - lo)), (1 - v) ** 1.5 * 0.65 * (1 - hRel * 0.5), v, hash3(i, j, v0, seed));
      }
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
      const a = v0 + j * (U + 1) + i, b2 = a + 1, c = a + U + 1, d = c + 1;
      idx.push(a, b2, c, b2, d, c);
    }
  };
  for (const b of branches) {
    const p0 = new THREE.Vector3(...b.points[0].position);
    // the reach of the branch's needles (its whole sub-tree), measured from the trunk
    const own = leafData.skeleton.leaves.filter((l) => l.branch === b.path || l.branch.startsWith(b.path + '.'));
    let reach = 0, dy = 0;
    for (const l of own) { reach = Math.max(reach, Math.hypot(l.position[0] - p0.x, l.position[2] - p0.z)); dy += (l.position[1] - p0.y) / own.length; }
    const pe = b.points[b.points.length - 1].position;
    if (!own.length) reach = Math.hypot(pe[0] - p0.x, pe[2] - p0.z);
    const ang0 = Math.atan2(b.direction[2], b.direction[0]);
    const len = reach * reachScale * r.range(0.92, 1.08);
    fan(p0, ang0, len, Math.max(0, dy) * 0.8, 1, 1);
    if (layers > 1) fan(p0.clone().add(new THREE.Vector3(0, len * 0.12, 0)), ang0 + r.range(-0.5, 0.5), len * 0.7, Math.max(0, dy) * 0.6, 0.8, 0.8);
  }
  // a small leader on top
  const top = new THREE.Vector3(...trunk.points[trunk.points.length - 1].position);
  for (let k = 0; k < 3; k++) fan(top.clone().add(new THREE.Vector3(0, -0.5, 0)), k * 2.1, 0.9, 0.5, 1, 0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // bend: upward-outward, the Tier lit as one soft umbrella
  const n = g.attributes.normal, p = g.attributes.position;
  const axis = new THREE.Vector3(...trunk.points[0].position);
  for (let i = 0; i < n.count; i++) {
    const own = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
    if (own.y < 0) own.negate();
    const outward = new THREE.Vector3(p.getX(i) - axis.x, 0, p.getZ(i) - axis.z).normalize().multiplyScalar(0.6).add(new THREE.Vector3(0, 1, 0)).normalize();
    own.lerp(outward, 0.7).normalize();
    n.setXYZ(i, own.x, own.y, own.z);
  }
  return g;
}

// ================================================================ painted leaf material (TSL)

const sunUniform = uniform(SUN_DIR.clone());

/**
 * The painted gradient: deep cool green inside / under, the leaf colour in the middle, warm
 * yellow-green on sunlit tips and tops. `t` = 0..1 (built from height, facing, sun and occlusion).
 */
function paletteNodes(base, saturation = 1) {
  const deep = base.clone().multiply(new THREE.Color(0.22, 0.32, 0.45)).lerp(new THREE.Color('#0b2427'), 0.35);
  const mid = base.clone().multiplyScalar(1.12);
  const tip = base.clone().lerp(new THREE.Color('#bcd24a'), 0.5).multiplyScalar(1.1);
  return { deep: color(desaturate(deep, saturation)), mid: color(desaturate(mid, saturation)), tip: color(desaturate(tip, saturation)) };
}
/** Saturation control: mixes a (linear) colour towards its luminance; 1 = unchanged, 0 = grey. */
function desaturate(c, s) {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return new THREE.Color(l + (c.r - l) * s, l + (c.g - l) * s, l + (c.b - l) * s);
}
const ramp = (pal, t) => mix(mix(pal.deep, pal.mid, smoothstep(0.0, 0.55, t)), pal.tip, smoothstep(0.5, 1.0, t));

/** Triplanar sample of a tileable texture in world space. */
function triplanar(tex, scale) {
  const p = positionWorld.mul(scale);
  const n = abs(normalLocal);
  const w = n.pow(vec3(4)).toVar();
  const ws = w.div(w.x.add(w.y).add(w.z));
  return texture(tex, p.zy).mul(ws.x).add(texture(tex, p.xz).mul(ws.y)).add(texture(tex, p.xy).mul(ws.z));
}

/**
 * Leaf material for every concept. `paint`: tv (value 0..1), ta (coverage 0..1) nodes from the
 * concept's texture, `gradient` / `texture` strengths, `edgeCut` (A: ragged noise cut at the silhouette).
 */
function paintedLeafMaterial({ base, saturation = 1, gradient = 0.8, textureStrength = 0.6, tv, ta, edgeCut = 0, alphaTest = 0, bentNormals = false, sunWeight = 0.35, insideDark = true, wrap }) {
  const m = new PaintedMaterial();
  if (wrap !== undefined) m.userData.wrap = wrap;
  m.side = THREE.DoubleSide;
  m.userData.treePart = 'leaves';
  const pal = paletteNodes(base, saturation);
  const pa = attribute('aPaint', 'vec4');
  const h = pa.x, occ = pa.y, tipL = pa.z, rnd = pa.w;
  const nW = normalize(normalLocal); // trees are not rotated: local = world directions
  const up = nW.y.mul(0.5).add(0.5);
  const sunF = dot(nW, sunUniform).mul(0.5).add(0.5);
  let t = float(-0.06).add(h.mul(0.2)).add(up.mul(0.34)).add(sunF.mul(sunWeight)).add(tipL.sub(0.5).mul(0.25)).sub(occ.mul(0.6));
  t = t.add(tv.sub(0.5).mul(0.9 * textureStrength));
  t = t.sub(0.5).mul(gradient).add(0.5).clamp(0, 1); // gradient strength = contrast of the painted ramp
  let col = ramp(pal, t).mul(rnd.sub(0.5).mul(0.12).add(1));
  // gaps between painted leaves are a little darker (the texture's coverage)
  col = col.mul(mix(float(1), float(0.6), float(1).sub(ta).mul(textureStrength)));
  // back faces (seen through the ragged edge / under cards) are the cool, dark inside
  col = insideDark ? select(frontFacing, col, mix(pal.deep, pal.mid, 0.25)) : col;
  m.colorNode = vec4(col, 1);
  if (bentNormals) m.normalNode = transformNormalToView(normalLocal).normalize(); // no back-face flip: lit as the mass
  if (edgeCut > 0) {
    m.side = THREE.FrontSide; // holes in the edge show what is behind the mass: a ragged outline
    const facing = abs(dot(normalView, positionViewDirection));
    const edge = smoothstep(0.75, 0.1, facing).mul(edgeCut);
    m.maskNode = ta.mul(0.75).add(tv.mul(0.25)).greaterThan(edge);
  }
  if (alphaTest > 0) m.maskNode = ta.greaterThan(alphaTest);
  m.roughness = 1; m.metalness = 0;
  return m;
}

function paintedBarkMaterial(type, tint, saturation = 1) {
  const m = new PaintedMaterial();
  m.userData.treePart = 'bark';
  const tex = barkTexture(type);
  const raw = texture(tex, uv().mul(vec2(1, 3))).rgb.mul(color(tint));
  const c = mix(vec3(dot(raw, vec3(0.2126, 0.7152, 0.0722))), raw, float(saturation));
  m.colorNode = vec4(mix(c.mul(0.6), c, uv().y.clamp(0, 1).pow(0.4)), 1);
  m.roughness = 1; m.metalness = 0;
  return m;
}

// ================================================================ looks per tree

const TEX = {};
const tex = (key, make) => (TEX[key] ??= make());

/** Painterly-height wood (stylized wood mesh, painted bark) as a Group in tree space. */
async function paintedWood(entry, { prune = false, saturation = 1 } = {}) {
  const definition = stylized.apply(entry.species);
  // Tier: only the trunk as wood (the Tiers stand in for the branches)
  if (prune) definition.branches = [];
  const t = createTree(definition, { seed: SEED, season: SEASON });
  await t.ready;
  t.leaves.visible = false;
  t.fruit.visible = false;
  const type = entry.species.bark.type;
  const tint = type === 'papery' ? '#ffffff' : '#ffffff';
  t.wood.material = paintedBarkMaterial(type, tint, saturation);
  return t;
}

function heightScale(t, height) {
  const box = new THREE.Box3().setFromObject(t);
  return height / box.max.y;
}

const MASS_COUNT = { oak: 5, birch: 4, pine: 6, spruce: 6, maple: 5, cherry: 5, olive: 4, elm: 5, cedar: 5, 'douglas-fir': 6, redwood: 7 };
const massCount = (species) => MASS_COUNT[species.id] ?? (species.form === 'conifer' ? 6 : 5);

/**
 * Shared builder settings of B and D (and their hybrids). B = a core per Leaf Mass + a shell of cards,
 * D = no core, more clumps, cards filling the clump. `clumps` = extra masses over the Species' default,
 * `core` = core scale (0 = no core), `size` = card size relative to the mass, `depth` = how far cards
 * fill inwards (0 = on the shell).
 */
const B_DEFAULTS = { clumps: 0, core: 0.86, shell: 0.92, depth: 0, size: 0.5, bend: 0.9, outward: 0.75, cardSeed: 6, maxCards: 200 };
const D_DEFAULTS = { clumps: 3, core: 0, shell: 1.0, depth: 0.75, size: 0.8, outward: 0.4, cardSeed: 8, maxCards: 600, bend: 0.85 };

/** The per-concept settings of each variant. */
const LOOKS = {
  A: [
    { name: 'A · soft (gradient 0.7, texture 0.35, edge 0.6)', gradient: 0.7, texture: 0.35, edge: 0.6 },
    { name: 'A · medium (gradient 1, texture 0.6, edge 0.9)', gradient: 1, texture: 0.6, edge: 0.9 },
    { name: 'A · strong (gradient 1.4, texture 0.9, edge 1.2)', gradient: 1.4, texture: 0.9, edge: 1.2 },
  ],
  B: [
    { name: 'B · soft (40 cards / mass, gradient 0.7)', gradient: 0.7, texture: 0.4, cards: 40 },
    { name: 'B · medium (70 cards / mass, gradient 1)', gradient: 1, texture: 0.6, cards: 70 },
    { name: 'B · strong (110 cards / mass, gradient 1.4)', gradient: 1.4, texture: 0.9, cards: 110 },
  ],
  D: [
    { name: 'D · soft (110 cards / clump, gradient 0.7, bend 0.7)', gradient: 0.7, texture: 0.4, cards: 110, bend: 0.7 },
    { name: 'D · medium (160 cards / clump, gradient 1, bend 0.85)', gradient: 1, texture: 0.6, cards: 160, bend: 0.85 },
    { name: 'D · strong (220 cards / clump, gradient 1.4, bend 1)', gradient: 1.4, texture: 0.9, cards: 220, bend: 1 },
  ],
  // more B variants (medium = gradient 1, texture 0.6, 70 cards / mass, card size 0.5, Species' mass count)
  Bmore: [
    { name: 'B1 · dense small cards (140 / mass, size 0.35)', gradient: 1, texture: 0.6, cards: 140, size: 0.35 },
    { name: 'B2 · sparse big cards (30 / mass, size 0.75)', gradient: 1, texture: 0.6, cards: 30, size: 0.75 },
    { name: 'B3 · more, smaller masses (+3 masses, 60 cards)', gradient: 1, texture: 0.6, cards: 60, clumps: 3 },
    { name: 'B4 · fewer, bigger masses (-2 masses, 90 cards)', gradient: 1, texture: 0.6, cards: 90, clumps: -2 },
    { name: 'B5 · flat gradient (0.5, texture 0.5)', gradient: 0.5, texture: 0.5, cards: 70 },
    { name: 'B6 · bold gradient (1.7, texture 0.8)', gradient: 1.7, texture: 0.8, cards: 70 },
  ],
  // more D variants (medium = gradient 1, texture 0.6, 160 cards / clump, card size 0.8, mass count + 3, bend 0.85)
  Dmore: [
    { name: 'D1 · dense small cards (300 / clump, size 0.55)', gradient: 1, texture: 0.6, cards: 300, size: 0.55 },
    { name: 'D2 · sparse big cards (80 / clump, size 1.1)', gradient: 1, texture: 0.6, cards: 80, size: 1.1 },
    { name: 'D3 · few clumps (Species count, 220 cards)', gradient: 1, texture: 0.6, cards: 220, clumps: 0 },
    { name: 'D4 · many small clumps (+7, 110 cards)', gradient: 1, texture: 0.6, cards: 110, clumps: 7 },
    { name: 'D5 · flat gradient (0.5, texture 0.5)', gradient: 0.5, texture: 0.5, cards: 160 },
    { name: 'D6 · bold gradient (1.7, texture 0.8, bend 1)', gradient: 1.7, texture: 0.8, cards: 160, bend: 1 },
    { name: 'D7 · cards on the outside (depth 0.3, fuller outline)', gradient: 1, texture: 0.6, cards: 160, depth: 0.3 },
  ],
  // B/D hybrids: D-style clumps and cards with a (small) core that fills the holes
  BD: [
    { name: 'BD1 · D clumps + small hidden core (0.55)', concept: 'D', gradient: 1, texture: 0.6, cards: 160, core: 0.55 },
    { name: 'BD2 · B masses + deep D cards (core 0.7, depth 0.5, size 0.65)', concept: 'B', gradient: 1, texture: 0.6, cards: 110, core: 0.7, shell: 1.0, depth: 0.5, size: 0.65, outward: 0.55 },
    { name: 'BD3 · in-between (+1 mass, core 0.75, 100 cards, size 0.6)', concept: 'B', gradient: 1, texture: 0.6, cards: 100, clumps: 1, core: 0.75, shell: 0.97, depth: 0.3, size: 0.6, outward: 0.6 },
  ],
  // Round 3 (smooth): no brush texture; smooth round cards (discTexture), smooth scalloped cores
  // (scallopMassGeometry), soft wrap 0.8 and only a weak, smooth dome value from the card (texture 0.3).
  smooth: [
    { name: 'S1 · B core + smooth circular cards (50 / mass, size 0.6)', concept: 'B', smooth: true, gradient: 1, texture: 0.2, cards: 50, size: 0.6 },
    { name: 'S2 · D7-style clumps of smooth circles (110 / clump, depth 0.3)', concept: 'D', smooth: true, gradient: 1, texture: 0.2, cards: 110, depth: 0.3, size: 0.85 },
    { name: 'S3 · BD1-style: smooth circles + small hidden core (0.55)', concept: 'D', smooth: true, gradient: 1, texture: 0.2, cards: 110, core: 0.55, size: 0.85 },
    { name: 'S4 · smooth mass only, scalloped circular edge (no cards)', concept: 'B', smooth: true, gradient: 1, texture: 0, cards: 0, core: 1 },
    { name: 'S5 · S3 with many small circles (220 / clump, size 0.55)', concept: 'D', smooth: true, gradient: 1, texture: 0.2, cards: 220, core: 0.55, size: 0.55 },
    { name: 'S6 · S3 with few big circles (50 / clump, size 1.2)', concept: 'D', smooth: true, gradient: 1, texture: 0.2, cards: 50, core: 0.55, size: 1.2 },
    { name: 'S7 · S3 with a softer gradient (0.6, wrap 1)', concept: 'D', smooth: true, gradient: 0.6, texture: 0.1, cards: 110, core: 0.55, size: 0.85, wrap: 1 },
    { name: 'S8 · S3 with a bolder gradient (1.5)', concept: 'D', smooth: true, gradient: 1.5, texture: 0.2, cards: 110, core: 0.55, size: 0.85 },
  ],
  Tier: [
    { name: 'Tier · soft (gradient 0.7, droop 0.25)', gradient: 0.7, texture: 0.4, droop: 0.25 },
    { name: 'Tier · medium (gradient 1, droop 0.35)', gradient: 1, texture: 0.6, droop: 0.35 },
    { name: 'Tier · strong (gradient 1.4, droop 0.5, 2 layers)', gradient: 1.4, texture: 0.9, droop: 0.5, layers: 2 },
    { name: 'Tier · medium on a spruce (cone-shaped conifer, for comparison)', gradient: 1, texture: 0.6, droop: 0.35, spruce: true },
  ],
};

/** Builds one tree of the cluster in a look: 'stylized' | 'realistic' | { concept, ...settings }. */
async function buildTree(entry, look) {
  const species = entry.species;
  let group;
  if (look === 'stylized' || look === 'realistic') {
    const style = look === 'stylized' ? stylized : realistic;
    group = createTree(style.apply(species), { seed: SEED, season: SEASON });
    await group.ready;
  } else {
    group = await paintedWood(entry, { prune: look.concept === 'Tier' && species.form === 'conifer', saturation: look.saturation ?? 1 });
    const base = trackColor(species.season.leafColor, SEASON);
    const cloud = leafCloud(species);
    const isPine = species.form === 'conifer';
    if (look.concept === 'Tier' && species.form === 'conifer') {
      const data = generateTree(stylized.apply(species), SEED);
      const leafData = generateTree(realistic.apply(species), SEED);
      const top = Math.max(...cloud.map((p) => p[1]));
      const tierTex = tex('tier', () => tierTexture());
      const g = tierGeometry(data, leafData, top, { droop: look.droop, layers: look.layers ?? 1 });
      const tt = texture(tierTex, uv());
      const m = paintedLeafMaterial({ base, gradient: look.gradient, textureStrength: look.texture, tv: tt.r, ta: tt.a, alphaTest: 0.5, bentNormals: true, sunWeight: 0.3 });
      const mesh = new THREE.Mesh(g, m);
      group.add(mesh);
    } else {
      const concept = look.concept === 'Tier' ? 'A' : look.concept;
      const settings = look.concept === 'Tier' ? LOOKS.A[1] : look;
      const bd = concept === 'B' ? { ...B_DEFAULTS, ...look } : concept === 'D' ? { ...D_DEFAULTS, ...look } : null;
      const k = Math.max(2, massCount(species) + (bd ? bd.clumps : 0));
      const masses = leafMasses(cloud, k, 7, isPine ? 1.8 : 1);
      const crown = crownStats(masses);
      const massTex = tex('mass', () => leafMassTexture());
      const sprayTex = tex(isPine ? 'needleSpray' : 'spray', () => sprayTexture(256, isPine ? 9 : 5, isPine));
      const mean = (masses.reduce((s, m) => s + m.radii[0], 0) / masses.length);
      const texScale = 1 / (mean * 2.6);
      if (concept === 'A' || concept === 'C') {
        const tp = triplanar(massTex, texScale);
        const m = paintedLeafMaterial({ base, gradient: settings.gradient, textureStrength: settings.texture, tv: tp.r, ta: tp.a, edgeCut: settings.edge });
        group.add(new THREE.Mesh(massGeometry(masses, crown, { seed: 3, lumpAmount: 0.26 }), m));
      }
      if (bd) {
        const saturation = look.saturation ?? 1;
        if (bd.smooth) {
          const wrap = bd.wrap ?? 0.8;
          if (bd.core > 0) {
            const core = paintedLeafMaterial({ base, saturation, gradient: settings.gradient, textureStrength: 0, tv: float(0.5), ta: float(1), wrap });
            group.add(new THREE.Mesh(scallopMassGeometry(masses, crown, { seed: 3, scale: bd.core, lobes: isPine ? 12 : 16 }), core));
          }
          if (bd.cards > 0) {
            const dt = texture(tex('disc', () => discTexture()), uv());
            const cards = paintedLeafMaterial({ base, saturation, gradient: settings.gradient, textureStrength: settings.texture, tv: dt.r, ta: dt.a, alphaTest: 0.5, bentNormals: true, insideDark: false, wrap });
            cards.positionNode = billboardPosition(); // always round: discs face the camera
            group.add(new THREE.Mesh(cardGeometry(masses, crown, { perMass: bd.cards, shell: bd.shell, depth: bd.depth, size: bd.size, seed: bd.cardSeed, bend: 1, outward: bd.outward, maxCards: bd.maxCards, billboard: true, cardTip: 0.15 }), cards));
          }
        } else if (bd.core > 0) {
          const tp = triplanar(massTex, texScale);
          const core = paintedLeafMaterial({ base, saturation, gradient: settings.gradient, textureStrength: settings.texture, tv: tp.r, ta: tp.a });
          group.add(new THREE.Mesh(massGeometry(masses, crown, { seed: 3, scale: bd.core }), core));
        }
        if (!bd.smooth) {
        const st = texture(sprayTex, uv());
        const cards = paintedLeafMaterial({ base, saturation, gradient: settings.gradient, textureStrength: settings.texture, tv: st.r, ta: st.a, alphaTest: 0.5, bentNormals: true, insideDark: false });
        group.add(new THREE.Mesh(cardGeometry(masses, crown, { perMass: bd.cards, shell: bd.shell, depth: bd.depth, size: bd.size, seed: bd.cardSeed, bend: bd.bend, outward: bd.outward, maxCards: bd.maxCards }), cards));
        }
      }
    }
  }
  group.scale.setScalar(heightScale(group, entry.height));
  group.position.set(...entry.position);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = o.material.userData.treePart !== 'leaves' || typeof look === 'string'; } });
  return group;
}

// ================================================================ stage and views

const VIEWS = [
  { name: 'tycoon (55°)', elevation: 55, azimuth: 28, fov: 30, margin: 0.95, y: 1.7 },
  { name: 'top-down (90°)', elevation: 90, azimuth: 0, fov: 30, margin: 0.95 },
  { name: '3/4 (20°)', elevation: 20, azimuth: 28, fov: 30, margin: 0.95, y: 1.25 },
];

function makeStage() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe0ea');
  const hemi = new THREE.HemisphereLight('#d6e6ff', '#7d8a55', 1.25);
  const sun = new THREE.DirectionalLight('#ffe3b8', 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = c.bottom = -6; c.right = c.top = 6; c.near = 1; c.far = 40;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new PaintedMaterial({ color: '#86a957' }));
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
  return { renderer, scene, camera, sun };
}

const TARGET = new THREE.Vector3(0.05, 1.2, -0.2); // the cluster's box centre (x, z)
const RADIUS = 3.7;
/** Framing of the scene: the cluster's fixed one, or fitted to the trees (solo Species, grove). */
let frame = { target: TARGET, radius: RADIUS, height: 3.4 };

function fitFrame(trees) {
  const box = new THREE.Box3();
  for (const t of trees) box.expandByObject(t);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const single = trees.length === 1;
  frame = { target: c, radius: Math.max(sz.x, sz.z, sz.y * (single ? 0.9 : 0.8)) * 0.5 * (single ? 1.3 : 1.0), height: single ? sz.y : 3.4, single };
}

function setView(camera, view) {
  const el = (view.elevation * Math.PI) / 180, az = (view.azimuth * Math.PI) / 180;
  camera.fov = view.fov; camera.updateProjectionMatrix();
  const vFov = (view.fov * Math.PI) / 360;
  const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  // single trees: aim at the box centre (tall, narrow trees like the redwood were clipped at the top in 3/4)
  const ty = frame.single && view.y ? frame.target.y * (view.elevation < 45 ? 1.05 : 1) : ((view.y ?? 0) * frame.height) / 3.4;
  const target = new THREE.Vector3(frame.target.x, ty, frame.target.z);
  const r = view.elevation === 90 ? frame.radius * (4.4 / 3.7) : frame.radius;
  const dist = (r / Math.sin(Math.min(vFov, hFov))) * view.margin;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  camera.up.set(0, 1, 0);
  if (view.elevation === 90) camera.up.set(-Math.sin(az), 0, -Math.cos(az));
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
}

// ================================================================ concept C: Kuwahara as a Tree Effect

/** Kuwahara filter (4 quadrants, pick the least varying mean) on leaf pixels only. */
function kuwaharaEffect(radius) {
  return {
    before: 'grade',
    build(input) {
      const src = convertToTexture(input.color);
      const px = vec2(1).div(screenSize);
      const R = radius;
      const quads = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(() => ({ sum: vec3(0), sq: vec3(0), n: 0 }));
      const samples = {};
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
        if (x * x + y * y > R * R + R) continue; // round brush, no square blocks
        const s = src.sample(screenUV.add(px.mul(vec2(x, y)))).rgb;
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([qx, qy], qi) => {
          if (x * qx >= 0 && y * qy >= 0) { const q = quads[qi]; q.sum = q.sum.add(s); q.sq = q.sq.add(s.mul(s)); q.n++; }
        });
      }
      let best = null, bestVar = null;
      for (const q of quads) {
        const mean = q.sum.div(q.n);
        const v = q.sq.div(q.n).sub(mean.mul(mean));
        const variance = v.x.add(v.y).add(v.z);
        if (!best) { best = mean; bestVar = variance; }
        else { const better = variance.lessThan(bestVar); best = select(better, mean, best); bestVar = select(better, variance, bestVar); }
      }
      const mask = input.mask.sample(screenUV).r; // every tree pixel (leaves and bark)
      return { node: vec4(mix(input.color.rgb, best, mask), input.color.a), update() {} };
    },
  };
}

// ================================================================ concepts

const CONCEPTS = {
  current: { variants: ['Current · stylized', 'Current · realistic'], looks: ['stylized', 'realistic'] },
  A: { variants: LOOKS.A.map((l) => l.name), looks: LOOKS.A.map((l) => ({ concept: 'A', ...l })) },
  B: { variants: LOOKS.B.map((l) => l.name), looks: LOOKS.B.map((l) => ({ concept: 'B', ...l })) },
  C: {
    variants: ['C · A medium + Kuwahara r = 2', 'C · A medium + Kuwahara r = 3', 'C · A medium + Kuwahara r = 5'],
    looks: [2, 3, 5].map((radius) => ({ concept: 'C', ...LOOKS.A[1], kuwahara: radius })),
  },
  D: { variants: LOOKS.D.map((l) => l.name), looks: LOOKS.D.map((l) => ({ concept: 'D', ...l })) },
  'B-more': { variants: LOOKS.Bmore.map((l) => l.name), looks: LOOKS.Bmore.map((l) => ({ concept: 'B', ...l })) },
  'D-more': { variants: LOOKS.Dmore.map((l) => l.name), looks: LOOKS.Dmore.map((l) => ({ concept: 'D', ...l })) },
  BD: { variants: LOOKS.BD.map((l) => l.name), looks: LOOKS.BD.map((l) => ({ ...l })) },
  saturation: {
    variants: [['B', 1], ['B', 0.85], ['B', 0.7], ['D', 1], ['D', 0.85], ['D', 0.7]].map(([c, s]) => `${c} medium · saturation ${s}`),
    looks: [['B', 1], ['B', 0.85], ['B', 0.7], ['D', 1], ['D', 0.85], ['D', 0.7]].map(([c, s]) => ({ concept: c, ...LOOKS[c][1], saturation: s })),
  },
  'species-B': {
    variants: SPECIES_ROWS.map((e) => `B medium · ${e.species.name} (${e.height} m)`),
    looks: SPECIES_ROWS.map((e) => ({ concept: 'B', ...LOOKS.B[1], trees: [{ ...e, position: [0, 0, 0] }] })),
  },
  'species-D': {
    variants: SPECIES_ROWS.map((e) => `D medium · ${e.species.name} (${e.height} m)`),
    looks: SPECIES_ROWS.map((e) => ({ concept: 'D', ...LOOKS.D[1], trees: [{ ...e, position: [0, 0, 0] }] })),
  },
  grove: {
    variants: ['Grove · B medium', 'Grove · D medium', 'Grove · B medium, saturation 0.85', 'Grove · D medium, saturation 0.85', 'Grove · B medium, saturation 0.7', 'Grove · D medium, saturation 0.7'],
    looks: [['B', 1], ['D', 1], ['B', 0.85], ['D', 0.85], ['B', 0.7], ['D', 0.7]].map(([c, s]) => ({ concept: c, ...LOOKS[c][1], saturation: s, trees: GROVE, grove: true })),
  },
  // Round 3: smooth circular variants
  smooth: { variants: LOOKS.smooth.map((l) => l.name), looks: LOOKS.smooth.map((l) => ({ ...l })) },
  'smooth-compare': {
    variants: [LOOKS.BD[0].name + ' (round 2)', LOOKS.smooth[2].name, LOOKS.Dmore[6].name + ' (round 2)', LOOKS.smooth[1].name],
    looks: [{ ...LOOKS.BD[0] }, { ...LOOKS.smooth[2] }, { concept: 'D', ...LOOKS.Dmore[6] }, { ...LOOKS.smooth[1] }],
  },
  'smooth-saturation': {
    variants: [[1, 1], [1, 0.85], [2, 1], [2, 0.85], [3, 1], [3, 0.85]].map(([i, sat]) => `${LOOKS.smooth[i].name.split(' · ')[0]} · saturation ${sat}`),
    looks: [[1, 1], [1, 0.85], [2, 1], [2, 0.85], [3, 1], [3, 0.85]].map(([i, sat]) => ({ ...LOOKS.smooth[i], saturation: sat })),
  },
  'smooth-grove': {
    variants: [[0, 1], [1, 1], [2, 1], [3, 1], [1, 0.85], [2, 0.85]].map(([i, sat]) => `Grove · ${LOOKS.smooth[i].name.split(' · ')[0]}, saturation ${sat}`),
    looks: [[0, 1], [1, 1], [2, 1], [3, 1], [1, 0.85], [2, 0.85]].map(([i, sat]) => ({ ...LOOKS.smooth[i], saturation: sat, trees: GROVE, grove: true })),
  },
  'smooth-species': {
    variants: SPECIES_ROWS.map((e) => `S3 · ${e.species.name} (${e.height} m)`),
    looks: SPECIES_ROWS.map((e) => ({ ...LOOKS.smooth[2], trees: [{ ...e, position: [0, 0, 0] }] })),
  },
  tier: {
    variants: LOOKS.Tier.map((l) => `${l.name}\n(oak, birch: A medium)`),
    looks: LOOKS.Tier.map((l) => ({ concept: 'Tier', ...l })),
  },
};

async function main() {
  if (params.get('list') !== null) {
    window.concept = { status: 'rendered', list: Object.fromEntries(Object.entries(CONCEPTS).map(([k, c]) => [k, c.variants])), views: VIEWS.map((v) => v.name) };
    return;
  }
  const name = params.get('c') ?? 'A';
  const v = Number(params.get('v') ?? 0);
  const concept = CONCEPTS[name];
  if (!concept) throw new Error(`Unknown concept "${name}"`);
  const look = concept.looks[v];
  const s = makeStage();
  const trees = [];
  for (const entry of look.trees ?? CLUSTER) trees.push(await buildTree(look.spruce && entry.species === pine ? { ...entry, species: spruce } : entry, look));
  s.scene.add(...trees);
  if (look.trees) fitFrame(trees);
  if (look.grove) { const c = s.sun.shadow.camera; c.left = c.bottom = -8; c.right = c.top = 8; c.updateProjectionMatrix(); }
  await s.renderer.init();
  let render = () => s.renderer.render(s.scene, s.camera);
  if (look.kuwahara) {
    const effects = createTreeEffects(s.renderer, s.scene, s.camera, { effects: null });
    effects.addEffect(kuwaharaEffect(look.kuwahara));
    render = () => effects.render();
  }
  window.showView = async (i) => {
    setView(s.camera, VIEWS[i]);
    labelEl.textContent = `${concept.variants[v]}\n${VIEWS[i].name}`;
    for (let f = 0; f < 3; f++) { render(); await new Promise(requestAnimationFrame); }
  };
  await window.showView(Number(params.get('view') ?? 0));
  window.concept = { status: 'rendered', variants: concept.variants, views: VIEWS.map((x) => x.name) };
}

main().catch((error) => {
  console.error(error);
  labelEl.textContent = String(error?.message ?? error);
  window.concept = { status: 'error', error: String(error?.stack ?? error) };
});
