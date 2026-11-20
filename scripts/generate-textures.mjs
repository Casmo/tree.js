/* global Buffer, URL, console, process */
// Generates the realistic and Painterly Styles' textures procedurally, so every image in the package is our own
// (MIT, like the code). Deterministic: the same script always writes the same bytes.
//
//   node scripts/generate-textures.mjs [outDir]
//
// Output (assets/textures/ by default, shipped as dist/textures/): realistic/ and painterly/.
//
// realistic/: one set per Bark Type and Leaf Type (src/styles/realistic/textures.ts maps the types to
// these files):
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
//
// painterly/ (ADR 0014: Leaf Masses are clumps of painted spray cards), painted with brush-like marks:
//   spray-<Leaf Type>.png 256x256 RGBA  square spray card per Leaf Type (broad, lobed, palmate, compound,
//                                       needle, scale): grey paint value (dark low in the spray .. light
//                                       tips), alpha cut-out; stem at (0.5, 0), tips towards v = 1
//   mass-noise.png        256x256 RGBA  tileable painted leaf noise for a Leaf Mass surface / ragged
//                                       edge: rgb = paint value, a = leaf coverage
//   bark-<Bark Type>.png  128x256 RGB   tileable painted bark colour per Bark Type (furrowed, smooth,
//                                       papery, fibrous, plated); no normal maps
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL('../assets/textures/', import.meta.url);
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

// ---------- painterly ----------
// Painterly (ADR 0014) draws Leaf Masses as clumps of painted spray cards. Its textures are painted
// with brush-like marks: each mark is a shape in its own frame (centre, rotation, length along the
// mark, width across it), painted over what is below it. Marks are rasterised into a supersampled
// buffer in pixel units with y up (y = 0 is the bottom image row, v = 0), then averaged down.

/** A w x h paint buffer, supersampled `ss` times; `wrap` makes marks tile across the edges. */
function canvasBuffer(w, h, { ss = 3, wrap = false, base = null } = {}) {
  const W = w * ss;
  const H = h * ss;
  const col = new Float32Array(W * H * 3);
  const cov = new Float32Array(W * H);
  if (base) for (let i = 0; i < W * H; i++) [col[i * 3], col[i * 3 + 1], col[i * 3 + 2], cov[i]] = [...base, 1];
  return { w, h, ss, W, H, wrap, col, cov };
}

/**
 * Paints one mark centred at (x, y) (pixels, y up), its length pointing `rot` radians from straight up
 * (clockwise, towards +x). `inside(a, l)` and `colour(a, l) -> [r, g, b]` get the position across
 * (a) and along (l) the mark in pixels from its centre; `alpha` blends it over what is below.
 */
function mark(buf, { x, y, rot, len, wid, inside, colour, alpha = 1 }) {
  const { ss, W, H, wrap, col, cov } = buf;
  const sin = Math.sin(rot);
  const cos = Math.cos(rot);
  const r = 0.5 * Math.hypot(len, wid) + 1;
  const i0 = Math.floor((x - r) * ss);
  const i1 = Math.ceil((x + r) * ss);
  const j0 = Math.floor((y - r) * ss);
  const j1 = Math.ceil((y + r) * ss);
  for (let j = j0; j <= j1; j++) {
    if (!wrap && (j < 0 || j >= H)) continue;
    const dy = (j + 0.5) / ss - y;
    const row = (((j % H) + H) % H) * W;
    for (let i = i0; i <= i1; i++) {
      if (!wrap && (i < 0 || i >= W)) continue;
      const dx = (i + 0.5) / ss - x;
      const l = dx * sin + dy * cos;
      const a = dx * cos - dy * sin;
      if (Math.abs(l) > len / 2 || Math.abs(a) > wid / 2 || !inside(a, l)) continue;
      const c = colour(a, l);
      const k = row + (((i % W) + W) % W);
      for (let n = 0; n < 3; n++) col[k * 3 + n] = mix(col[k * 3 + n], c[n], alpha);
      cov[k] = mix(cov[k], 1, alpha);
    }
  }
}

/** A round-ended brush stroke from (x0, y0) to (x1, y1), `width` pixels wide, in one colour. */
function stroke(buf, x0, y0, x1, y1, width, rgb, alpha = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0) + width;
  const half = (len - width) / 2;
  mark(buf, {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    rot: Math.atan2(x1 - x0, y1 - y0),
    len,
    wid: width,
    inside: (a, l) => Math.hypot(Math.max(0, Math.abs(l) - half), a) <= width / 2,
    colour: () => rgb,
    alpha,
  });
}

