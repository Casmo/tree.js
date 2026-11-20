// A Variant's Impostor (ADR 0010, GLOSSARY): the atlases baked from frames × frames directions at
// Growth 1, and the card material that draws far trees with them. The directions are hemi-octahedral
// (`octahedral.ts`): the upper hemisphere only, from the horizon to straight above; a view from below
// uses the horizon frames.
//
// What is baked is a list of channels (one atlas each); the bake renders every channel of every
// frame in one pass. Later features add channels (`impostorChannels`) and read them in the material
// (`createImpostorMaterial`, through `ImpostorView.value`).
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  RenderTarget,
  RendererUtils,
  Scene,
  UnsignedByteType,
  type Node,
  type Renderer,
  type Texture,
} from 'three/webgpu';
import { attribute, float, frontFacing, mrt, normalGeometry, output, positionGeometry, select, vec4 } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers } from '../generator';
import { createBarkMaterial, createLeafMaterial, paintsLeafMasses } from '../materials';
import { PaintedNodeMaterial, type LeafMassPaint } from '../materials/painted';
import type { TextureOptions } from '../textures';
import type { WindResponse, WindSource } from '../wind';
import {
  COLOR_CHANNEL,
  createImpostorMaterial,
  FEATURES_CHANNEL,
  featureTexel,
  hasImpostorFeatures,
  NORMAL_CHANNEL,
  PAINT_CHANNEL,
  paintTexel,
  SEASON_CHANNEL,
  WOOD_COLOR_CHANNEL,
  WOOD_NORMAL_CHANNEL,
  type ImpostorAtlases,
  type ImpostorBounds,
  type ImpostorFeatures,
} from './impostor-material';
import { encodeSeasonTexel, SEASON_SHIFT_SCALE } from './impostor-season';
import type { LevelPart } from './levels';
import type { ImpostorAtlasOptions } from './lod';
import { frameBasis, frameDirection } from './octahedral';

/** Room around the tree's bounding sphere in each frame, so mipmaps do not bleed in from the next frame. */
const FRAME_MARGIN = 1.04;

/** One part of the tree as the bake draws it. */
export interface ImpostorBakePart {
  kind: 'wood' | 'leaves';
  /** The part's vertex data (tree space, Growth 1). */
  geometry: BufferGeometry;
  /** The unlit bake material of the part: its colour, alpha cut and the Definition's maps. */
  material: MeshBasicNodeMaterial;
  /** Painted Leaf Masses (leaves only): what paints them, baked into `PAINT_CHANNEL`; null otherwise. */
  paint: LeafMassPaint | null;
}

/**
 * One atlas of an Impostor: what the bake writes per covered texel for each part. The background
 * stays 0, so every atlas is premultiplied by coverage (mipmaps and frame blends stay right; the
 * material divides by the coverage). `name` is the MRT output and texture name.
 */
export interface ImpostorChannel {
  name: string;
  bake(part: ImpostorBakePart): Node<'vec4'>;
}

/**
 * Leaves are two-sided: the normal of the side the frame sees, encoded 0..1. Painted Leaf Masses: the
 * card's normal bent towards its mass, both sides alike (as the tree lights them).
 */
const bakedNormal = (part?: ImpostorBakePart) =>
  (part?.paint ? part.paint.normal : select(frontFacing, normalGeometry, normalGeometry.negate())).normalize().mul(0.5).add(0.5);

/** Most atlases one bake pass writes (WebGPU's default `maxColorAttachmentBytesPerSample` 32, 8 per RGBA8). */
const MAX_ATTACHMENTS = 4;

/**
 * The channels of the tree layer every Impostor bakes: colour (rgb, coverage in a), the tree-space
 * normal (a = leaf flag), the leaves' Season timing (`encodeSeasonTexel`: shift, coverage rank,
 * blossom rank, leaf flag; empty on wood), plus, only when a Material Feature is on, the features
 * atlas (`FEATURES_CHANNEL`: the pictured point and the raw Structural Occlusion), and with `paint`
 * (painted Leaf Masses) the paint atlas (`PAINT_CHANNEL`).
 *
 * Each channel is one RGBA8 attachment of a render pass: WebGPU's default limit
 * (`maxColorAttachmentBytesPerSample` 32, 8 per RGBA8) allows 4 per pass, so the Impostor draws the tree
 * again for the channels past the fourth (`treeLayers`).
 */
