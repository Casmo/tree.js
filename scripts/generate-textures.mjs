/* global Buffer, URL, console, process */
// Generates the realistic Style's textures procedurally, so every image in the package is our own
// (MIT, like the code). Deterministic: the same script always writes the same bytes.
//
//   node scripts/generate-textures.mjs [outDir]
//
// Output (assets/textures/realistic/ by default, shipped as dist/textures/realistic/), one set per
// Bark Type and Leaf Type (src/styles/realistic/textures.ts maps the types to these files):
//   bark.png         256x256 RGB   furrowed bark colour, tileable (furrows running along the branch)
//   bark-normal.png  256x256 RGB   tangent-space normal map of the same furrows
//   bark-smooth[-normal].png       smooth bark: grey, mottled, faint wrinkles (beech)
//   bark-papery[-normal].png       papery bark: white with dark lenticel dashes and patches (birch)
//   bark-fibrous[-normal].png      fibrous bark: red-brown stringy ridges (redwood)
//   bark-plated[-normal].png       plated bark: flaky plates between dark cracks (pine)
//   leaf.png         256x256 RGBA  broad Leaf Type card: a twig with leaflets, alpha cut-out, light grey-green
//                                  (the Season Profile's leaf colour multiplies every leaf card)
//   leaf-lobed.png   256x256 RGBA  lobed (oak) leaves on a twig
//   leaf-palmate.png 256x256 RGBA  palmate (maple) leaves on long stalks
//   leaf-compound.png 256x256 RGBA a compound pinnate leaf (ash / walnut / hickory)
//   needles.png      256x256 RGBA  needle Leaf Type card: a twig with needles, alpha cut-out
//   scale.png        256x256 RGBA  scale Leaf Type card: a flat spray of scale-leaved shoots (cedar / juniper)
//
// Leaf cards are drawn inside the 'card' leaf shape's diamond UVs: stem at (0.5, 0), widest at
// v = 0.4, tip at (0.5, 1). v = 0 is the bottom image row (three.js flips images on upload).
// A card is half as wide as it is long (LEAF_WIDTH in src/generator/leaves.ts), so the drawing is
// made in card units (x across, centred, -0.25..0.25; v along, 0..1) and stretched to fill u.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL('../assets/textures/realistic/', import.meta.url);
const SIZE = 256;

// ---------- PNG ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** Encodes 8-bit RGB (channels 3) or RGBA (channels 4) pixels, rows top to bottom. */
function png(width, height, channels, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1; // filter: Sub
    for (let x = 0; x < stride; x++) {
      const v = pixels[y * stride + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      raw[y * (stride + 1) + 1 + x] = (v - left) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- noise ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Periodic value noise on a px x py lattice (tiles over 0..1 in both directions). */
function periodicNoise(px, py, seed) {
  const rand = mulberry32(seed);
  const lattice = Float32Array.from({ length: px * py }, rand);
  const at = (i, j) => lattice[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * px;
    const y = v * py;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const byte = (x) => Math.round(clamp01(x) * 255);

// ---------- bark ----------
function barkHeight() {
  // Furrows: 1D noise across the branch (u), warped sideways along v, turned into sharp ridges,
  // so the furrows run along the branch. Plates break the ridges up; detail adds grain.
  const furrows = periodicNoise(12, 1, 11);
  const warp = periodicNoise(6, 4, 12);
  const plates = periodicNoise(8, 10, 14);
  const detail = periodicNoise(40, 16, 13);
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const n = furrows((u + 0.06 * (warp(u, v) - 0.5) + 1) % 1, 0);
      const ridge = 1 - Math.abs(2 * n - 1); // 1 on the ridge, 0 in the furrow
      const crack = Math.pow(plates(u, v), 3) * 0.6;
      h[y * SIZE + x] = clamp01(Math.pow(ridge, 0.7) * (1 - crack) * 0.8 + 0.25 * detail(u, v) - 0.03);
    }
  }
  return h;
}

function bark(h) {
  const tint = periodicNoise(5, 5, 21);
  const px = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const t = clamp01((h[i] - 0.1) / 0.8);
    const warm = tint((i % SIZE) / SIZE, Math.floor(i / SIZE) / SIZE);
    // Dark furrows, grey-brown ridges with a little warm/cool variation.
    px[i * 3] = byte(mix(0.16, 0.62, t) * mix(0.95, 1.08, warm));
    px[i * 3 + 1] = byte(mix(0.12, 0.55, t));
    px[i * 3 + 2] = byte(mix(0.09, 0.47, t) * mix(1.05, 0.92, warm));
  }
  return png(SIZE, SIZE, 3, px);
}

function barkNormal(h, strength = 4) {
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const px = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Image rows go down while v goes up, so flip the y gradient.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 3;
      px[i] = byte((-dx / len) * 0.5 + 0.5);
      px[i + 1] = byte((-dy / len) * 0.5 + 0.5);
      px[i + 2] = byte((1 / len) * 0.5 + 0.5);
    }
  }
  return png(SIZE, SIZE, 3, px);
}

