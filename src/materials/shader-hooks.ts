import {
  cross,
  dot,
  float,
  Fn,
  materialColor,
  materialRoughness,
  modelWorldMatrix,
  normalWorld,
  positionWorld,
  select,
  varying,
  varyingProperty,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { Group, type BufferGeometry, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import type { Shading } from '../definition';
import { TREE_PARTS, type TreePart } from '../effects/mask';
import { setWindMotion, windMotionOf } from '../wind/motion';

/** What a {@link TreeShaderHook} is given: TSL nodes of the fragment it shades, and which tree part it shades. */
export interface TreeShaderInput {
  /** The tree part the hook shades: 'bark', 'leaves' or 'fruit'. */
  part: TreePart;
  /**
   * The tree's shading model (its Style): 'flat' (low-poly), 'toon' (stylized), 'standard' (realistic),
   * 'painted' (painterly), 'whimsical' (whimsical), 'enchanted' (enchanted) or 'stylized-painted' (stylized
   * painterly, drawn like 'painted': see `isPaintedShading`). The ready-made weather hooks draw each in its own way.
   */
  shading: Shading;
  /**
   * The base colour (linear rgb): after Season, Ground Tint, textures and the Seed's tint, before lighting.
   * In a stack of hooks: the colour the hook before returned.
   */
  color: Node<'vec3'>;
  /** The part's roughness (0..1) before the hook (in a stack: the one the hook before returned, if any). */
  roughness: Node<'float'>;
  /**
   * The world-space normal the fragment is lit with, after Wind (and Wind Bursts) and Growth, with Crown
   * Normals and the bark normal map; facing the viewer on both sides of a leaf card. On an Impostor: its
   * baked normal, turned with the tree and its sway.
   */
  normal: Node<'vec3'>;
  /** The fragment's world position (after Wind and Growth). */
  position: Node<'vec3'>;
  /** The tree's own world position (its origin, at the foot of the trunk). */
  treePosition: Node<'vec3'>;
  /** The tree's Season (0..1). */
  season: Node<'float'>;
  /** The tree's Growth (0..1). */
  growth: Node<'float'>;
}

/** What a {@link TreeShaderHook} may return instead of a bare colour. */
export interface TreeShaderOutput {
  /** The new colour (linear rgb), lit as before. */
  color: Node<'vec3'>;
  /** The new roughness (0..1); the part's own when absent. */
  roughness?: Node<'float'>;
}

/**
 * A Tree Shader Hook (GLOSSARY, ADR 0012): a TSL function the app hands the library for a tree part. It
 * gets the part's base colour and inputs (see {@link TreeShaderInput}) and returns a new colour, or a
 * colour and a roughness. It is called once each time it is set (to build the node graph), not per frame:
 * animate it with uniforms.
 */
export type TreeShaderHook = (input: TreeShaderInput) => Node<'vec3'> | TreeShaderOutput;

/**
 * The Tree Shader Hooks per tree part: one hook, or several that stack (each gets the colour and
 * roughness the one before returned). A part left out (or `undefined`) has only the scene-wide default
 * hooks ({@link setSceneShaderHooks}); a part's own hooks stack after those; `null` overrides them: the
 * part is drawn with no hook at all. See {@link shaderHookOrder} for the order.
 */
export type TreeShaderHooks = Partial<Record<TreePart, TreeShaderHook | readonly TreeShaderHook[] | null>>;

// The hooks the library ships (Snow Cover, Wetness): they run before the app's own.
const readyMade = new WeakSet<TreeShaderHook>();

/**
 * @internal Marks a hook the library ships (Snow Cover, Wetness) as ready-made: in every stack it runs
 * before the app's own hooks (see {@link shaderHookOrder}). Returns the hook.
 */
export function readyMadeShaderHook<T extends TreeShaderHook>(hook: T): T {
  readyMade.add(hook);
  return hook;
}

const listOf = (value: TreeShaderHook | readonly TreeShaderHook[] | null | undefined): readonly TreeShaderHook[] =>
  value ? (typeof value === 'function' ? [value] : value) : [];

/**
 * The hooks a tree part runs, in their fixed order: first the ready-made hooks (Snow Cover, Wetness), then
 * the app's own; within each group the scene-wide default's before the Tree's or Forest's own, each in the
 * order given. A hook listed twice runs once (at its first place). A part set to `null` on the Tree or
 * Forest runs none, not even the scene-wide default's.
 */
export function shaderHookOrder(scene: TreeShaderHooks, own: TreeShaderHooks, part: TreePart): TreeShaderHook[] {
  if (own[part] === null) return [];
  const all = [...new Set([...listOf(scene[part]), ...listOf(own[part])])];
  return [...all.filter((h) => readyMade.has(h)), ...all.filter((h) => !readyMade.has(h))];
}

/**
 * Stacks sets of hooks into one: per part, the hooks of every set in the given order (as a list), e.g.
 * `stackShaderHooks(snowCover, { leaves: painterly })`. A part that is `null` in a set and has no hook in
 * any set stays `null`.
 */
export function stackShaderHooks(...sets: readonly TreeShaderHooks[]): TreeShaderHooks {
  const stacked: TreeShaderHooks = {};
  for (const part of TREE_PARTS) {
    const hooks = sets.flatMap((set) => listOf(set[part]));
    if (hooks.length > 0) stacked[part] = hooks;
    else if (sets.some((set) => set[part] === null)) stacked[part] = null;
  }
  return stacked;
}

/** A copy of `hooks` without the parts that are `undefined`. */
function cleaned(hooks: TreeShaderHooks): TreeShaderHooks {
  const copy: TreeShaderHooks = {};
  for (const part of TREE_PARTS) {
    const value = hooks[part];
    if (value !== undefined) copy[part] = Array.isArray(value) ? [...(value as TreeShaderHook[])] : value;
  }
  return copy;
}

// The scene-wide default hooks, and every Tree's and Forest's hooks that follow them.
let sceneHooks: TreeShaderHooks = {};
const followers = new Set<WeakRef<LiveShaderHooks>>();

/**
 * Sets the scene-wide default Tree Shader Hooks: every Tree and Forest runs them (now and when created
 * later), before its own hooks, unless it sets that part to `null`. `{}` removes them. Only the parts
 * whose hooks change rebuild their node graphs, once; the geometry is never rebuilt.
 */
export function setSceneShaderHooks(hooks: TreeShaderHooks): void {
  sceneHooks = cleaned(hooks);
  for (const ref of followers) {
    const live = ref.deref();
    if (live) live.refresh();
    else followers.delete(ref);
  }
}

/** The scene-wide default Tree Shader Hooks (a copy), see {@link setSceneShaderHooks}. */
export function getSceneShaderHooks(): TreeShaderHooks {
  return cleaned(sceneHooks);
}

/**
 * One material hooks are applied to: a Tree's part, a Forest Variant's part (drawn at every Detail Level
 * but Impostor), or a Forest Variant's Impostor card, which draws several parts.
 */
export interface ShaderHookTarget {
  material: MeshStandardNodeMaterial;
  /** The tree parts the material draws, and (when it draws several) how much of each a fragment is (0..1). */
  parts: readonly TreePart[];
  partWeight?: (part: TreePart) => Node<'float'>;
  /** Whether the material multiplies in per-vertex colours (the Seed's tint): `vertexColors` and a `color` attribute. */
  vertexColors: boolean;
  season: Node<'float'>;
  growth: Node<'float'>;
  /** The tree's world position (a node the fragment stage can read). Default: see `treeBase`. */
  treePosition?: Node<'vec3'>;
  /**
   * The tree's base in the material's object space, as the vertex stage knows it before `positionNode`
   * runs (a Forest instance). It is handed to the fragment stage only when a hook reads `treePosition`.
   * Without it nor `treePosition`: the origin of the drawn object.
   */
  treeBase?: Node<'vec3'>;
  /**
   * The Wind displacement of the vertex in the material's object space (attributes and uniforms only).
   * Default: the one registered with the material's `positionNode` (`setWindMotion`).
   */
  sway?: Node<'vec3'> | null;
}

/**
 * The {@link ShaderHookTarget} of one tree part drawn by `material` from `geometry` (a Tree's part, or a
 * Forest Variant's): it multiplies in vertex colours when the material uses them and the geometry has them.
 */
export function partHookTarget(
  part: TreePart,
  material: MeshStandardNodeMaterial,
  geometry: BufferGeometry,
  inputs: Pick<ShaderHookTarget, 'season' | 'growth' | 'treeBase'>,
): ShaderHookTarget {
  return { parts: [part], material, vertexColors: material.vertexColors && geometry.hasAttribute('color'), ...inputs };
}

const isNode = (value: Node<'vec3'> | TreeShaderOutput): value is Node<'vec3'> => (value as { isNode?: boolean }).isNode === true;

/** The material nodes hooks replace, as they were without one. */
interface Original {
  colorNode: MeshStandardNodeMaterial['colorNode'];
  roughnessNode: MeshStandardNodeMaterial['roughnessNode'];
  positionNode: MeshStandardNodeMaterial['positionNode'];
  vertexColors: boolean;
}

/**
 * The normal three lights a smooth-shaded fragment with does not move with `positionNode` (only flat
 * shading takes its facets from the moved positions). This turns it by how the Wind turned the surface:
 * from the facet of the unswayed positions to that of the swayed ones (screen-space derivatives, a
 * world-space sway varying), which also covers anything else added to the Wind displacement.
 */
function swayedNormal(normal: Node<'vec3'>, sway: Node<'vec3'>): Node<'vec3'> {
  const swayWorld = varying(modelWorldMatrix.mul(vec4(sway, 0)).xyz);
  const moved = positionWorld;
  const still = moved.sub(swayWorld);
  const to = cross(moved.dFdx(), moved.dFdy());
  const from = cross(still.dFdx(), still.dFdy());
  const a = from.normalize();
  const b = to.normalize();
  const axis = cross(a, b);
  const c = dot(a, b);
  // Rodrigues: the rotation that takes a to b, applied to the normal.
  const rotated = normal
    .mul(c)
    .add(cross(axis, normal))
    .add(axis.mul(dot(axis, normal).div(c.add(1).max(1e-4))))
    .normalize();
  const valid = dot(from, from).greaterThan(1e-20).and(dot(to, to).greaterThan(1e-20)).and(c.greaterThan(-0.5));
  return select(valid, rotated, normal);
}

/**
 * The Tree Shader Hooks of a Tree or Forest: applies the hooks of each part (its own stacked after the
 * scene-wide default's, {@link shaderHookOrder}) to that part's materials. A change rebuilds the node graph
 * of the affected materials once (new `colorNode` / `roughnessNode`, `needsUpdate`), never the geometry;
 * removing every hook puts the material's own nodes back as they were. A part whose hooks do not change is
 * left alone. With no hook the materials are never touched (ADR 0008).
 */
export class LiveShaderHooks {
  private own: TreeShaderHooks = {};
  private stacks: Record<TreePart, TreeShaderHook[]> = { bark: [], leaves: [], fruit: [] };
  private readonly targets: ShaderHookTarget[] = [];
  private readonly originals = new Map<MeshStandardNodeMaterial, Original>();
  private readonly ref = new WeakRef(this);

  constructor(
    targets: readonly ShaderHookTarget[],
    private readonly shading: Shading,
    own: TreeShaderHooks = {},
  ) {
    followers.add(this.ref);
    this.own = cleaned(own);
    this.stacks = this.resolve();
    this.addTargets(targets);
  }

  /** The own hooks per part (a copy), as set. */
  get hooks(): TreeShaderHooks {
    return cleaned(this.own);
  }

  set hooks(value: TreeShaderHooks) {
    this.own = cleaned(value);
    this.refresh();
  }

  /** Adds materials made later (a Forest's Impostor cards), with the current hooks applied. */
  addTargets(targets: readonly ShaderHookTarget[]): void {
    for (const target of targets) {
      this.targets.push(target);
      if (target.parts.some((part) => this.stacks[part].length > 0)) this.apply(target);
    }
  }

  /** Re-resolves the hooks (after the own or the scene-wide default ones changed) and rebuilds what changed. */
  refresh(): void {
    const next = this.resolve();
    const changed = TREE_PARTS.filter((part) => next[part].length !== this.stacks[part].length || next[part].some((h, i) => h !== this.stacks[part][i]));
    this.stacks = next;
    for (const target of this.targets) if (target.parts.some((part) => changed.includes(part))) this.apply(target);
  }

  /** Stops following the scene-wide default hooks. */
  dispose(): void {
    followers.delete(this.ref);
  }

  private resolve(): Record<TreePart, TreeShaderHook[]> {
    return {
      bark: shaderHookOrder(sceneHooks, this.own, 'bark'),
      leaves: shaderHookOrder(sceneHooks, this.own, 'leaves'),
      fruit: shaderHookOrder(sceneHooks, this.own, 'fruit'),
    };
  }

  private apply(target: ShaderHookTarget): void {
    const { material } = target;
    let original = this.originals.get(material);
    if (!original) {
      original = {
        colorNode: material.colorNode,
        roughnessNode: material.roughnessNode,
        positionNode: material.positionNode,
        vertexColors: material.vertexColors,
      };
      this.originals.set(material, original);
    }
    material.colorNode = original.colorNode;
    material.roughnessNode = original.roughnessNode;
    material.positionNode = original.positionNode;
    material.vertexColors = original.vertexColors;
    material.needsUpdate = true;
    const parts = target.parts.filter((part) => this.stacks[part].length > 0);
    if (parts.length === 0) {
      this.originals.delete(material);
      return;
    }

    // The colour three would make: the colour node (or material colour) times the vertex colours, which
    // are now multiplied in here so the hooks see them.
    const base = vec4((original.colorNode as Node<'vec4'> | null) ?? (materialColor as unknown as Node<'vec4'>));
    const tinted = target.vertexColors ? base.mul(vertexColor()) : base;
    const roughness = float((original.roughnessNode as Node<'float'> | null) ?? materialRoughness);
    const lazy = <T>(make: () => T): (() => T) => {
      let value: T | undefined;
      return () => (value ??= make());
    };
    const normal = lazy(() => {
      const sway = target.sway === undefined ? windMotionOf(original.positionNode)?.offset : target.sway;
      return sway && !material.flatShading ? swayedNormal(normalWorld, sway) : normalWorld;
    });
    const treePosition = lazy(() => {
      if (target.treePosition) return target.treePosition;
      if (!target.treeBase) return modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
      // Handed over from the vertex stage before `positionNode` moves the vertex (only now that it is read).
      const captured = varyingProperty('vec3', 'vTreeBase');
      const treeBase = target.treeBase;
      const position = original.positionNode as Node<'vec3'>;
      material.positionNode = Fn(() => {
        captured.assign(treeBase);
        return position;
      })();
      const motion = windMotionOf(position);
      if (motion) setWindMotion(material.positionNode, motion);
      return modelWorldMatrix.mul(vec4(captured, 1)).xyz;
    });

    let color: Node<'vec3'> = vec3(0);
    let rough: Node<'float'> = float(0);
    let roughnessChanged = false;
    for (const part of target.parts) {
      let partColor: Node<'vec3'> = tinted.rgb;
      let partRoughness: Node<'float'> = roughness;
      for (const hook of this.stacks[part]) {
        const input = { part, shading: this.shading, color: partColor, roughness: partRoughness, position: positionWorld, season: target.season, growth: target.growth };
        Object.defineProperties(input, {
          normal: { get: normal, enumerable: true },
          treePosition: { get: treePosition, enumerable: true },
        });
        const result = hook(input as TreeShaderInput);
        const output = isNode(result) ? { color: result } : result;
        partColor = output.color;
        if (output.roughness) {
          partRoughness = output.roughness;
          roughnessChanged = true;
        }
      }
      if (target.parts.length === 1) {
        color = partColor;
        rough = partRoughness;
      } else {
        const weight = target.partWeight!(part);
        color = color.add(partColor.mul(weight));
        rough = rough.add(partRoughness.mul(weight));
      }
    }
    material.colorNode = vec4(color, tinted.a);
    material.vertexColors = false;
    if (roughnessChanged) material.roughnessNode = rough;
  }
}

/** @internal What a Tree and a Forest share: a group of tree meshes with Tree Shader Hooks. */
export abstract class ShaderHookedGroup extends Group {
  protected abstract readonly hooks: LiveShaderHooks;

  /**
   * The Tree Shader Hook per tree part (GLOSSARY, ADR 0012), e.g. `{ leaves: ({ color }) => color.mul(0.8) }`:
   * a TSL function (or a list of them, which stack) that gets the part's base colour, world normal, world
   * positions, Season and Growth and returns a new colour (optionally with a roughness). Assign a new
   * object to set, change or remove hooks: a part left out has only the scene-wide default hooks
   * (`setSceneShaderHooks`), its own run after those, and `null` runs none at all. Only the parts whose
   * hooks changed rebuild their node graph, once; the geometry is never rebuilt. Without a hook a part is
   * drawn exactly as before. On a Forest they reach every tree at every Detail Level, and the Impostors,
   * which apply them at draw time to their baked colour, normals and Season data (changing a hook never
   * rebakes).
   */
  get shaderHooks(): TreeShaderHooks {
    return this.hooks.hooks;
  }

  set shaderHooks(value: TreeShaderHooks) {
    this.hooks.hooks = value;
  }
}