export function impostorChannels(bounds: ImpostorBounds, features: ImpostorFeatures | null = null, paint = false): ImpostorChannel[] {
  const channels: ImpostorChannel[] = [
    { name: COLOR_CHANNEL, bake: () => output },
    { name: NORMAL_CHANNEL, bake: (part) => vec4(bakedNormal(part), float(part.kind === 'leaves' ? 1 : 0)) },
    {
      name: SEASON_CHANNEL,
      bake: (part) => {
        if (part.kind === 'wood') return vec4(...encodeSeasonTexel(null));
        const aSeason = attribute<'vec3'>('aSeason', 'vec3');
        return vec4(aSeason.x.mul(SEASON_SHIFT_SCALE).add(0.5), aSeason.y, aSeason.z, 1);
      },
    },
  ];
  if (hasImpostorFeatures(features)) {
    // aOcclusion is only generated when Structural Occlusion is on.
    const occlusion = features.nodes.occlusion ? attribute<'float'>('aOcclusion', 'float') : float(0);
    channels.push({ name: FEATURES_CHANNEL, bake: () => featureTexel(positionGeometry, occlusion, bounds) });
  }
  if (paint) channels.push({ name: PAINT_CHANNEL, bake: (part) => (part.paint ? paintTexel(part.paint) : vec4(0)) });
  return channels;
}

/**
 * The channels of the wood layer: the wood alone (colour with coverage, normal), so an Impostor shows
 * bare branches where its leaves have dropped instead of holes.
 */
export function impostorWoodChannels(): ImpostorChannel[] {
  return [
    { name: WOOD_COLOR_CHANNEL, bake: () => output },
    { name: WOOD_NORMAL_CHANNEL, bake: () => vec4(bakedNormal(), 0) },
  ];
}

/** One render target of the bake: the parts drawn into it and the atlases (channels) it holds. */
interface ImpostorLayer {
  kinds: readonly ImpostorBakePart['kind'][];
  channels: readonly ImpostorChannel[];
  target: RenderTarget;
}

/** The tree's centre and the half size of a frame, from its wood and leaves (Fruit is not on Impostors). */
export function impostorBounds(parts: readonly GeometryBuffers[]): ImpostorBounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, positions[i + c]!);
        max[c] = Math.max(max[c]!, positions[i + c]!);
      }
    }
  }
  if (min[0] === Infinity) return { center: [0, 0, 0], half: 1 };
  const center = [0, 1, 2].map((c) => (min[c]! + max[c]!) / 2) as [number, number, number];
  let radius = 0;
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 3) {
      radius = Math.max(radius, Math.hypot(positions[i]! - center[0], positions[i + 1]! - center[1], positions[i + 2]! - center[2]));
    }
  }
  return { center, half: Math.max(radius, 1e-3) * FRAME_MARGIN };
}

/**
 * Where the bake draws the tree for frame (i, j): seen from the frame's direction (its basis turned
 * to the camera's axes), scaled so the frame spans 2·half, moved into its cell of the atlas. The bake
 * camera is orthographic over the atlas (0..1 in x and y), so one draw renders every frame.
 */
export function frameTransform(i: number, j: number, frames: number, bounds: ImpostorBounds): Matrix4 {
  const { right, up, forward } = frameBasis(frameDirection(i, j, frames));
  const s = 1 / (2 * bounds.half);
  const [cx, cy, cz] = bounds.center;
  const rows = [right, up, forward].map(([x, y, z]) => [x * s, y * s, z * s, -(x * cx + y * cy + z * cz) * s]);
  const m = new Matrix4().set(
    rows[0]![0]! / frames, rows[0]![1]! / frames, rows[0]![2]! / frames, (rows[0]![3]! + 0.5 + i) / frames,
    rows[1]![0]! / frames, rows[1]![1]! / frames, rows[1]![2]! / frames, (rows[1]![3]! + 0.5 + j) / frames,
    rows[2]![0]!, rows[2]![1]!, rows[2]![2]!, rows[2]![3]!,
    0, 0, 0, 1,
  );
  return m;
}

