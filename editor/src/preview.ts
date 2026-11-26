// Live preview: one Tree on WebGPURenderer, kept in sync with the editor store.
// A new Definition or Seed regenerates the tree; Growth, Season and retuning a Material Feature that
// stays on (Crown Normals amount, Leaf Translucency settings, Structural Occlusion strength) only write
// its uniforms.
// Rendering is on demand (one frame per change, or while the camera moves).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTree, type Tree } from '@casmo/tree.js';
import { framingBox } from './framing';
import { liveInnerGlowChange } from './inner-glow';
import { liveMaterialFeatureChange } from './material-features';
import type { EditorState, EditorStore } from './store';

/** Where the sun stands (its target is the origin): only its direction matters for the light. */
const SUN_DIRECTION = new THREE.Vector3(5, 8, 3);

export type PreviewStatus = 'loading' | 'rendered' | 'error';

export interface PreviewOptions {
  /** Force WebGPURenderer's WebGL2 fallback. */
  forceWebGL?: boolean;
  /** Called whenever the status changes (after each completed render: 'rendered'). */
  onStatus?: (status: PreviewStatus, error?: Error) => void;
}

export class Preview {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  readonly controls: OrbitControls;
  /** The tree on show (replaced when the Definition or Seed changes). */
  tree: Tree | null = null;
  /** The preview's sun (casts shadows only while asked to, see {@link setSunShadows}). */
  readonly sun = new THREE.DirectionalLight('#ffffff', 2.5);
  /** The camera's distance from the framed tree (see {@link frame}), in metres. */
  framingDistance = 10;
  /** Renders completed so far (handy for tests). */
  renders = 0;
  /**
   * Frames every {@link requestRender} draws at least (default 1). Temporal effects raise it: TRAA
   * keeps drawing until it has converged after a camera, Wind or tree change.
   */
  settleFrames = 1;
  /**
   * Draws one frame. Effects preview (#18) can replace this with a RenderPipeline's render.
   * May return a promise (the status turns 'rendered' once it resolves).
   */
  renderFrame: () => void | Promise<void>;

