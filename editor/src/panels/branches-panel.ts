// Branching levels: one block of parameters per level (level 1 grows from the trunk), plus adding
// a level below the deepest one and removing any level. The list is rebuilt when the number of
// levels changes; the controls themselves follow the store.
import { MAX_BRANCH_LEVELS } from '@casmo/tree.js';
import { errorMessage, fieldControl } from './controls';
import { BRANCH_LEVEL_FIELDS } from './fields';
import { addBranchLevel, removeBranchLevel } from './levels';
import type { Panel } from './types';

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
        level.append(legend, ...BRANCH_LEVEL_FIELDS.map((field) => fieldControl(context, field, `branches.${i}.${field.path}`)));
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
