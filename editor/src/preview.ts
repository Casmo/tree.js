// Live preview: one Tree on WebGPURenderer, kept in sync with the editor store.
// A new Definition or Seed regenerates the tree; Growth and Season only write its uniforms.
// Rendering is on demand (one frame per change, or while the camera moves).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTree, type Tree } from '@casmo/tree.js';
import type { EditorState, EditorStore } from './store';

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
  /** Renders completed so far (handy for tests). */
  renders = 0;
  /**
   * Draws one frame. Effects preview (#18) can replace this with a RenderPipeline's render.
   * Must return once the frame is submitted.
   */
  renderFrame: () => Promise<void>;

  private readonly container: HTMLElement;
  private readonly options: PreviewOptions;
  private frameRequested = false;
  private ready = false;
  private unsubscribe: () => void = () => {};

  constructor(container: HTMLElement, options: PreviewOptions = {}) {
    this.container = container;
    this.options = options;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: options.forceWebGL ?? false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderFrame = () => this.renderer.renderAsync(this.scene, this.camera);

    this.scene.background = new THREE.Color('#cfe3f0');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a4a', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 2.5);
    sun.position.set(5, 8, 3);
    this.scene.add(sun);
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
      if (regenerate) {
        const tree = createTree(state.definition, { seed: state.seed, growth: state.growth, season: state.season });
        this.tree?.dispose();
        this.tree = tree;
        this.scene.add(tree);
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

  /** Schedules one frame (several requests in the same tick draw once). */
  requestRender(): void {
    if (!this.ready) return;
    this.options.onStatus?.('loading');
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderFrame().then(
        () => {
          this.renders++;
          if (!this.frameRequested) this.options.onStatus?.('rendered');
        },
        (error: unknown) => this.options.onStatus?.('error', error instanceof Error ? error : new Error(String(error))),
      );
    });
  }

  /** Points the camera at the whole tree at its full size (the generated geometry; Growth is a shader effect). */
  frame(tree: Tree): void {
    const box = new THREE.Box3().setFromObject(tree);
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