// ---------- leaf cards ----------
/** Card width / length (LEAF_WIDTH in src/generator/leaves.ts). */
const CARD_ASPECT = 0.5;
/** Half-width of the card diamond at v, in card units (the drawing must stay inside it). */
const diamond = (v) => CARD_ASPECT * (v < 0.4 ? (0.5 * v) / 0.4 : (0.5 * (1 - v)) / 0.6);

/**
 * Renders a card from `shade(x, v) -> [r, g, b] | null` (card units) with 3x3 supersampling for smooth
 * alpha edges. Transparent pixels get the average opaque colour so mipmaps don't darken edges.
 */
function card(shade, fill) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const ss = 3;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / SIZE;
          const v = 1 - (y + (sy + 0.5) / ss) / SIZE;
          const cx = (u - 0.5) * CARD_ASPECT;
          const c = Math.abs(cx) < diamond(v) ? shade(cx, v) : null;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const i = (y * SIZE + x) * 4;
      const rgb = a > 0 ? [r / a, g / a, b / a] : fill;
      px[i] = byte(rgb[0]);
      px[i + 1] = byte(rgb[1]);
      px[i + 2] = byte(rgb[2]);
      px[i + 3] = byte(a / (ss * ss));
    }
  }
  return png(SIZE, SIZE, 4, px);
}

/** Distance from p to the segment a-b, and the position t (0..1) along it. */
function segment(pu, pv, au, av, bu, bv) {
  const du = bu - au;
  const dv = bv - av;
  const t = clamp01(((pu - au) * du + (pv - av) * dv) / (du * du + dv * dv));
  return { d: Math.hypot(pu - au - du * t, pv - av - dv * t), t };
}

const TWIG = [0.42, 0.36, 0.3];

function leaf() {
  // A twig up the middle with alternating leaflets; the top leaflet ends the twig.
  const leaflets = [];
  const count = 7;
  /** Whether a leaflet's outline (tip and widest points, with a margin) fits in the card. */
  const fits = (l) =>
    [[1, 0], [0.45, 1], [0.45, -1], [0.75, 0.8], [0.75, -0.8]].every(([s, t]) => {
      const x = l.du * s * l.length + l.dv * t * l.width;
      const v = l.v0 + l.dv * s * l.length - l.du * t * l.width;
      return Math.abs(x) < 0.92 * diamond(v);
    });
  for (let k = 0; k < count; k++) {
    const last = k === count - 1;
    const v0 = 0.08 + 0.11 * k;
    const side = k % 2 === 0 ? 1 : -1;
    const angle = last ? 0 : side * (0.9 - 0.05 * k); // radians from straight up
    const l = { v0, du: Math.sin(angle), dv: Math.cos(angle), length: 0.26, width: 0 };
    do {
      l.length -= 0.005;
      l.width = l.length * 0.3;
    } while (!fits(l));
    leaflets.push(l);
  }
  const veins = periodicNoise(8, 8, 31);
  return card((x, v) => {
    for (const l of leaflets) {
      const rv = v - l.v0;
      const s = (x * l.du + rv * l.dv) / l.length; // 0 base .. 1 tip
      const t = (x * l.dv - rv * l.du) / l.width; // across, -1..1 at the widest point
      if (s < 0 || s > 1) continue;
      const half = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.75);
      if (Math.abs(t) > half) continue;
      // Light grey-green (the Season colour multiplies it), a midrib and faint side veins.
      const midrib = Math.exp(-Math.pow(t / 0.07, 2));
      const side = Math.pow(Math.abs(Math.sin((s * 9 - Math.abs(t) * 2.2) * Math.PI)), 12) * 0.5;
      const edge = Math.abs(t) / half;
      const shade = 0.93 - 0.18 * edge * edge + 0.08 * (veins(x + 0.5, v) - 0.5) - 0.12 * side * (1 - midrib);
      return [shade * 0.97 + 0.04 * midrib, shade + 0.06 * midrib, shade * 0.86 + 0.06 * midrib];
    }
    const twig = segment(x, v, 0, 0, 0, leaflets[count - 1].v0);
    if (twig.d < 0.007 * (1 - 0.6 * twig.t)) return TWIG;
    return null;
  }, [0.85, 0.88, 0.76]);
}

