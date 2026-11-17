// The Sculpt tools in the preview viewport: pick and drag a branch (move), click a branch (delete),
// or brush over the crown (paint leaf coverage). A pointer press that hits the tree starts a stroke
// (the camera stays put); a press on empty space still orbits.
//
// While a stroke runs the preview shows the edited Definition directly (not through the store), so a
// whole drag becomes ONE store change - one undo step - when the pointer is released. Escape cancels.
// Picking uses the generated mesh, i.e. the tree's fully grown shape without Wind.
import * as THREE from 'three/webgpu';
import type { TreeDefinition, Vec3 } from '@casmo/tree.js';
import type { PanelContext } from '../panels/types';
import type { EditorState } from '../store';
import { brushBranches, dragTurn, nearestBranch } from './pick';
import { deleteBranch, inSubtree, moveBranch, paintLeaves } from './sculpts';

export type SculptTool = 'none' | 'move' | 'delete' | 'paint';

interface Hit {
  /** Branch path under the pointer (a leaf counts as its branch). */
  path: string;
  /** Hit point in tree space. */
  point: Vec3;
  /** Hit point in world space. */
  world: THREE.Vector3;
}

type Stroke =
  | { tool: 'move'; path: string; base: Vec3; from: Vec3; plane: THREE.Plane; edited: TreeDefinition | null }
  | { tool: 'paint'; painted: Set<string>; edited: TreeDefinition | null };

const HIGHLIGHT = '#ff7a1a';

export class SculptViewport {
  /** The active tool ('none': the pointer only orbits the camera). */
  tool: SculptTool = 'none';
  /** Leaf coverage the paint brush sets (0 = bare .. 1 = all leaves). */
  coverage = 0;
  /** Paint brush radius in metres (tree space). */
  brushSize = 0.6;

  private readonly context: PanelContext;
  private readonly element: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly highlight: THREE.LineSegments;
  private stroke: Stroke | null = null;
  /** The state the preview shows while a stroke runs. */
  private shown: EditorState | null = null;
  private frame = 0;
  private lastPointer: PointerEvent | null = null;