  private readonly container: HTMLElement;
  private readonly options: PreviewOptions;
  private frameRequested = false;
  /** Frames still to draw for the last {@link requestRender}. */
  private framesLeft = 0;
  /** Trees whose textures are still loading. */
  private pendingTextures = 0;
  private ready = false;
  private unsubscribe: () => void = () => {};
  private readonly framedListeners = new Set<() => void>();
  /** The box the camera was framed on (the sun's shadow camera covers it). */
  private framed = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 10, 5));

  constructor(container: HTMLElement, options: PreviewOptions = {}) {
    this.container = container;
    this.options = options;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: options.forceWebGL ?? false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderFrame = () => this.renderer.render(this.scene, this.camera);

    this.scene.background = new THREE.Color('#cfe3f0');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
    this.sun.position.copy(SUN_DIRECTION);
    this.scene.add(this.sun, this.sun.target);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardNodeMaterial({ color: '#7da05a' }),
    );
    ground.name = 'ground';
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Initialises the GPU backend. Returns 'webgpu' or 'webgl2'. */
  async init(): Promise<'webgpu' | 'webgl2'> {
    await this.renderer.init();
    this.ready = true;
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  /** Shows the store's state now and follows every change. */
  connect(store: EditorStore): void {
    this.unsubscribe();
    this.show(store.state, null);
    this.unsubscribe = store.subscribe((state, previous) => this.show(state, previous));
  }

  /** Brings the preview up to date with `state`; `previous` = what is on show now (null: nothing). */
  show(state: EditorState, previous: EditorState | null): void {
    try {
      const regenerate = !this.tree || !previous || state.definition !== previous.definition || state.seed !== previous.seed;
      const retune = regenerate && previous && this.tree && state.seed === previous.seed;
      const live = retune ? liveMaterialFeatureChange(previous.definition, state.definition) : null;
      const glow = retune && !live ? liveInnerGlowChange(previous.definition, state.definition) : null;
      if (glow && this.tree?.innerGlow) {
        // Retuning the Inner Glow needs no new tree either: its strengths are uniforms.
        this.tree.innerGlow = glow;
        this.tree.growth = state.growth;
        this.tree.season = state.season;
      } else if (live && this.tree) {
        // Retuning Material Features that stay on needs no new tree: their values are uniforms.
        const { crownNormals, translucency, occlusion } = live;
        if (crownNormals !== undefined) this.tree.crownNormals = crownNormals;
        if (translucency) this.tree.translucency = translucency;
        if (occlusion) this.tree.occlusionStrength = occlusion.strength;
        this.tree.growth = state.growth;
        this.tree.season = state.season;
      } else if (regenerate) {
        const tree = createTree(state.definition, { seed: state.seed, growth: state.growth, season: state.season });
        this.tree?.dispose();
        this.tree = tree;
        this.scene.add(tree);
        // Textured Styles (realistic): draw again once the images are in. Until then the status stays
        // 'loading' (see pendingTextures), so "rendered" means the tree as it really looks.
        this.pendingTextures++;
        tree.ready.then(
          () => {
            this.pendingTextures--;
            this.requestRender();
          },
          (error: unknown) => {
            this.pendingTextures--;
            if (this.tree === tree) this.options.onStatus?.('error', error instanceof Error ? error : new Error(String(error)));
            else this.requestRender();
          },
        );
        // Re-frame only for a new starting point, not while the designer tweaks parameters.
        if (!previous || state.source !== previous.source) this.frame(tree);
      } else {
        this.tree!.growth = state.growth;
        this.tree!.season = state.season;
      }
      this.requestRender();
    } catch (error) {
      this.options.onStatus?.('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Schedules `frames` frames in a row (default one, at least {@link settleFrames}; several requests
   * in the same tick draw once). The status turns 'rendered' after the last.
   */
  requestRender(frames = 1): void {
    if (!this.ready) return;
    this.options.onStatus?.('loading');
    this.framesLeft = Math.max(this.framesLeft, frames, this.settleFrames);
    this.scheduleFrame();
  }

  /** Draws the next of the frames left (one per animation frame). */
  private scheduleFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.framesLeft--;
      Promise.resolve()
        .then(() => this.renderFrame())
        .then(
          () => {
            this.renders++;
            if (this.framesLeft > 0) this.scheduleFrame();
            else if (!this.frameRequested && this.pendingTextures === 0) this.options.onStatus?.('rendered');
          },
          (error: unknown) => this.options.onStatus?.('error', error instanceof Error ? error : new Error(String(error))),
        );
    });
  }

  /** Points the camera at the whole tree above the ground at its full size (the generated geometry; Growth is a shader effect). */
  frame(tree: Tree): void {
    const box = framingBox(tree);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const distance = (Math.max(size.x, size.y, size.z) / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.3;
    const direction = new THREE.Vector3(1, 0.35, 1).normalize();
    this.camera.position.copy(centre).addScaledVector(direction, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(centre);
    this.controls.update();
    this.framingDistance = distance;
    this.framed = box;
    if (this.sun.castShadow) this.fitSunShadow();
    for (const listener of this.framedListeners) listener();
  }

  /** Calls `listener` after every {@link frame}; returns the unsubscribe. */
  onFramed(listener: () => void): () => void {
    this.framedListeners.add(listener);
    return () => void this.framedListeners.delete(listener);
  }

  /**
   * Lets the sun cast shadows (with the renderer's shadow map) over the framed tree, e.g. for god
   * rays, or switches that off again: then the preview renders exactly as without.
   */
  setSunShadows(on: boolean): void {
    if (this.sun.castShadow === on) return;
    this.sun.castShadow = on;
    this.renderer.shadowMap.enabled = on;
    const ground = this.scene.getObjectByName('ground');
    if (ground) ground.receiveShadow = on;
    if (on) this.fitSunShadow();
    else {
      this.sun.position.copy(SUN_DIRECTION);
      this.sun.target.position.set(0, 0, 0);
    }
    this.requestRender();
  }

  /** The sun's shadow camera around the framed box (same light direction, from far enough away). */
  private fitSunShadow(): void {
    const sphere = this.framed.getBoundingSphere(new THREE.Sphere());
    const reach = Math.max(sphere.radius, 1) * 1.2;
    // Aim at the tree's centre from far enough away, along the same direction (the same light).
    this.sun.target.position.copy(sphere.center);
    this.sun.position.copy(SUN_DIRECTION).normalize().multiplyScalar(reach * 2).add(sphere.center);
    const shadow = this.sun.shadow;
    shadow.mapSize.set(2048, 2048);
    Object.assign(shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.1, far: reach * 4 });
    shadow.camera.updateProjectionMatrix();
    shadow.needsUpdate = true;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }
}