/** Averages the buffer down to an RGB or RGBA PNG; uncovered pixels get the mean covered colour. */
function bufferPng(buf, channels) {
  const { w, h, ss, W, col, cov } = buf;
  const mean = [0, 0, 0];
  let total = 0;
  for (let k = 0; k < cov.length; k++) {
    for (let n = 0; n < 3; n++) mean[n] += col[k * 3 + n] * cov[k];
    total += cov[k];
  }
  const fill = mean.map((m) => (total > 0 ? m / total : 0));
  const px = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0];
      let c = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const k = (y * ss + sy) * W + x * ss + sx;
          for (let n = 0; n < 3; n++) sum[n] += col[k * 3 + n] * cov[k];
          c += cov[k];
        }
      }
      const i = ((h - 1 - y) * w + x) * channels; // y up -> image rows top to bottom
      for (let n = 0; n < 3; n++) px[i + n] = byte(c > 0 ? sum[n] / c : fill[n]);
      if (channels === 4) px[i + 3] = byte(c / (ss * ss));
    }
  }
  return png(w, h, channels, px);
}

/** Grey of value `v`. */
const greyRgb = (v) => [v, v, v];
/** The painted look of one leaf: lit on one side (+a), darker on the other, like a loaded brush. */
const litAcross = (value, wid) => (a) => greyRgb(clamp01(value * mix(0.7, 1.15, a / wid + 0.5)));
/** A pointed leaf blade (half-width at `p`, 0 base .. 1 tip), widest a little below the middle. */
const pointedBlade = (p) => 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(p, 1.12)), 0.85);
/** `inside` for a blade outline `half(p)` (fraction of the width each side). */
const bladeInside = (len, wid, half) => (a, l) => Math.abs(a) < wid * half(l / len + 0.5);
/** The paint value of a leaf at height `t` (0 stem .. 1 tip): dark low in the spray, light at the tips. */
const sprayValue = (rand, t) => 0.35 + 0.55 * t * mix(0.6, 1.1, rand()) + 0.15 * rand();

/**
 * Painterly spray cards, one per Leaf Type. Square cards (u across, v from the stem at (0.5, 0) to
 * the tips at v = 1), RGBA: rgb = grey paint value (dark gaps low in the spray .. light leaf tips;
 * the Painterly shading maps it onto its Season palette), a = coverage for the alpha cut.
 */