  constructor(context: PanelContext) {
    this.context = context;
    const { preview } = context;
    this.element = preview.renderer.domElement;
    this.highlight = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicNodeMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true }),
    );
    this.highlight.name = 'sculpt-highlight';
    this.highlight.renderOrder = 10;
    this.highlight.frustumCulled = false;
    this.highlight.visible = false;
    preview.scene.add(this.highlight);

    // Capture phase on the parent: runs before OrbitControls' own listener on the canvas.
    const parent = this.element.parentElement ?? this.element;
    parent.addEventListener('pointerdown', (event) => this.onPointerDown(event), { capture: true });
    this.element.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.element.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.element.addEventListener('pointercancel', () => this.cancel());
    this.element.addEventListener('pointerleave', () => !this.stroke && this.showHighlight([]));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.stroke) this.cancel();
    });
  }

  /** Switches tools (cancels a running stroke). */
  setTool(tool: SculptTool): void {
    this.cancel();
    this.tool = tool;
    this.element.style.cursor = tool === 'none' ? '' : 'crosshair';
    this.showHighlight([]);
  }

  /** What is under the client point (x, y), or null. */
  pick(clientX: number, clientY: number): Hit | null {
    const { preview } = this.context;
    const tree = preview.tree;
    if (!tree) return null;
    const rect = this.element.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, preview.camera);
    tree.updateMatrixWorld();
    const [hit] = this.raycaster.intersectObjects([tree.wood, tree.leaves], false);
    if (!hit) return null;
    const point = tree.worldToLocal(hit.point.clone()).toArray() as Vec3;
    const { branches, leaves } = tree.data.skeleton;
    let path: string | null;
    if (hit.object === tree.leaves && leaves.length > 0) {
      const near = new THREE.Vector3(...point);
      let best = leaves[0]!;
      for (const leaf of leaves) if (near.distanceToSquared(new THREE.Vector3(...leaf.position)) < near.distanceToSquared(new THREE.Vector3(...best.position))) best = leaf;
      path = best.branch;
    } else {
      path = nearestBranch(branches, point);
    }
    return path === null ? null : { path, point, world: hit.point.clone() };
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.tool === 'none' || event.button !== 0 || event.target !== this.element) return;
    const hit = this.pick(event.clientX, event.clientY);
    if (!hit) return; // empty space: orbit as usual
    event.stopPropagation();
    event.preventDefault();
    const { store } = this.context;
    const { seed, definition } = store.state;
    if (this.tool === 'delete') {
      this.commit(deleteBranch(definition, seed, hit.path));
      this.showHighlight([]);
      return;
    }
    this.element.setPointerCapture(event.pointerId);
    this.shown = store.state;
    if (this.tool === 'move') {
      const branch = this.context.preview.tree!.data.skeleton.branches.find((b) => b.path === hit.path)!;
      const normal = this.context.preview.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.world);
      this.stroke = { tool: 'move', path: hit.path, base: branch.points[0]!.position, from: hit.point, plane, edited: null };
      this.showHighlight(this.subtree(hit.path));
    } else {
      this.stroke = { tool: 'paint', painted: new Set(), edited: null };
      this.paintAt(hit);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.tool === 'none') return;
    this.lastPointer = event;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const pointer = this.lastPointer;
      if (pointer) this.update(pointer);
    });
  }

  private update(event: PointerEvent): void {
    const stroke = this.stroke;
    if (!stroke) {
      // Hover: show what a press would sculpt.
      const hit = this.pick(event.clientX, event.clientY);
      if (!hit) this.showHighlight([]);
      else if (this.tool === 'paint') this.showHighlight(this.brushTargets(hit));
      else this.showHighlight(this.subtree(hit.path));
      return;
    }
    const { store } = this.context;
    if (stroke.tool === 'move') {
      const tree = this.context.preview.tree!;
      const rect = this.element.getBoundingClientRect();
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.context.preview.camera);
      const world = this.raycaster.ray.intersectPlane(stroke.plane, new THREE.Vector3());
      if (!world) return;
      const to = tree.worldToLocal(world).toArray() as Vec3;
      const { definition, seed } = store.state;
      stroke.edited = moveBranch(definition, seed, stroke.path, dragTurn(stroke.base, stroke.from, to, event.shiftKey));
      this.showEdited(stroke.edited);
      this.showHighlight(this.subtree(stroke.path));
    } else {
      const hit = this.pick(event.clientX, event.clientY);
      if (hit) this.paintAt(hit);
    }
  }

  private paintAt(hit: Hit): void {
    const stroke = this.stroke;
    if (stroke?.tool !== 'paint') return;
    const before = stroke.painted.size;
    for (const path of this.brushTargets(hit)) stroke.painted.add(path);
    this.showHighlight(this.brushTargets(hit));
    if (stroke.painted.size === before) return;
    const { definition, seed } = this.context.store.state;
    stroke.edited = paintLeaves(definition, seed, [...stroke.painted], this.coverage);
    this.showEdited(stroke.edited);
  }

  private onPointerUp(event: PointerEvent): void {
    const stroke = this.stroke;
    if (!stroke) return;
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.update(event); // the last bit of the drag
    }
    this.stroke = null;
    this.shown = null;
    if (stroke.edited) this.commit(stroke.edited);
    else this.showHighlight([]);
  }

  /** Stops a running stroke and shows the store's tree again. */
  cancel(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (stroke && this.shown && this.shown !== this.context.store.state) {
      this.context.preview.show(this.context.store.state, this.shown);
    }
    this.shown = null;
    this.showHighlight([]);
  }

  private commit(definition: TreeDefinition): void {
    try {
      this.context.store.set({ definition });
      this.context.report(null);
    } catch (error) {
      this.context.report(error instanceof Error ? error.message : String(error));
    }
    this.showHighlight([]);
  }

  /** Shows `definition` in the preview without touching the store (during a stroke). */
  private showEdited(definition: TreeDefinition): void {
    const next = { ...this.context.store.state, definition };
    this.context.preview.show(next, this.shown);
    this.shown = next;
  }

  private brushTargets(hit: Hit): string[] {
    const tree = this.context.preview.tree;
    if (!tree) return [];
    return brushBranches(tree.data.skeleton.branches, tree.definition.branches.length, hit.point, this.brushSize);
  }

  private subtree(path: string): string[] {
    const branches = this.context.preview.tree?.data.skeleton.branches ?? [];
    return branches.filter((b) => inSubtree(b.path, path)).map((b) => b.path);
  }

  /** Outlines the centre lines of the given branches (drawn on top of the tree). */
  private showHighlight(paths: readonly string[]): void {
    const tree = this.context.preview.tree;
    const wanted = new Set(paths);
    const positions: number[] = [];
    if (tree) {
      for (const branch of tree.data.skeleton.branches) {
        if (!wanted.has(branch.path)) continue;
        for (let i = 0; i + 1 < branch.points.length; i++) positions.push(...branch.points[i]!.position, ...branch.points[i + 1]!.position);
      }
      this.highlight.matrix.copy(tree.matrixWorld);
      this.highlight.matrixAutoUpdate = false;
    }
    const visible = positions.length > 0;
    if (!visible && !this.highlight.visible) return;
    this.highlight.geometry.dispose();
    this.highlight.geometry = new THREE.BufferGeometry();
    this.highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.highlight.visible = visible;
    this.context.preview.requestRender();
  }
}
