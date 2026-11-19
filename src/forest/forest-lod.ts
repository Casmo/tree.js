// A Forest's Detail Levels (ADR 0010): what a lod Forest adds to a plain one. The settings and their
// uniforms, the backend found on the first render, the Variants' Detail Level meshes, the Impostor
// bake and `lodReady`. The Forest owns one when `lod` is set and forwards to it.
import { Matrix4, Vector3, type Camera, type Mesh, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { MaterialFeatureNodes } from '../materials/material-features';
import { webgpuRenderer } from '../renderer';
import type { ForestVariant } from './Forest';
import { LevelSelection, type DetailLevelUniforms } from './levels';
import { checkDetailLevelDistances, DetailLevel, type DetailLevelDistances, type ForestLodSettings, type ForestLodUpdate } from './lod';

/** What the Detail Levels need from their Forest. */
export interface ForestLodHost {
  /** The Forest: its world matrix places the trees, and the Detail Level meshes are added to it. */
  readonly object: Object3D;
  readonly variants: readonly ForestVariant[];
  /** Resolves once the Definition's textures have loaded (the Impostors are baked with them). */
  readonly texturesReady: Promise<void>;
  /** The Forest's live Material Feature uniforms (the Impostor cards use them too). */
  readonly features: MaterialFeatureNodes | null;
}

/**
 * The Detail Levels of one Forest. Which backend draws the Forest is only known on its first render
 * (three calls `onBeforeRender` with the renderer then, and not before), so:
 *
 * - On WebGPURenderer's WebGL2 fallback (`detect`): one console warning, `lod` is ignored and `ready`
 *   resolves on that first render.
 * - On WebGPU: that first frame still draws every tree in full. Right after it, every Variant gets its
 *   Detail Level meshes (they cannot join a frame whose render list is already made), the Impostors are
 *   baked once the textures have loaded, and then `ready` resolves.
 */
export class ForestLod {
  /** The live values the GPU level selection reads. */
  readonly uniforms: DetailLevelUniforms;
  /** Resolves once the Impostors are baked; on the WebGL2 fallback on the first render; on dispose. */
  readonly ready: Promise<void>;
  private readonly settings: ForestLodSettings;
  private readonly selection: LevelSelection;
  private backend: 'unknown' | 'webgpu' | 'webgl' = 'unknown';
  private resolveReady: () => void = () => {};
  private disposed = false;

  constructor(
    settings: ForestLodSettings,
    private readonly host: ForestLodHost,
  ) {
    this.settings = settings;
    this.uniforms = {
      light: uniform(settings.light),
      impostor: uniform(settings.impostor),
      fade: uniform(settings.fade),
      camera: uniform(new Vector3()),
      forest: uniform(new Matrix4()),
      // Until the Impostors are baked, trees beyond the Impostor distance draw Light.
      farthest: uniform(DetailLevel.Light, 'uint'),
    };
    this.selection = new LevelSelection(this.uniforms);
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
  }

  /** The settings (a copy). */
  get values(): ForestLodSettings {
    return { ...this.settings, impostorAtlas: { ...this.settings.impostorAtlas } };
  }

  /** Sets distances, fade or camera (the others kept): only uniforms. Throws a RangeError for invalid values, keeping the old ones. */
  update(value: ForestLodUpdate): void {
    const { settings, uniforms } = this;
    const next: DetailLevelDistances = {
      light: value.light ?? settings.light,
      impostor: value.impostor ?? settings.impostor,
      fade: value.fade ?? settings.fade,
    };
    checkDetailLevelDistances(next);
    Object.assign(settings, next);
    if (value.camera !== undefined) settings.camera = value.camera;
    uniforms.light.value = next.light;
    uniforms.impostor.value = next.impostor;
    uniforms.fade.value = next.fade;
  }

  /** Whether the Detail Levels are drawn: the first render was on WebGPU (not the WebGL2 fallback). */
  get active(): boolean {
    return this.backend === 'webgpu';
  }

  /**
   * Called before each of the Forest's instanced meshes is drawn: notes the camera and, on the first
   * render, finds the backend (see the class).
   */
  detect(renderer: Renderer, scene: Scene | null, camera: Camera | null): void {
    this.selection.observe(scene, camera);
    if (this.backend !== 'unknown') return;
    const backend: object | undefined = renderer.backend;
    if (backend && 'isWebGLBackend' in backend && backend.isWebGLBackend === true) {
      this.backend = 'webgl';
      console.warn(
        'tree.js: Forest Detail Levels (lod) need WebGPU; on WebGPURenderer\'s WebGL2 fallback this Forest ignores lod and draws every tree in full.',
      );
      this.resolveReady();
    } else {
      this.backend = 'webgpu';
      queueMicrotask(() => {
        if (this.disposed) return this.resolveReady();
        this.enable();
        void this.bake(renderer);
      });
    }
  }

  /**
   * How many trees each Detail Level drew in the last frame (indexed by DetailLevel; a tree in a
   * cross-fade counts at both levels). All zero until the Detail Levels are drawn. Reads the GPU.
   */
  async counts(renderer: Renderer): Promise<number[]> {
    const counts = [0, 0, 0];
    for (const variant of this.host.variants) {
      if (!variant.levels) continue;
      const drawn = await variant.levels.drawnCounts(renderer);
      drawn.forEach((count, level) => (counts[level]! += count));
    }
    return counts;
  }

  /** Stops what is pending (the Detail Level meshes, the bake) and resolves `ready`: nothing is left to wait for. */
  dispose(): void {
    this.disposed = true;
    this.resolveReady();
  }

  /** Builds every Variant's Detail Level meshes and buffers. */
  private enable(): void {
    const setupMesh = (mesh: Mesh) => {
      mesh.onBeforeRender = (renderer, scene, camera) => this.select(webgpuRenderer(renderer), scene, camera);
    };
    for (const variant of this.host.variants) variant.enableDetailLevels(this.uniforms, this.settings, setupMesh, this.host.features);
  }

  /**
   * Bakes every Variant's Impostor with the app's renderer (after the textures have loaded), then lets
   * far trees draw as Impostors and resolves `ready`. Until then they draw Light. If the bake fails,
   * they keep drawing Light (one console error) and `ready` still resolves.
   */
  private async bake(renderer: Renderer): Promise<void> {
    try {
      await this.host.texturesReady.catch(() => {}); // a texture that failed to load bakes as without it
      if (this.disposed) return;
      for (const variant of this.host.variants) variant.impostor!.bake(renderer);
      this.uniforms.farthest.value = DetailLevel.Impostor;
    } catch (error) {
      console.error('tree.js: baking the Forest Impostors failed; far trees draw Light.', error);
    } finally {
      this.resolveReady();
    }
  }

  /**
   * Before a Detail Level mesh is drawn: the first time in a frame, picks every tree's level for the
   * camera that picks the levels, on the GPU (shadow passes and other cameras reuse that frame's levels).
   */
  private select(renderer: Renderer, scene: Scene | null, camera: Camera | null): void {
    const levels = this.host.variants.map((v) => v.levels!);
    this.selection.prepare(renderer, scene, camera, this.settings.camera, this.host.object, levels);
  }
}