function paintedSpray(type) {
  const S = SIZE;
  const cx = S / 2;
  const buf = canvasBuffer(S, S);
  const rand = mulberry32({ broad: 5, lobed: 6, palmate: 7, compound: 8, needle: 9, scale: 10 }[type]);
  const range = (a, b) => mix(a, b, rand());
  const leafAt = (x, y, rot, len, wid, half, value) =>
    mark(buf, { x, y, rot, len, wid, inside: bladeInside(len, wid, half), colour: litAcross(value, wid) });
  // Leaves fanning out of the stem, pointing outwards and up, the spray narrowing to the tip.
  const fan = (count, size, aspect, half, turn = 0.9) => {
    for (let i = 0; i < count; i++) {
      const t = Math.pow(rand(), 0.8);
      const side = range(-1, 1);
      const x = cx + side * (1 - 0.6 * t) * S * 0.32 * range(0.2, 1);
      const y = S * (0.12 + 0.76 * t);
      const len = S * size(t);
      leafAt(x, y, side * range(0.5, 1.2) * turn, len, len * aspect(), half, sprayValue(rand, t));
    }
  };
  if (type === 'broad') fan(70, (t) => range(0.13, 0.22) * (1 - 0.4 * t), () => range(0.38, 0.5), pointedBlade);
  if (type === 'needle') fan(260, () => range(0.12, 0.22), () => 0.09, pointedBlade, 1.1);
  if (type === 'lobed') {
    // Oak: broad leaves, widest towards the tip, with rounded lobes and sinuses along the edge.
    const lobed = (p) => 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.75)), 0.7) * (0.62 + 0.38 * Math.abs(Math.cos(p * Math.PI * 4.5)));
    fan(55, (t) => range(0.16, 0.24) * (1 - 0.4 * t), () => range(0.5, 0.6), lobed);
  }
  if (type === 'palmate') {
    // Maple: five-pointed stars (lobes spreading from where the stalk meets the blade).
    const LOBES = [[0, 1], [0.95, 0.9], [-0.95, 0.9], [1.9, 0.6], [-1.9, 0.6]];
    for (let i = 0; i < 38; i++) {
      const t = Math.pow(rand(), 0.8);
      const side = range(-1, 1);
      const x = cx + side * (1 - 0.6 * t) * S * 0.3 * range(0.2, 1);
      const y = S * (0.12 + 0.74 * t);
      const len = S * range(0.17, 0.24) * (1 - 0.35 * t);
      const value = sprayValue(rand, t);
      mark(buf, {
        x,
        y,
        rot: side * range(0.3, 0.9),
        len,
        wid: len,
        inside: (a, l) => {
          const r = (2 * Math.hypot(a, l)) / len;
          const theta = Math.atan2(a, l);
          let reach = 0.3;
          for (const [dir, lobe] of LOBES) {
            const d = Math.abs(theta - dir) / 0.6;
            if (d < 1) reach = Math.max(reach, lobe * Math.pow(1 - d, 0.6));
          }
          return r < reach;
        },
        colour: litAcross(value, len),
      });
    }
  }
  if (type === 'compound') {
    // Ash / walnut: a few pinnate leaves off the stem, opposite pairs of narrow leaflets on each rachis.
    for (let k = 0; k < 5; k++) {
      const last = k === 4;
      const t = last ? 0.72 : 0.1 + 0.15 * k;
      const side = k % 2 === 0 ? 1 : -1;
      const rot = last ? 0.05 : side * range(0.65, 0.95);
      const length = S * (last ? 0.12 : 0.42 * (1 - 0.35 * t));
      const x0 = cx + S * 0.02 * Math.sin(Math.PI * t);
      const y0 = S * t;
      const at = (f) => [x0 + Math.sin(rot) * length * f, y0 + Math.cos(rot) * length * f];
      stroke(buf, x0, y0, ...at(1), S * 0.01, greyRgb(0.25));
      for (let f = 0.22; f <= 1.001; f += 0.16) {
        const [px, py] = at(f);
        const leaflet = S * range(0.08, 0.1) * (1 - 0.3 * f);
        for (const turn of f > 0.95 ? [0] : [1, -1]) {
          const r = rot + turn * range(0.75, 1.0);
          const value = sprayValue(rand, (py + leaflet * 0.5 * Math.cos(r)) / S);
          leafAt(px + 0.5 * leaflet * Math.sin(r), py + 0.5 * leaflet * Math.cos(r), r, leaflet, leaflet * 0.34, pointedBlade, value);
        }
      }
    }
  }
  if (type === 'scale') {
    // Cedar / juniper: flat, feathery shoots of overlapping scale dabs, branching off the stem.
    const shoot = (x0, y0, rot, length, dab) => {
      for (let d = 0; d < length; d += dab * 0.45) {
        const x = x0 + Math.sin(rot) * d;
        const y = y0 + Math.cos(rot) * d;
        const size = dab * (1 - (0.4 * d) / length);
        leafAt(x, y, rot + range(-0.3, 0.3), size, size * 0.62, pointedBlade, sprayValue(rand, clamp01(y / S + 0.15 * (d / length))));
      }
    };
    for (let k = 0; k < 11; k++) {
      const t = 0.06 + 0.075 * k;
      const side = k % 2 === 0 ? 1 : -1;
      const rot = side * range(0.65, 0.9);
      const length = S * 0.36 * (1 - 0.55 * t);
      const x0 = cx + S * 0.02 * Math.sin(Math.PI * t);
      const y0 = S * t;
      shoot(x0, y0, rot, length, S * 0.05);
      for (const f of [0.3, 0.6]) {
        const turn = (f < 0.5 ? 1 : -1) * side * 0.65;
        shoot(x0 + Math.sin(rot) * length * f, y0 + Math.cos(rot) * length * f, rot - turn, length * 0.4, S * 0.04);
      }
    }
    shoot(cx, S * 0.84, 0, S * 0.12, S * 0.05);
  }
  // The stem: a slightly bent brush stroke from the bottom centre up into the spray.
  const bend = (f) => [cx + S * 0.04 * 2 * f * (1 - f), S * 0.88 * f];
  for (let k = 0; k < 16; k++) stroke(buf, ...bend(k / 16), ...bend((k + 1) / 16), S * 0.025 * (1 - (0.5 * k) / 16), greyRgb(0.2));
  return bufferPng(buf, 4);
}

