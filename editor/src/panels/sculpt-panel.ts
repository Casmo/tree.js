// Sculpt tools (ADR 0003): pick a tool for the viewport, set the leaf brush, and review the Sculpts
// of the current Seed (remove one, or clear them). Sculpts made on other Seeds are listed with a
// button to go to their Seed.
import type { Sculpt } from '@casmo/tree.js';
import { seedGuard } from '../sculpt/seed-dialog';
import { clearSculpts, removeSculpt } from '../sculpt/sculpts';
import { SculptViewport, type SculptTool } from '../sculpt/viewport';
import type { Panel, PanelContext } from './types';

const TOOLS: { tool: SculptTool; label: string; hint: string }[] = [
  { tool: 'none', label: 'Orbit', hint: 'Drag to orbit the camera.' },
  { tool: 'move', label: 'Move', hint: 'Drag a branch to turn it about its base (hold Shift to also stretch it).' },
  { tool: 'delete', label: 'Delete', hint: 'Click a branch to delete it and everything on it.' },
  { tool: 'paint', label: 'Paint leaves', hint: 'Brush over the crown to set its leaf coverage.' },
];

export const sculptPanel: Panel = {
  id: 'sculpt',
  title: 'Sculpt',
  render(context) {
    const viewport = new SculptViewport(context);
    const root = document.createElement('div');

    const tools = document.createElement('div');
    tools.className = 'sculpt-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Sculpt tool');
    const hint = document.createElement('p');
    hint.className = 'hint';
    const brush = brushControls(viewport);
    const buttons = TOOLS.map(({ tool, label, hint: text }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `sculpt-tool-${tool}`;
      button.textContent = label;
      button.title = text;
      button.addEventListener('click', () => select(tool));
      return button;
    });
    const select = (tool: SculptTool): void => {
      viewport.setTool(tool);
      TOOLS.forEach((entry, i) => buttons[i]!.setAttribute('aria-pressed', String(entry.tool === tool)));
      hint.textContent = TOOLS.find((entry) => entry.tool === tool)!.hint;
      brush.hidden = tool !== 'paint';
    };
    tools.append(...buttons);
    select('none');

    root.append(tools, hint, brush, sculptList(context));
    return root;
  },
};

function rangeInput(id: string, label: string, min: number, max: number, step: number, value: number, onInput: (value: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'control';
  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(value) });
  const output = document.createElement('output');
  output.htmlFor.add(id);
  output.textContent = String(value);
  input.addEventListener('input', () => {
    output.textContent = input.value;
    onInput(input.valueAsNumber);
  });
  row.append(labelEl, input, output);
  return row;
}

function brushControls(viewport: SculptViewport): HTMLElement {
  const root = document.createElement('div');
  root.append(
    rangeInput('sculpt-coverage', 'Leaf coverage', 0, 1, 0.05, viewport.coverage, (value) => (viewport.coverage = value)),
    rangeInput('sculpt-brush', 'Brush size', 0.1, 4, 0.1, viewport.brushSize, (value) => (viewport.brushSize = value)),
  );
  return root;
}

function describe(sculpt: Sculpt): string {
  const where = sculpt.path === '0' ? 'trunk' : sculpt.path.includes('.') ? `branch ${sculpt.path}` : `stem ${sculpt.path}`;
  if (sculpt.action === 'delete') return `Delete ${where}`;
  if (sculpt.action === 'move') return `Move ${where}${sculpt.scale !== 1 ? ` (× ${sculpt.scale.toFixed(2)})` : ''}`;
  return `Leaves ${Math.round(sculpt.coverage * 100)}% on ${where}`;
}

/** The Sculpts of the current Seed (with Remove / Clear) and the Seeds that have others. */
function sculptList(context: PanelContext): HTMLElement {
  const { store } = context;
  const root = document.createElement('div');
  root.id = 'sculpt-list';
  const render = (): void => {
    const { definition, seed } = store.state;
    const heading = document.createElement('p');
    heading.className = 'hint';
    const list = document.createElement('ul');
    list.className = 'sculpts';
    let count = 0;
    definition.sculpts.forEach((sculpt, index) => {
      if (sculpt.seed !== seed) return;
      count++;
      const item = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = describe(sculpt);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${describe(sculpt)}`);
      remove.addEventListener('click', () => store.set({ definition: removeSculpt(store.state.definition, index) }));
      item.append(text, remove);
      list.append(item);
    });
    heading.textContent = count === 0 ? `No Sculpts on Seed ${seed}.` : `${count} Sculpt${count === 1 ? '' : 's'} on Seed ${seed}:`;
    const children: HTMLElement[] = [heading];
    if (count > 0) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.id = 'sculpt-clear';
      clear.textContent = 'Clear Sculpts';
      clear.addEventListener('click', () => store.set({ definition: clearSculpts(store.state.definition, store.state.seed) }));
      children.push(list, clear);
    }
    const others = new Map<number, number>();
    for (const sculpt of definition.sculpts) if (sculpt.seed !== seed) others.set(sculpt.seed, (others.get(sculpt.seed) ?? 0) + 1);
    for (const [other, n] of [...others].sort((a, b) => a[0] - b[0])) {
      const row = document.createElement('p');
      row.className = 'hint';
      row.textContent = `Seed ${other}: ${n} Sculpt${n === 1 ? '' : 's'} `;
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = `Go to Seed ${other}`;
      go.addEventListener('click', () => void seedGuard(store).changeSeed(other));
      row.append(go);
      children.push(row);
    }
    root.replaceChildren(...children);
  };
  store.subscribe((state, previous) => {
    if (state.definition.sculpts !== previous.definition.sculpts || state.seed !== previous.seed) render();
  });
  render();
  return root;
}