function needles() {
  // A twig up the middle, needles in pairs angled up and out, shorter towards the tip.
  const rand = mulberry32(41);
  const segments = [];
  for (let k = 0; k < 44; k++) {
    const v0 = 0.03 + 0.02 * k;
    for (const side of [1, -1]) {
      const angle = side * (0.8 + 0.25 * (rand() - 0.5));
      const length = Math.min(0.2, (1.1 * diamond(v0 + 0.08)) / Math.sin(Math.abs(angle))) * (0.8 + 0.2 * rand());
      segments.push({ av: v0, bu: Math.sin(angle) * length, bv: v0 + Math.cos(angle) * length, shade: 0.8 + 0.2 * rand() });
    }
  }
  return card((x, v) => {
    const twig = segment(x, v, 0, 0, 0, 0.96);
    if (twig.d < 0.006 * (1 - 0.7 * twig.t)) return TWIG;
    for (const n of segments) {
      const { d, t } = segment(x, v, 0, n.av, n.bu, n.bv);
      if (d < 0.005 * (1 - 0.5 * t)) {
        const s = n.shade * (0.88 + 0.12 * t);
        return [s * 0.92, s, s * 0.85];
      }
    }
    return null;
  }, [0.8, 0.86, 0.72]);
}

// ---------- bark per Bark Type ----------
// Each Bark Type is a height field (0 deep .. 1 proud, tileable) plus a colour from height and
// position; the normal map comes from the height field like the furrowed pair's.
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Fractional part, for repeating patterns. */
const fract = (x) => x - Math.floor(x);
/** Shortest distance between two coordinates on the 0..1 torus. */
const wrap = (d) => d - Math.round(d);

/** Fills an SIZE x SIZE RGB image from `colour(u, v, i) -> [r, g, b]`. */
function rgbImage(colour) {
  const px = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const c = colour(x / SIZE, y / SIZE, i);
      px[i * 3] = byte(c[0]);
      px[i * 3 + 1] = byte(c[1]);
      px[i * 3 + 2] = byte(c[2]);
    }
  }
  return png(SIZE, SIZE, 3, px);
}
function heightField(fn) {
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = clamp01(fn(x / SIZE, y / SIZE));
  return h;
}
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Smooth bark (beech): grey and nearly flat, mottled, with faint wrinkles around the trunk. */
function smoothBark() {
  const swell = periodicNoise(5, 4, 51);
  const grain = periodicNoise(48, 48, 52);
  const rings = periodicNoise(3, 40, 53);
  const mottle = periodicNoise(6, 6, 54);
  const fleck = periodicNoise(24, 24, 55);
  const h = heightField((u, v) => 0.5 + 0.18 * (swell(u, v) - 0.5) + 0.06 * (grain(u, v) - 0.5) - 0.1 * Math.pow(rings(u, v), 6));
  const colour = (u, v, i) => {
    const m = mottle(u, v);
    const f = smoothstep(0.62, 0.8, fleck(u, v));
    const base = lerp3([0.56, 0.57, 0.56], [0.72, 0.72, 0.7], m);
    const lichen = lerp3(base, [0.62, 0.66, 0.55], f * 0.6);
    const shade = 0.88 + 0.24 * (h[i] - 0.5);
    return lichen.map((c) => c * shade);
  };
  return { map: rgbImage(colour), normal: barkNormal(h, 2) };
}

