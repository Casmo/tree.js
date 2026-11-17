// Tree Effects preview: a checkbox per effect, the Style whose settings they use (follows the
// starting point) and one button to apply that Style's suggested combination. Preview-only.
import { STYLE_NAMES, type StyleName } from '@casmo/tree.js';
import { EFFECT_LABELS, EFFECT_NAMES } from '../effects-choice';
import { createEffectsPreview } from '../effects-preview';
import type { Panel } from './types';

export const effectsPanel: Panel = {
  id: 'effects',
  title: 'Tree Effects',
  render(context) {
    const effects = createEffectsPreview(context.preview, context.store);
    if (window.treeEditor) window.treeEditor.effects = effects;
    const root = document.createElement('div');

    const checkboxes = EFFECT_NAMES.map((name) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `effect-${name}`;
      input.addEventListener('change', () => effects.toggle(name, input.checked));
      const label = document.createElement('label');
      label.className = 'toggle';
      label.append(input, ` ${EFFECT_LABELS[name]}`);
      root.append(label);
      return { name, input };
    });

    const styleRow = document.createElement('div');
    styleRow.className = 'control';
    const styleLabel = document.createElement('label');
    styleLabel.htmlFor = 'effects-style';
    styleLabel.textContent = 'Effects Style';
    const style = document.createElement('select');
    style.id = 'effects-style';
    for (const name of STYLE_NAMES) style.add(new Option(name, name));
    style.addEventListener('change', () => effects.setStyle(style.value as StyleName));
    styleRow.append(styleLabel, style);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.id = 'effects-suggested';
    apply.addEventListener('click', () => effects.applySuggested());

    const sync = (): void => {
      for (const { name, input } of checkboxes) input.checked = effects.toggles[name];
      style.value = effects.style;
      apply.textContent = `Apply ${effects.style} suggestion`;
    };
    effects.subscribe(sync);
    sync();

    root.append(styleRow, apply);
    return root;
  },
};