/**
 * The unlit bake materials of the wood and the leaves (Growth 1, no Wind, no Season mask), and what
 * paints the leaves when they are painted Leaf Masses (else null).
 */
function bakeMaterials(
  definition: TreeDefinition,
  textures?: TextureOptions,
): { wood: MeshBasicNodeMaterial; leaves: MeshBasicNodeMaterial; paint: LeafMassPaint | null } {
  const bark = createBarkMaterial(definition, textures, float(1));
  const wood = new MeshBasicNodeMaterial();
  wood.name = 'tree.js impostor bake wood';
  wood.colorNode = bark.colorNode;
  bark.dispose();

  const leaf = createLeafMaterial(definition, textures);
  const leaves = new MeshBasicNodeMaterial();
  leaves.name = 'tree.js impostor bake leaves';
  leaves.vertexColors = true; // the Seed's per-leaf tint; the Season colour is applied when drawn
  leaves.side = DoubleSide;
  if (leaf.map) {
    // Card texture: its colour (white on painted Leaf Masses: the texture is paint values), cut at
    // alphaTest; covered texels stay fully opaque (coverage).
    const card = leaf.colorNode as Node<'vec4'>;
    leaves.colorNode = vec4(card.rgb, 1);
    leaves.maskNode = card.a.greaterThanEqual(leaf.alphaTest);
  }
  const paint = leaf instanceof PaintedNodeMaterial ? leaf.massPaint : null;
  leaf.dispose();
  return { wood, leaves, paint };
}

/** Rows of the card: the Wind bends it with height, so it needs more than one row of quads. */
const CARD_ROWS = 4;