/** Papery bark (birch): chalky white, dark lenticel dashes around the trunk, dark rough patches. */
function paperyBark() {
  const rand = mulberry32(61);
  const lenticels = Array.from({ length: 190 }, () => ({
    u: rand(),
    v: rand(),
    lu: 0.015 + 0.06 * Math.pow(rand(), 1.5),
    lv: 0.0035 + 0.004 * rand(),
  }));
  const patches = periodicNoise(5, 24, 62);
  const patchEdge = periodicNoise(16, 32, 63);
  const peel = periodicNoise(3, 18, 64);
  const grain = periodicNoise(32, 64, 65);
  const tint = periodicNoise(4, 4, 66);
  /** 0..1 how dark at (u, v): lenticels and patches. */
  const dark = new Float32Array(SIZE * SIZE);
  const h = heightField((u, v) => {
    let lent = 0;
    for (const l of lenticels) {
      const du = wrap(u - l.u) / l.lu;
      const dv = wrap(v - l.v) / l.lv;
      const d = du * du + dv * dv;
      if (d < 1) lent = Math.max(lent, 1 - d * d);
    }
    const p = smoothstep(0.72, 0.8, patches(u, v) + 0.14 * (patchEdge(u, v) - 0.5));
    const i = Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE);
    dark[i] = Math.max(Math.min(1, lent * 1.4), p);
    const peelEdge = Math.pow(1 - Math.abs(2 * fract(peel(u, v) * 3) - 1), 8);
    return 0.65 + 0.12 * peelEdge - 0.4 * lent - 0.15 * p + 0.25 * p * (grain(u, v) - 0.5) + 0.05 * (grain(u, v) - 0.5);
  });
  const colour = (u, v, i) => {
    const warm = tint(u, v);
    const white = [0.9 + 0.04 * warm, 0.89 + 0.02 * warm, 0.85 - 0.02 * warm];
    const greyed = lerp3(white, [0.72, 0.7, 0.66], 0.5 * Math.pow(1 - grain(u, v), 3));
    return lerp3(greyed, [0.12, 0.11, 0.1], dark[i]).map((c) => c * (0.9 + 0.15 * (h[i] - 0.6)));
  };
  return { map: rgbImage(colour), normal: barkNormal(h, 3) };
}

/** Fibrous bark (redwood): deep furrows between soft, stringy, red-brown ridges along the trunk. */
function fibrousBark() {
  const furrows = periodicNoise(7, 1, 71);
  const warp = periodicNoise(5, 3, 72);
  const strands = periodicNoise(64, 3, 73);
  const fibres = periodicNoise(128, 6, 74);
  const breaks = periodicNoise(10, 6, 75);
  const tint = periodicNoise(6, 4, 76);
  const h = heightField((u, v) => {
    const w = (u + 0.05 * (warp(u, v) - 0.5) + 1) % 1;
    const ridge = 1 - Math.abs(2 * furrows(w, 0) - 1);
    const strand = 0.6 * strands(w, v) + 0.4 * fibres(w, v);
    const torn = smoothstep(0.7, 0.85, breaks(u, v)) * 0.15;
    return Math.pow(ridge, 0.6) * 0.62 + 0.38 * strand - torn - 0.05;
  });
  const colour = (u, v, i) => {
    const t = clamp01((h[i] - 0.1) / 0.75);
    const red = lerp3([0.22, 0.09, 0.06], [0.7, 0.36, 0.24], t);
    // Weathered grey on the most exposed strands, a little warmer / cooler from place to place.
    const weathered = lerp3(red, [0.62, 0.5, 0.45], 0.4 * smoothstep(0.75, 0.95, h[i]));
    const warm = tint(u, v);
    return [weathered[0] * mix(0.92, 1.08, warm), weathered[1], weathered[2] * mix(1.05, 0.92, warm)];
  };
  return { map: rgbImage(colour), normal: barkNormal(h, 5) };
}

