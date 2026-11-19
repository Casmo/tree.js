import { float, materialColor, materialRoughness, modelWorldMatrix, normalWorld, positionWorld, vec4, vertexColor } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import type { Shading } from '../definition';
import type { TreePart } from '../effects/mask';

/** What a {@link TreeShaderHook} is given: TSL nodes of the fragment it shades, and which tree part it shades. */
export interface TreeShaderInput {
  /** The tree part the hook shades: 'bark', 'leaves' or 'fruit'. */
  part: TreePart;
  /** The tree's shading model (its Style): 'flat' (low-poly), 'toon' (stylized) or 'standard' (realistic). */
  shading: Shading;
  /** The base colour (linear rgb): after Season, Ground Tint, textures and the Seed's tint, before lighting. */
  color: Node<'vec3'>;
  /** The part's roughness (0..1) before the hook. */
  roughness: Node<'float'>;
  /**
   * The world-space normal the fragment is lit with: of the surface after Wind and Growth (the swayed
   * facets under flat shading), with Crown Normals and the bark normal map; facing the viewer on both
   * sides of a leaf card.
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

/** The Tree Shader Hook per tree part; a part without one is drawn as before. */
export type TreeShaderHooks = Partial<Record<TreePart, TreeShaderHook>>;

/** One material a hook is applied to (a Tree's part; a Forest Variant's part, later). */
export interface ShaderHookTarget {
  part: TreePart;
  material: MeshStandardNodeMaterial;
  /** Whether the material multiplies in per-vertex colours (the Seed's tint): `vertexColors` and a `color` attribute. */
  vertexColors: boolean;
  season: Node<'float'>;
  growth: Node<'float'>;
  /** The tree's world position. Default: the origin of the drawn object. */
  treePosition?: Node<'vec3'>;
}

const isNode = (value: Node<'vec3'> | TreeShaderOutput): value is Node<'vec3'> => (value as { isNode?: boolean }).isNode === true;

/** The material nodes a hook replaces, as they were without one. */
interface Original {
  colorNode: MeshStandardNodeMaterial['colorNode'];
  roughnessNode: MeshStandardNodeMaterial['roughnessNode'];
  vertexColors: boolean;
}

/**
 * The Tree Shader Hooks of a tree: applies the hook of each part to that part's materials. Setting a part's
 * hook rebuilds the node graph of its materials once (new `colorNode` / `roughnessNode`, `needsUpdate`),
 * never the geometry; removing it puts the material's own nodes back as they were. A part whose hook does
 * not change is left alone. With no hook the materials are never touched (ADR 0008).
 */
export class LiveShaderHooks {
  private current: TreeShaderHooks = {};
  private readonly originals = new Map<MeshStandardNodeMaterial, Original>();

  constructor(
    private readonly targets: readonly ShaderHookTarget[],
    private readonly shading: Shading,
  ) {}

  /** The hook per part (a copy). */
  get hooks(): TreeShaderHooks {
    return { ...this.current };
  }

  set hooks(value: TreeShaderHooks) {
    const next: TreeShaderHooks = {};
    for (const part of ['bark', 'leaves', 'fruit'] as const) {
      const hook = value[part];
      if (hook) next[part] = hook;
      if (hook === this.current[part]) continue;
      for (const target of this.targets) if (target.part === part) this.apply(target, hook);
    }
    this.current = next;
  }

  private apply(target: ShaderHookTarget, hook: TreeShaderHook | undefined): void {
    const { material } = target;
    let original = this.originals.get(material);
    if (!original) {
      original = { colorNode: material.colorNode, roughnessNode: material.roughnessNode, vertexColors: material.vertexColors };
      this.originals.set(material, original);
    }
    material.colorNode = original.colorNode;
    material.roughnessNode = original.roughnessNode;
    material.vertexColors = original.vertexColors;
    if (hook) {
      // The colour three would make: the colour node (or material colour) times the vertex colours, which
      // are now multiplied in here so the hook sees them.
      const base = vec4((original.colorNode as Node<'vec4'> | null) ?? (materialColor as unknown as Node<'vec4'>));
      const tinted = target.vertexColors ? base.mul(vertexColor()) : base;
      const roughness = (original.roughnessNode as Node<'float'> | null) ?? materialRoughness;
      const result = hook({
        part: target.part,
        shading: this.shading,
        color: tinted.rgb,
        roughness: float(roughness),
        normal: normalWorld,
        position: positionWorld,
        treePosition: target.treePosition ?? modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz,
        season: target.season,
        growth: target.growth,
      });
      const output = isNode(result) ? { color: result } : result;
      material.colorNode = vec4(output.color, tinted.a);
      material.vertexColors = false;
      if (output.roughness) material.roughnessNode = output.roughness;
    } else {
      this.originals.delete(material);
    }
    material.needsUpdate = true;
  }
}
