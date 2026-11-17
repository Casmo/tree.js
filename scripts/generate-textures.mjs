/* global Buffer, URL, console */
// Generates the realistic Style's textures procedurally, so every image in the package is our own
// (MIT, like the code). Deterministic: the same script always writes the same bytes.
//
//   node scripts/generate-textures.mjs
//
// Output (assets/textures/realistic/, shipped as dist/textures/realistic/):
//   bark.png         256x256 RGB   tileable bark colour (furrows running along the branch)
//   bark-normal.png  256x256 RGB   tangent-space normal map of the same furrows
//   leaf.png         256x256 RGBA  broadleaf card: a twig with leaflets, alpha cut-out, light grey-green
//                                  (the Season Profile's leaf colour multiplies it)
//   needles.png      256x256 RGBA  conifer card: a twig with needles, alpha cut-out
//
// Leaf cards are drawn inside the 'card' leaf shape's diamond UVs: stem at (0.5, 0), widest at
// v = 0.4, tip at (0.5, 1). v = 0 is the bottom image row (three.js flips images on upload).
// A card is half as wide as it is long (LEAF_WIDTH in src/generator/leaves.ts), so the drawing is
// made in card units (x across, centred, -0.25..0.25; v along, 0..1) and stretched to fill u.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../assets/textures/realistic/', import.meta.url);
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

function barkNormal(h) {
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const strength = 4;
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
  for (let k = 0; k < 36; k++) {
    const v0 = 0.04 + 0.024 * k;
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
      if (d < 0.0035 * (1 - 0.6 * t)) {
        const s = n.shade * (0.88 + 0.12 * t);
        return [s * 0.92, s, s * 0.85];
      }
    }
    return null;
  }, [0.8, 0.86, 0.72]);
}

mkdirSync(OUT, { recursive: true });
const h = barkHeight();
const files = { 'bark.png': bark(h), 'bark-normal.png': barkNormal(h), 'leaf.png': leaf(), 'needles.png': needles() };
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} kB`);
}