/** Plated bark (pine): broad flaky plates, orange-brown on top, separated by dark cracks. */
function platedBark() {
  // Periodic Voronoi on a jittered 5 x 4 grid: plates a little longer than wide.
  const cols = 6;
  const rows = 3;
  const rand = mulberry32(81);
  const sites = Array.from({ length: cols * rows }, (_, k) => ({
    u: ((k % cols) + 0.2 + 0.6 * rand()) / cols,
    v: (Math.floor(k / cols) + 0.2 + 0.6 * rand()) / rows,
    tone: rand(),
  }));
  const wobble = periodicNoise(12, 12, 82);
  const flakes = periodicNoise(10, 14, 83);
  const grain = periodicNoise(48, 32, 84);
  const tint = periodicNoise(5, 5, 85);
  const tones = new Float32Array(SIZE * SIZE);
  const h = heightField((u, v) => {
    const wu = u + 0.02 * (wobble(u, v) - 0.5);
    const wv = v + 0.02 * (wobble(v, u) - 0.5);
    let d1 = Infinity;
    let d2 = Infinity;
    let tone = 0;
    for (const s of sites) {
      const d = Math.hypot(wrap(wu - s.u), wrap(wv - s.v) * 0.55);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        tone = s.tone;
      } else if (d < d2) d2 = d;
    }
    const gap = d2 - d1; // 0 on a crack
    const crack = 1 - smoothstep(0.003 + 0.008 * wobble((u * 2) % 1, v), 0.024, gap);
    tones[Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)] = tone;
    // Plates are layered flakes: soft steps where the flake noise crosses levels.
    const layer = smoothstep(0.3, 0.7, fract(flakes(u, v) * 2 + tone));
    const plate = 0.62 + 0.14 * smoothstep(0, 0.1, gap) + 0.08 * layer + 0.14 * (grain(u, v) - 0.5);
    return mix(plate, 0.05, crack);
  });
  const colour = (u, v, i) => {
    const t = clamp01((h[i] - 0.1) / 0.75);
    const plateColour = lerp3([0.5, 0.33, 0.23], [0.7, 0.47, 0.33], 0.5 * tones[i] + 0.5 * flakes(u, v));
    const flaky = lerp3(plateColour, [0.6, 0.55, 0.5], 0.5 * Math.pow(grain(u, v), 2));
    const c = lerp3([0.16, 0.1, 0.07], flaky, smoothstep(0.15, 0.6, t));
    const warm = tint(u, v);
    return [c[0] * mix(0.95, 1.05, warm), c[1], c[2] * mix(1.04, 0.95, warm)];
  };
  return { map: rgbImage(colour), normal: barkNormal(h, 5) };
}

// ---------- leaf cards per Leaf Type ----------
/** The light grey-green of the leaf cards (the Season colour multiplies it), with a lighter midrib. */
const leafColour = (shade, vein) => [shade * 0.97 + 0.04 * vein, shade + 0.06 * vein, shade * 0.86 + 0.06 * vein];

/**
 * A leaf blade in card units: base (x0, v0), pointing `angle` radians from straight up, `length`
 * long and `width` wide each side. `inside(s, t)` / `shade(s, t)` use blade coordinates: s along
 * (0 base, 1 tip), t across (-1..1 = ±width). `fit` shrinks it until it lies inside the card.
 */
