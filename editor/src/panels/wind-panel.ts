// Wind: the Definition's Wind response (how this tree sways) and, for the preview only, the
// scene Wind it sways in (strength and direction; not saved in the Definition). While the
// preview Wind blows, the preview renders continuously.
import { sceneWind } from '@casmo/tree.js';
import { fieldControl, numberControl } from './controls';
import { parameterGroup } from './parameter-panels';
import type { Panel, PanelContext } from './types';

/** Scene Wind settings of the preview, kept outside the store (they are not part of a Definition). */
export const previewWind = { strength: 0, direction: 0 };

function applyPreviewWind(context: PanelContext): void {
  const radians = (previewWind.direction * Math.PI) / 180;
  sceneWind.set({ strength: previewWind.strength, direction: [Math.cos(radians), 0, Math.sin(radians)] });
  if (previewWind.strength > 0) animate(context);
  else context.preview.requestRender();
}

let animating = false;
function animate(context: PanelContext): void {
  if (animating) return;
  animating = true;
  const tick = (): void => {
    if (previewWind.strength <= 0) {
      animating = false;
      return;
    }
    context.preview.requestRender();
    requestAnimationFrame(tick);
  };
  tick();
}

export const windPanel: Panel = {
  id: 'wind',
  title: 'Wind',
  render(context) {
    const root = document.createElement('div');
    const response = document.createElement('h3');
    response.textContent = 'Response (Definition)';
    const scene = document.createElement('h3');
    scene.textContent = 'Preview wind';
    // The scene Wind's controls read the module state, not the store: give them a store-shaped getter.
    const windControl = (id: string, label: string, max: number, step: number, key: keyof typeof previewWind) =>
      numberControl(context, {
        kind: 'slider',
        id,
        label,
        min: 0,
        max,
        step,
        get: () => previewWind[key],
        set: (_, value) => {
          if (value < 0) throw new RangeError(`${label} must be >= 0, got ${value}`);
          previewWind[key] = value;
          applyPreviewWind(context);
        },
      });
    applyPreviewWind(context);
    root.append(
      response,
      ...parameterGroup('wind').fields.map((field) => fieldControl(context, field)),
      scene,
      windControl('wind-strength', 'Wind strength', 2, 0.01, 'strength'),
      windControl('wind-direction', 'Wind direction°', 360, 1, 'direction'),
    );
    return root;
  },
};
