// Effects preview: a "Tree" group (a checkbox per Tree Effect), a "Scene" group (a checkbox per Scene
// Effect and the anti-aliasing choice), the Style whose settings they use (follows the starting
// point) and one button to apply that Style's suggestion of both groups. Preview-only.
import { STYLE_NAMES, type StyleName } from '@casmo/tree.js';
import { EFFECT_LABELS, EFFECT_NAMES } from '../effects-choice';
import { createEffectsPreview } from '../effects-preview';
import { ANTIALIAS_CHOICES, ANTIALIAS_LABELS, SCENE_EFFECT_LABELS, SCENE_EFFECT_NAMES, type AntialiasChoice } from '../scene-choice';
import type { Panel } from './types';

function checkbox(id: string, text: string, onChange: (on: boolean) => void): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.addEventListener('change', () => onChange(input.checked));
  const label = document.createElement('label');
  label.className = 'toggle';
  label.append(input, ` ${text}`);
  return { label, input };
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

export const effectsPanel: Panel = {
  id: 'effects',
  title: 'Effects',
  render(context) {
    const effects = createEffectsPreview(context.preview, context.store);
    if (window.treeEditor) window.treeEditor.effects = effects;
    const root = document.createElement('div');

    root.append(heading('Tree'));
    const treeToggles = EFFECT_NAMES.map((name) => {
      const { label, input } = checkbox(`effect-${name}`, EFFECT_LABELS[name], (on) => effects.toggle(name, on));
      root.append(label);
      return { name, input };
    });

    // Scene Effects: the toggles come from SCENE_EFFECT_NAMES, the AA options from ANTIALIAS_CHOICES.
    root.append(heading('Scene'));
    const sceneToggles = SCENE_EFFECT_NAMES.map((name) => {
      const { label, input } = checkbox(`scene-${name}`, SCENE_EFFECT_LABELS[name], (on) => effects.toggleScene(name, on));
      root.append(label);
      return { name, input };
    });
    const aaRow = document.createElement('div');
    aaRow.className = 'control';
    const aaLabel = document.createElement('label');
    aaLabel.htmlFor = 'scene-antialias';
    aaLabel.textContent = 'Anti-aliasing';
    const aa = document.createElement('select');
    aa.id = 'scene-antialias';
    for (const mode of ANTIALIAS_CHOICES) aa.add(new Option(ANTIALIAS_LABELS[mode ?? 'off'], mode ?? 'off'));
    aa.addEventListener('change', () => effects.setAntialias((aa.value === 'off' ? null : aa.value) as AntialiasChoice));
    aaRow.append(aaLabel, aa);
    root.append(aaRow);

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
      for (const { name, input } of treeToggles) input.checked = effects.toggles[name];
      for (const { name, input } of sceneToggles) input.checked = effects.scene.toggles[name];
      aa.value = effects.scene.antialias ?? 'off';
      style.value = effects.style;
      apply.textContent = `Apply ${effects.style} suggestion`;
    };
    effects.subscribe(sync);
    sync();

    root.append(styleRow, apply);
    return root;
  },
};