function blade(x0, v0, angle, length, aspect, inside, shade) {
  const b = { x0, v0, du: Math.sin(angle), dv: Math.cos(angle), length, width: length * aspect, inside, shade };
  const fits = () => {
    for (let s = -0.4; s <= 1.0001; s += 0.025) {
      for (let t = -1.2; t <= 1.2001; t += 0.05) {
        if (!inside(s, t)) continue;
        const x = b.x0 + b.du * s * b.length + b.dv * t * b.width;
        const v = b.v0 + b.dv * s * b.length - b.du * t * b.width;
        if (v < 0.005 || v > 0.995 || Math.abs(x) > 0.92 * diamond(v)) return false;
      }
    }
    return true;
  };
  while (!fits() && b.length > 0.02) {
    b.length *= 0.97;
    b.width = b.length * aspect;
  }
  return b;
}
/** The blade's colour at card point (x, v), or null outside it. */
function hitBlade(b, x, v) {
  const rx = x - b.x0;
  const rv = v - b.v0;
  const s = (rx * b.du + rv * b.dv) / b.length;
  const t = (rx * b.dv - rv * b.du) / b.width;
  if (s < -0.4 || s > 1 || Math.abs(t) > 1.2 || !b.inside(s, t)) return null;
  return b.shade(s, t);
}
/** Renders blades and stalks (segments {a: [x, v], b: [x, v], w}) as a card; blades first win. */
function spray(blades, stalks, fill) {
  return card((x, v) => {
    for (const b of blades) {
      const c = hitBlade(b, x, v);
      if (c) return c;
    }
    for (const st of stalks) {
      const { d, t } = segment(x, v, st.a[0], st.a[1], st.b[0], st.b[1]);
      if (d < st.w * (1 - 0.5 * t)) return TWIG;
    }
    return null;
  }, fill);
}
/** Where a blade's base is, for its stalk. */
const baseOf = (b) => [b.x0, b.v0];

function lobedLeaves() {
  // Oak: obovate leaves with 4-5 rounded lobes a side and deep sinuses, alternate on a twig.
  const veins = periodicNoise(8, 8, 91);
  const lobes = (s, t) => 4 * s + (t < 0 ? 0.15 : 0) - 0.35 * Math.abs(t);
  const envelope = (s) => (s < 0 ? 0 : Math.pow(Math.sin(Math.PI * Math.pow(s, 0.72)), 0.7));
  const inside = (s, t) => {
    if (s < 0) return false;
    const m = 0.5 - 0.5 * Math.cos(2 * Math.PI * lobes(s, t));
    return Math.abs(t) < envelope(s) * (0.42 + 0.58 * Math.sqrt(m));
  };
  const shade = (s, t) => {
    const midrib = Math.exp(-Math.pow(t / 0.05, 2));
    const q = fract(lobes(s, t));
    const lateral = Math.exp(-Math.pow((q - 0.5) / 0.035, 2)) * smoothstep(0.02, 0.15, Math.abs(t));
    const edge = Math.abs(t) / Math.max(0.05, envelope(s));
    const n = veins(0.5 + s * 0.3, 0.5 + t * 0.2);
    const shadeV = 0.92 - 0.14 * edge * edge + 0.08 * (n - 0.5) - 0.1 * lateral * (1 - midrib);
    return leafColour(shadeV, midrib + 0.5 * lateral);
  };
  const blades = [];
  const stalks = [];
  const count = 4;
  for (let k = 0; k < count; k++) {
    const last = k === count - 1;
    const v0 = 0.15 + 0.17 * k;
    const side = k % 2 === 0 ? 1 : -1;
    const angle = last ? 0 : side * (0.75 - 0.1 * k);
    const petiole = 0.025;
    const b = blade(Math.sin(angle) * petiole, v0 + Math.cos(angle) * petiole, angle, 0.55, 0.32, inside, shade);
    blades.push(b);
    stalks.push({ a: [0, v0], b: baseOf(b), w: 0.005 });
  }
  stalks.push({ a: [0, 0], b: [0, blades[count - 1].v0], w: 0.008 });
  // Draw the higher leaves over the lower ones.
  return spray(blades.reverse(), stalks, [0.85, 0.88, 0.76]);
}