/**
 * Tileable painted leaf noise for the Leaf Mass surface (for world-space / triplanar sampling, and
 * the ragged edge): rgb = paint value (dark gaps .. light leaves on top), a = leaf coverage.
 */
function massNoise() {
  const S = SIZE;
  const buf = canvasBuffer(S, S, { ss: 2, wrap: true, base: greyRgb(0.12) });
  buf.cov.fill(0); // the dark base is the gaps between leaves: not covered
  const rand = mulberry32(11);
  const leaves = 700;
  for (let i = 0; i < leaves; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = mix(17, 29, rand());
    const wid = len * mix(0.4, 0.55, rand());
    const rot = rand() * Math.PI * 2;
    const value = 0.25 + 0.6 * (i / leaves) * mix(0.6, 1, rand()) + 0.15 * rand(); // later leaves lie on top: lighter
    mark(buf, { x, y, rot, len, wid, inside: bladeInside(len, wid, pointedBlade), colour: litAcross(value, wid) });
  }
  // rgb averages the dark gaps in (unlike the cards, whose gaps are cut away).
  const { cov } = buf;
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sum = [0, 0, 0];
      let c = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const k = (y * 2 + sy) * buf.W + x * 2 + sx;
          for (let n = 0; n < 3; n++) sum[n] += buf.col[k * 3 + n];
          c += cov[k];
        }
      }
      const i = ((S - 1 - y) * S + x) * 4;
      for (let n = 0; n < 3; n++) px[i + n] = byte(sum[n] / 4);
      px[i + 3] = byte(c / 4);
    }
  }
  return png(S, S, 4, px);
}

/** sRGB hex -> [r, g, b] 0..1 (the image's own colour values). */
const hex = (h) => [0, 2, 4].map((k) => parseInt(h.slice(1 + k, 3 + k), 16) / 255);

/**
 * Painterly bark colour per Bark Type: 128 x 256 RGB, tileable, smooth painted bark with a few
 * brush strokes (no normal map). Furrows and stripes run along the branch (v).
 */
