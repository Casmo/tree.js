// A Variant's Impostor (ADR 0010, GLOSSARY): the atlases baked from frames × frames directions at
// Growth 1, and the card material that draws far trees with them.
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
import { attribute, float, frontFacing, mrt, normalGeometry, output, positionGeometry, select, texture, uv, vec4 } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { GeometryBuffers } from '../generator';
import { createBarkMaterial, createLeafMaterial } from '../materials';
import type { TextureOptions } from '../textures';
import {
  COLOR_CHANNEL,
  createImpostorMaterial,
  FEATURES_CHANNEL,
  featureTexel,
  hasImpostorFeatures,
  NORMAL_CHANNEL,
  type ImpostorAtlases,
  type ImpostorBounds,
  type ImpostorFeatures,
} from './impostor-material';
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
 * The channels an Impostor bakes: colour (rgb, coverage in a) and the tree-space normal (a = leaf
 * flag), plus, only when a Material Feature is on, the features atlas (`FEATURES_CHANNEL`: the
 * pictured point and the raw Structural Occlusion). Season (#76) joins here.
 *
 * Each channel is one RGBA8 attachment of a single render pass: WebGPU's default limit
 * (`maxColorAttachmentBytesPerSample` 32, 8 per RGBA8) allows 4.
 */
export function impostorChannels(bounds: ImpostorBounds, features: ImpostorFeatures | null = null): ImpostorChannel[] {
  const channels: ImpostorChannel[] = [
    { name: COLOR_CHANNEL, bake: () => output },
    {
      name: NORMAL_CHANNEL,
      // Leaves are two-sided: the normal of the side the frame sees.
      bake: (part) => vec4(select(frontFacing, normalGeometry, normalGeometry.negate()).normalize().mul(0.5).add(0.5), float(part.kind === 'leaves' ? 1 : 0)),
    },
  ];
  if (hasImpostorFeatures(features)) {
    // aOcclusion is only generated when Structural Occlusion is on.
    const occlusion = features.nodes.occlusion ? attribute<'float'>('aOcclusion', 'float') : float(0);
    channels.push({ name: FEATURES_CHANNEL, bake: () => featureTexel(positionGeometry, occlusion, bounds) });
  }
  return channels;
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

/** The unlit bake materials of the wood and the leaves (Growth 1, no Wind, no Season mask). */
function bakeMaterials(definition: TreeDefinition, textures?: TextureOptions): { wood: MeshBasicNodeMaterial; leaves: MeshBasicNodeMaterial } {
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
    // Card texture: its colour, cut at alphaTest; covered texels stay fully opaque (coverage).
    const card = texture(leaf.map, uv());
    leaves.colorNode = vec4(card.rgb, 1);
    leaves.maskNode = card.a.greaterThanEqual(leaf.alphaTest);
  }
  leaf.dispose();
  return { wood, leaves };
}

/**
 * The Impostor of one Variant: the atlases (allocated at once, filled by `bake`), the card material
 * that samples them, and the card geometry. `part` is what the Variant's Impostor Detail Level draws.
 */
export class VariantImpostor {
  readonly frames: number;
  readonly bounds: ImpostorBounds;
  readonly channels: readonly ImpostorChannel[];
  /** The Impostor level's single mesh: a card per tree. */
  readonly part: LevelPart;
  private readonly target: RenderTarget;
  private baked = false;

  constructor(
    private readonly definition: TreeDefinition,
    private readonly sources: { wood: BufferGeometry; leaves: BufferGeometry },
    buffers: { wood: GeometryBuffers; leaves: GeometryBuffers },
    atlas: Required<ImpostorAtlasOptions>,
    name: string,
    private readonly textures?: TextureOptions,
    features: ImpostorFeatures | null = null,
  ) {
    this.frames = atlas.frames;
    this.bounds = impostorBounds([buffers.wood, buffers.leaves]);
    this.channels = impostorChannels(this.bounds, features);
    this.target = new RenderTarget(atlas.size, atlas.size, {
      count: this.channels.length,
      type: UnsignedByteType,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    this.channels.forEach((channel, i) => (this.target.textures[i]!.name = channel.name));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.part = { name, geometry, material: createImpostorMaterial(definition, this.atlases, features) };
  }

  /** The atlases by channel name. */
  get atlases(): ImpostorAtlases {
    const textures: Record<string, Texture> = {};
    this.channels.forEach((channel, i) => (textures[channel.name] = this.target.textures[i]!));
    return { frames: this.frames, bounds: this.bounds, textures };
  }

  /** Whether `bake` has run. */
  get isBaked(): boolean {
    return this.baked;
  }

  /**
   * Renders every frame into the atlases with the app's renderer, in one pass, then restores the
   * renderer as it was. Deterministic: the same Definition and Variant Seed give the same atlases.
   */
  bake(renderer: Renderer): void {
    const frames = this.frames;
    const materials = bakeMaterials(this.definition, this.textures);
    const scene = new Scene();
    const meshes: InstancedMesh[] = [];
    for (const kind of ['wood', 'leaves'] as const) {
      const source = this.sources[kind];
      if ((source.getIndex()?.count ?? 0) === 0) continue;
      const material = materials[kind];
      const part: ImpostorBakePart = { kind, geometry: source, material };
      material.mrtNode = mrt(Object.fromEntries(this.channels.map((c) => [c.name, c.bake(part)])));
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
    const camera = new OrthographicCamera(0, 1, 1, 0, 0, 2);
    camera.position.set(0, 0, 1);
    camera.updateMatrixWorld();

    const state = RendererUtils.resetRendererState(renderer, {} as Parameters<typeof RendererUtils.resetRendererState>[1]);
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
    } finally {
      RendererUtils.restoreRendererState(renderer, state);
      for (const mesh of meshes) mesh.dispose();
      materials.wood.dispose();
      materials.leaves.dispose();
    }
    this.baked = true;
  }

  /** Frees the atlases, the card geometry and its material (the level mesh's geometry belongs to the levels). */
  dispose(): void {
    this.target.dispose();
    this.part.geometry.dispose();
    this.part.material.dispose();
  }
}