function palmateLeaves() {
  // Maple: two leaves on long stalks, each with five broad, pointed, toothed lobes spreading from
  // where the stalk meets the blade (blade coordinates: s along, t across in units of the radius).
  const veins = periodicNoise(8, 8, 92);
  // Lobe directions (radians from the leaf axis) and lengths (fraction of the leaf radius).
  const LOBES = [[0, 1], [0.95, 0.92], [-0.95, 0.92], [1.95, 0.55], [-1.95, 0.55]];
  const polar = (s, t) => [Math.hypot(s, t), Math.atan2(t, s)];
  const reach = (theta) => {
    let r = 0.32;
    for (const [dir, len] of LOBES) {
      // Broad shoulders narrowing to a sharp tip.
      const d = Math.abs(theta - dir) / 0.8;
      if (d < 1) r = Math.max(r, len * (0.65 * Math.sqrt(1 - d * d) + 0.35 * (1 - d)));
    }
    // Two or three big teeth per lobe side and a fine serration.
    return r * (1 + 0.05 * Math.abs(Math.sin(theta * 9)) + 0.025 * Math.abs(Math.sin(theta * 31)));
  };
  /** A maple leaf centred at (x, v), pointing `angle` from up, radius fitted to the card. */
  const leaf = (x, v, angle, radius) => {
    const l = { x, v, du: Math.sin(angle), dv: Math.cos(angle), r: radius };
    const fits = () => {
      for (let k = 0; k < 120; k++) {
        const theta = -Math.PI + (2 * Math.PI * k) / 120;
        const rr = reach(theta) * l.r;
        const s = Math.cos(theta) * rr;
        const t = Math.sin(theta) * rr;
        const px = l.x + l.du * s + l.dv * t;
        const pv = l.v + l.dv * s - l.du * t;
        if (pv < 0.005 || Math.abs(px) > 0.94 * diamond(pv)) return false;
      }
      return true;
    };
    while (!fits() && l.r > 0.02) l.r *= 0.97;
    return l;
  };
  const leaves = [leaf(0.02, 0.41, -0.3, 0.4), leaf(-0.015, 0.75, 0.25, 0.4)];
  const stalks = [
    { a: [0, 0], b: [0, 0.1], w: 0.007 },
    { a: [0, 0.1], b: [leaves[0].x, leaves[0].v], w: 0.0045 },
    { a: [0, 0.1], b: [leaves[1].x, leaves[1].v], w: 0.0045 },
  ];
  return card((x, v) => {
    for (const l of leaves) {
      const rx = x - l.x;
      const rv = v - l.v;
      const s = (rx * l.du + rv * l.dv) / l.r;
      const t = (rx * l.dv - rv * l.du) / l.r;
      const [r, theta] = polar(s, t);
      const edge = reach(theta);
      if (r >= edge) continue;
      // Palmate main veins run from the centre to each lobe tip.
      let vein = 0;
      for (const [dir] of LOBES) {
        const d = Math.abs(wrap((theta - dir) / (2 * Math.PI)) * 2 * Math.PI) * r;
        vein = Math.max(vein, Math.exp(-Math.pow(d / 0.025, 2)));
      }
      const n = veins(0.5 + s * 0.2, 0.5 + t * 0.2);
      const rim = r / edge;
      return leafColour(0.93 - 0.16 * rim * rim + 0.08 * (n - 0.5) - 0.04 * (1 - vein), vein);
    }
    for (const st of stalks) {
      const { d, t } = segment(x, v, st.a[0], st.a[1], st.b[0], st.b[1]);
      if (d < st.w * (1 - 0.4 * t)) return TWIG;
    }
    return null;
  }, [0.85, 0.88, 0.76]);
}