function paintedBark(type) {
  const W = 128;
  const H = 256;
  const rand = mulberry32({ furrowed: 23, smooth: 24, papery: 25, fibrous: 26, plated: 27 }[type]);
  const range = (a, b) => mix(a, b, rand());
  const base = { furrowed: '#6a523f', smooth: '#8c8a83', papery: '#e9e4d8', fibrous: '#8a4630', plated: '#4a2a1c' }[type];
  const buf = canvasBuffer(W, H, { wrap: true, base: hex(base) });
  /** Vertical strokes along the bark, `dark` / `light` with their alpha, `share` of them dark. */
  const streaks = (count, lengths, widths, dark, light, share) => {
    for (let i = 0; i < count; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const len = range(...lengths);
      const [rgb, alpha] = rand() < share ? dark : light;
      stroke(buf, x, y, x + range(-4, 4), y + len, range(...widths), rgb, alpha);
    }
  };
  if (type === 'furrowed') {
    // Oak: long dark furrows between lighter ridges.
    streaks(80, [40, 120], [2, 5], [hex('#281e16'), 0.6], [hex('#967d64'), 0.4], 0.6);
  }
  if (type === 'smooth') {
    // Beech: smooth grey with soft light and dark patches, a few faint rings around the trunk.
    for (let i = 0; i < 26; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const len = range(20, 60);
      const wid = range(10, 26);
      const rgb = hex(rand() < 0.5 ? '#a8a69e' : '#77756e');
      mark(buf, { x, y, rot: 0, len, wid, inside: (a, l) => (a / wid) ** 2 + (l / len) ** 2 < 0.25, colour: () => rgb, alpha: 0.35 });
    }
    for (let i = 0; i < 18; i++) {
      const x = rand() * W;
      const y = rand() * H;
      stroke(buf, x, y, x + range(8, 24), y + range(-2, 2), range(1.5, 2.5), hex('#5e5c56'), 0.4);
    }
  }
  if (type === 'papery') {
    // Birch: chalky white, dark lenticel dashes around the trunk and a few dark rough patches.
    for (let i = 0; i < 40; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const len = range(3, 10);
      const wid = range(6, 20);
      mark(buf, { x, y, rot: 0, len, wid, inside: () => true, colour: () => hex('#beb4a5'), alpha: 0.5 });
    }
    for (let i = 0; i < 90; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const len = range(6, 26);
      const thick = range(2, 5.2);
      mark(buf, {
        x,
        y,
        rot: Math.PI / 2,
        len,
        wid: thick,
        inside: (a, l) => (a / thick) ** 2 + (l / len) ** 2 < 0.25,
        colour: () => hex('#28221e'),
        alpha: range(0.6, 0.95),
      });
    }
    for (let i = 0; i < 5; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const len = range(14, 30);
      const wid = range(18, 34);
      mark(buf, {
        x,
        y,
        rot: range(-0.3, 0.3),
        len,
        wid,
        inside: (a, l) => (a / wid) ** 2 + (l / len) ** 2 < 0.25 * (0.75 + 0.25 * Math.sin(Math.atan2(a, l) * 5)),
        colour: () => hex('#2e2925'),
        alpha: 0.9,
      });
    }
  }
  if (type === 'fibrous') {
    // Redwood: long, stringy red-brown ridges, some weathered lighter strands.
    streaks(130, [60, 160], [1.5, 3.5], [hex('#3a1a10'), 0.6], [hex('#b8714f'), 0.45], 0.5);
  }
  if (type === 'plated') {
    // Pine: broad orange-brown plates, lighter at the top, between dark cracks (the base colour).
    const cols = 4;
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ((c + (r % 2) * 0.5 + range(-0.2, 0.2)) * W) / cols;
        const y = ((r + range(-0.15, 0.15)) * H) / rows;
        const len = (H / rows) * range(0.75, 1.05);
        const wid = (W / cols) * range(0.7, 0.95);
        const round = range(2, 3);
        const tone = range(-0.06, 0.06);
        mark(buf, {
          x,
          y,
          rot: range(-0.08, 0.08),
          len,
          wid,
          inside: (a, l) => Math.pow(Math.abs((2 * a) / wid), round) + Math.pow(Math.abs((2 * l) / len), round) < 1,
          colour: (a, l) => {
            const lit = 0.5 + l / len - (0.5 * a) / wid; // lighter towards the top-left
            return lerp3(hex('#8e4c30'), hex('#c07a52'), clamp01(lit)).map((v) => v + tone);
          },
        });
      }
    }
    streaks(40, [10, 30], [1.5, 3], [hex('#3c1c12'), 0.6], [hex('#d8996c'), 0.35], 0.5);
  }
  return bufferPng(buf, 3);
}

// ---------- output ----------
const realistic = () => {
  const h = barkHeight();
  const files = { 'bark.png': bark(h), 'bark-normal.png': barkNormal(h), 'leaf.png': leaf(), 'needles.png': needles() };
  for (const [type, make] of Object.entries({ smooth: smoothBark, papery: paperyBark, fibrous: fibrousBark, plated: platedBark })) {
    const { map, normal } = make();
    files[`bark-${type}.png`] = map;
    files[`bark-${type}-normal.png`] = normal;
  }
  return Object.assign(files, {
    'leaf-lobed.png': lobedLeaves(),
    'leaf-palmate.png': palmateLeaves(),
    'leaf-compound.png': compoundLeaf(),
    'scale.png': scaleSpray(),
  });
};
const painterly = () => {
  const files = { 'mass-noise.png': massNoise() };
  for (const type of ['broad', 'lobed', 'palmate', 'compound', 'needle', 'scale']) files[`spray-${type}.png`] = paintedSpray(type);
  for (const type of ['furrowed', 'smooth', 'papery', 'fibrous', 'plated']) files[`bark-${type}.png`] = paintedBark(type);
  return files;
};
for (const [set, make] of Object.entries({ realistic, painterly })) {
  const dir = new URL(`${set}/`, OUT);
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(make())) {
    writeFileSync(new URL(name, dir), bytes);
    console.log(`${set}/${name}: ${(bytes.length / 1024).toFixed(1)} kB`);
  }
}