/** The card: a square from (−1, −1) to (1, 1) in x and y, in `CARD_ROWS` rows. */
function cardGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= CARD_ROWS; row++) {
    const v = row / CARD_ROWS;
    positions.push(-1, v * 2 - 1, 0, 1, v * 2 - 1, 0);
    uvs.push(0, v, 1, v);
    if (row < CARD_ROWS) {
      const a = row * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(index);
  return geometry;
}

/** A render target for one layer's atlases (one texture per channel, named after it). */
function layerTarget(size: number, channels: readonly ImpostorChannel[]): RenderTarget {
  const target = new RenderTarget(size, size, {
    count: channels.length,
    type: UnsignedByteType,
    depthBuffer: true,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  channels.forEach((channel, i) => (target.textures[i]!.name = channel.name));
  return target;
}

/** What the Impostor of one Variant is made from. */
export interface VariantImpostorOptions {
  definition: TreeDefinition;
  /** The Variant's vertex data the bake draws (shared: never disposed by the Impostor). */
  sources: { wood: BufferGeometry; leaves: BufferGeometry };
  /** The tree's centre and the half size of a frame: `impostorBounds` of the wood and leaves. */
  bounds: ImpostorBounds;
  atlas: Required<ImpostorAtlasOptions>;
  /** Name of the card mesh. */
  name: string;
  /** Where the Definition's textures load from. */
  textures?: TextureOptions;
  /** The Forest's live Material Feature uniforms and the Variant's Crown Volume; null when none is on. */
  features?: ImpostorFeatures | null;
  /** The Wind the cards sway with and the Variant's response to it. */
  wind?: { source: WindSource; response: WindResponse };
}

/**
 * The Impostor of one Variant: the atlases (allocated at once, filled by `bake`), the card material
 * that samples them, and the card geometry. `part` is what the Variant's Impostor Detail Level draws.
 *
 * Two layers are baked: the tree (wood and leaves, with the leaves' Season timing; in two passes when it
 * has more than four channels) and the wood alone, which shows where leaves have dropped.
 */
export class VariantImpostor {
  readonly frames: number;
  readonly bounds: ImpostorBounds;
  /** The channels of every layer (one atlas each). */
  readonly channels: readonly ImpostorChannel[];
  /** The Impostor level's single mesh: a card per tree. */
  readonly part: LevelPart;
  private readonly definition: TreeDefinition;
  private readonly sources: { wood: BufferGeometry; leaves: BufferGeometry };
  private readonly textures: TextureOptions | undefined;
  private readonly layers: readonly ImpostorLayer[];
  private baked = false;

  constructor({ definition, sources, bounds, atlas, name, textures, features = null, wind }: VariantImpostorOptions) {
    this.definition = definition;
    this.sources = sources;
    this.textures = textures;
    this.frames = atlas.frames;
    this.bounds = bounds;
    const layer = (kinds: ImpostorLayer['kinds'], channels: ImpostorChannel[]): ImpostorLayer => ({ kinds, channels, target: layerTarget(atlas.size, channels) });
    // The tree's channels in passes of at most MAX_ATTACHMENTS, then the wood layer.
    const tree = impostorChannels(this.bounds, features, paintsLeafMasses(definition));
    const treeLayers = Array.from({ length: Math.ceil(tree.length / MAX_ATTACHMENTS) }, (_, i) =>
      layer(['wood', 'leaves'], tree.slice(i * MAX_ATTACHMENTS, (i + 1) * MAX_ATTACHMENTS)),
    );
    this.layers = [...treeLayers, layer(['wood'], impostorWoodChannels())];
    this.channels = this.layers.flatMap((l) => l.channels);
    this.part = { name, geometry: cardGeometry(), material: createImpostorMaterial(definition, this.atlases, features, wind) };
  }

  /** The atlases by channel name. */
  get atlases(): ImpostorAtlases {
    const textures: Record<string, Texture> = {};
    for (const { channels, target } of this.layers) channels.forEach((channel, i) => (textures[channel.name] = target.textures[i]!));
    return { frames: this.frames, bounds: this.bounds, textures };
  }

  /** Whether `bake` has run. */
  get isBaked(): boolean {
    return this.baked;
  }

  /**
   * Renders every frame into the atlases with the app's renderer, one pass per layer, then restores
   * the renderer as it was. Deterministic: the same Definition and Variant Seed give the same atlases.
   */
  bake(renderer: Renderer): void {
    const frames = this.frames;
    const materials: MeshBasicNodeMaterial[] = [];
    const meshes: InstancedMesh[] = [];
    const scenes = this.layers.map(({ kinds, channels }) => {
      // Each layer has its own materials: their MRT outputs are the layer's channels.
      const layerMaterials = bakeMaterials(this.definition, this.textures);
      materials.push(layerMaterials.wood, layerMaterials.leaves);
      const scene = new Scene();
      for (const kind of kinds) {
        const source = this.sources[kind];
        if ((source.getIndex()?.count ?? 0) === 0) continue;
        const material = layerMaterials[kind];
        const part: ImpostorBakePart = { kind, geometry: source, material, paint: kind === 'leaves' ? layerMaterials.paint : null };
        material.mrtNode = mrt(Object.fromEntries(channels.map((c) => [c.name, c.bake(part)])));
        // Shares the Variant's vertex data (never disposed here: that would free the shared buffers).
        const geometry = new BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
        geometry.setIndex(source.getIndex());
        const mesh = new InstancedMesh(geometry, material, frames * frames);
        for (let j = 0; j < frames; j++) {
          for (let i = 0; i < frames; i++) mesh.setMatrixAt(j * frames + i, frameTransform(i, j, frames, this.bounds));
        }
        mesh.frustumCulled = false;
        scene.add(mesh);
        meshes.push(mesh);
      }
      return scene;
    });
    const camera = new OrthographicCamera(0, 1, 1, 0, 0, 2);
    camera.position.set(0, 0, 1);
    camera.updateMatrixWorld();

    const state = RendererUtils.resetRendererState(renderer, {} as Parameters<typeof RendererUtils.resetRendererState>[1]);
    try {
      renderer.setClearColor(0x000000, 0);
      this.layers.forEach(({ target }, i) => {
        renderer.setRenderTarget(target);
        renderer.render(scenes[i]!, camera);
      });
    } finally {
      RendererUtils.restoreRendererState(renderer, state);
      for (const mesh of meshes) mesh.dispose();
      for (const material of materials) material.dispose();
    }
    this.baked = true;
  }

  /** Frees the atlases, the card geometry and its material (the level mesh's geometry belongs to the levels). */
  dispose(): void {
    for (const { target } of this.layers) target.dispose();
    this.part.geometry.dispose();
    this.part.material.dispose();
  }
}