function compoundLeaf() {
  // Ash / walnut / hickory: one pinnate leaf, opposite pairs of toothed lance-shaped leaflets
  // along a rachis and a terminal leaflet.
  const veins = periodicNoise(8, 8, 93);
  const half = (s) => Math.pow(Math.sin(Math.PI * Math.pow(clamp01(s), 0.65)), 0.8) * (1 - 0.07 * Math.abs(Math.sin(s * 38)));
  const inside = (s, t) => s >= 0 && Math.abs(t) < half(s);
  const shade = (s, t) => {
    const midrib = Math.exp(-Math.pow(t / 0.08, 2));
    const side = Math.pow(Math.abs(Math.sin((s * 7 - Math.abs(t) * 1.6) * Math.PI)), 14) * 0.4;
    const edge = Math.abs(t) / Math.max(0.05, half(s));
    const n = veins(0.5 + s * 0.3, 0.5 + t * 0.2);
    return leafColour(0.93 - 0.16 * edge * edge + 0.08 * (n - 0.5) - 0.1 * side * (1 - midrib), midrib);
  };
  const blades = [];
  const stalks = [];
  const pairs = 5;
  let top = 0;
  for (let k = 0; k < pairs; k++) {
    const v0 = 0.12 + 0.14 * k;
    for (const side of [1, -1]) {
      const angle = side * (1.05 - 0.06 * k);
      const b = blade(Math.sin(angle) * 0.008, v0 + Math.cos(angle) * 0.008, angle, 0.3, 0.27, inside, shade);
      blades.push(b);
    }
    top = v0;
  }
  const terminal = blade(0, top + 0.06, 0, 0.4, 0.27, inside, shade);
  blades.push(terminal);
  stalks.push({ a: [0, 0], b: [0, terminal.v0], w: 0.007 });
  return spray(blades.reverse(), stalks, [0.85, 0.88, 0.76]);
}

function scaleSpray() {
  // Cedar / juniper: a flat, fern-like spray of shoots covered in tiny overlapping scale leaves.
  // Shoots are tapered segments; the scales are a repeating bright-tip pattern along each one,
  // with a slightly toothed outline.
  const shoots = [];
  const add = (a, b, w0, w1) => shoots.push({ a, b, w0, w1, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  const fit = (a, angle, length) => {
    let l = length;
    const end = () => [a[0] + Math.sin(angle) * l, a[1] + Math.cos(angle) * l];
    while (l > 0.01 && (Math.abs(end()[0]) > 0.9 * diamond(end()[1]) || end()[1] > 0.99)) l *= 0.95;
    return end();
  };
  add([0, 0], [0, 0.96], 0.014, 0.007);
  for (let k = 0; k < 15; k++) {
    const v0 = 0.06 + 0.058 * k;
    const side = k % 2 === 0 ? 1 : -1;
    const angle = side * 0.8;
    const a = [0, v0];
    const b = fit(a, angle, 0.24);
    add(a, b, 0.011, 0.006);
    // Branchlets off the side shoot, alternating, pointing outwards and up.
    const len = Math.hypot(b[0], b[1] - v0);
    for (let j = 1; j * 0.022 < len - 0.015; j++) {
      const f = (j * 0.022) / len;
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const turn = (j % 2 === 0 ? 1 : -1) * 0.75;
      const q = fit(p, angle + turn, 0.07 * (1 - 0.6 * f));
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.012) add(p, q, 0.0075, 0.004);
    }
  }
  const SCALE = 0.011; // length of one scale leaf
  return card((x, v) => {
    for (const sh of shoots) {
      const { d, t } = segment(x, v, sh.a[0], sh.a[1], sh.b[0], sh.b[1]);
      const along = t * sh.len;
      const f = fract(along / SCALE); // 0 at a scale's base, 1 at its tip
      const w = mix(sh.w0, sh.w1, t) * (0.82 + 0.18 * Math.sin(Math.PI * f));
      if (d >= w) continue;
      const across = d / w;
      const s = (0.68 + 0.3 * f) * (1 - 0.25 * across * across);
      return [s * 0.9, s, s * 0.84];
    }
    return null;
  }, [0.8, 0.86, 0.72]);
}

mkdirSync(OUT, { recursive: true });
const h = barkHeight();
const files = { 'bark.png': bark(h), 'bark-normal.png': barkNormal(h), 'leaf.png': leaf(), 'needles.png': needles() };
for (const [type, make] of Object.entries({ smooth: smoothBark, papery: paperyBark, fibrous: fibrousBark, plated: platedBark })) {
  const { map, normal } = make();
  files[`bark-${type}.png`] = map;
  files[`bark-${type}-normal.png`] = normal;
}
Object.assign(files, {
  'leaf-lobed.png': lobedLeaves(),
  'leaf-palmate.png': palmateLeaves(),
  'leaf-compound.png': compoundLeaf(),
  'scale.png': scaleSpray(),
});
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} kB`);
}
