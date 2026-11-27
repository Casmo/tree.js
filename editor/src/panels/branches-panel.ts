// Branching levels: one block of parameters per level (level 1 grows from the trunk), plus adding
// a level below the deepest one and removing any level. Each level has its Crown Shape: one-click
// shapes that write its length and angle curves, and the curves' keyframe editors to fine-tune them.
// The list is rebuilt when the number of levels changes; the controls themselves follow the store.
import { MAX_BRANCH_LEVELS } from '@casmo/tree.js';
import { errorMessage, fieldControl } from './controls';
import { applyCrownShape, CROWN_SHAPES } from './crown-shapes';
import { BRANCH_LEVEL_CURVES, branchLevelFields } from './fields';
import { widestGap } from './keyframes';
import { addBranchLevel, removeBranchLevel } from './levels';
import { trackEditor } from './track-editor';
import type { Panel, PanelContext } from './types';

/** Length multiplier as a strip colour: brown, stronger for longer branches. */
const curveColor = (value: number): string => `rgb(107 74 43 / ${Math.round(Math.min(1, value / 2) * 100)}%)`;

function crownShape(context: PanelContext, index: number, edit: (change: () => void) => void): HTMLElement {
  const { store } = context;
  const root = document.createElement('div');
  root.className = 'crown-shape';
  const heading = document.createElement('h3');
  heading.textContent = 'Crown Shape';
  const shapes = document.createElement('div');
  shapes.className = 'crown-shapes';
  shapes.setAttribute('role', 'group');
  shapes.setAttribute('aria-label', `Crown Shapes for level ${index + 1}`);
  for (const shape of CROWN_SHAPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = shape.label;
    button.setAttribute('aria-label', `${shape.label} crown, level ${index + 1}`);
    button.title = 'Writes this level\'s length and angle curves';
    button.addEventListener('click', () =>
      edit(() => store.editDefinition({ branches: applyCrownShape(store.state.definition.branches, index, shape.id) })),
    );
    shapes.append(button);
  }
  root.append(
    heading,
    shapes,
    ...BRANCH_LEVEL_CURVES.map((curve) =>
      trackEditor(context, {
        path: `branches.${index}.${curve.key}`,
        id: `curve-${index}-${curve.key}`,
        label: `${curve.label}, level ${index + 1}`,
        kind: 'number',
        min: curve.min,
        max: curve.max,
        absent: curve.absent,
        resetText: 'Flat',
        tName: 'position',
        addAt: (_, track) => widestGap(track),
        addHint: 'Adds a keyframe where the curve has most room (0 = base of the parent .. 1 = tip)',
        numberColor: curveColor,
      }),
    ),
  );
  return root;
}

export const branchesPanel: Panel = {
  id: 'branches',
  title: 'Branching levels',
  render(context) {
    const { store } = context;
    const root = document.createElement('div');
    const list = document.createElement('div');
    const add = document.createElement('button');
    add.type = 'button';
    add.id = 'add-branch-level';
    add.textContent = 'Add level';
    const edit = (change: () => void): void => {
      try {
        change();
        context.report(null);
      } catch (error) {
        context.report(errorMessage(error));
      }
    };
    add.addEventListener('click', () =>
      edit(() => store.editDefinition({ branches: addBranchLevel(store.state.definition.branches) })),
    );

    let shown = -1;
    const build = (): void => {
      const { branches } = store.state.definition;
      add.disabled = branches.length >= MAX_BRANCH_LEVELS;
      if (branches.length === shown) return;
      shown = branches.length;
      const levels: HTMLElement[] = branches.map((_, i) => {
        const level = document.createElement('fieldset');
        level.className = 'branch-level';
        level.id = `branch-level-${i}`;
        const legend = document.createElement('legend');
        legend.textContent = i === 0 ? 'Level 1 (from the trunk)' : `Level ${i + 1}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove level ${i + 1}`);
        remove.addEventListener('click', () =>
          edit(() => store.editDefinition({ branches: removeBranchLevel(store.state.definition.branches, i) })),
        );
        legend.append(remove);
        level.append(
          legend,
          ...branchLevelFields().map((field) => fieldControl(context, field, `branches.${i}.${field.path}`)),
          crownShape(context, i, edit),
        );
        return level;
      });
      if (levels.length === 0) {
        const bare = document.createElement('p');
        bare.className = 'hint';
        bare.textContent = 'A bare trunk: leaves grow on the trunk.';
        levels.push(bare);
      }
      list.replaceChildren(...levels);
    };
    store.subscribe(build);
    build();
    root.append(list, add);
    return root;
  },
};
