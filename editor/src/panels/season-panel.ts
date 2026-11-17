// Season Profile: the leaf colour, leaf coverage and blossom keyframe tracks plus the blossom colour.
// Keyframes can be added (at the preview's current Season), moved (edit their Season t; the track
// re-sorts) and removed (a track keeps at least one). A strip under each track shows it across the year.
import type { HexColor, Keyframe } from '@casmo/tree.js';
import { setAt } from '../definition-path';
import { colorControl, errorMessage, fieldControl, numberControl, setDefinitionValue } from './controls';
import { SEASON_FIELDS, SEASON_TRACKS } from './fields';
import { addKeyframe, moveKeyframe, removeKeyframe } from './keyframes';
import type { Panel, PanelContext } from './types';

type Track = Keyframe<HexColor | number>[];
type TrackSpec = (typeof SEASON_TRACKS)[number];

/** CSS gradient of a track across Season 0..1 (colours as is; fractions as green opacity). */
function trackGradient(spec: TrackSpec, track: Track): string {
  const colour = (value: HexColor | number): string =>
    spec.kind === 'color' ? String(value) : `rgb(62 125 43 / ${Math.round(Number(value) * 100)}%)`;
  const stops = track.map((key) => `${colour(key.value)} ${(key.t * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.length === 1 ? `${stops[0]}, ${stops[0]}` : stops.join(', ')})`;
}

function trackEditor(context: PanelContext, spec: TrackSpec): HTMLElement {
  const { store } = context;
  const path = `season.${spec.key}`;
  const read = (): Track => store.state.definition.season[spec.key] as Track;
  const root = document.createElement('div');
  root.className = 'track';
  root.id = `track-${spec.key}`;
  const heading = document.createElement('h3');
  heading.textContent = spec.label;
  const strip = document.createElement('div');
  strip.className = 'track-strip';
  strip.setAttribute('aria-hidden', 'true');
  const keys = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add keyframe';
  add.setAttribute('aria-label', `Add ${spec.label} keyframe`);
  add.title = 'Adds a keyframe at the preview Season';

  /** Writes a new track; `focus` = DOM id to focus after the rebuild (the edited key moved). */
  let focusAfter: string | null = null;
  const writeTrack = (track: Track, focus: string | null = null): void => {
    focusAfter = focus;
    store.set({ definition: setAt(store.state.definition, path, track) });
  };
  const tryEdit = (edit: () => void): void => {
    try {
      edit();
      context.report(null);
    } catch (error) {
      context.report(errorMessage(error));
    }
  };
  add.addEventListener('click', () =>
    tryEdit(() => {
      const { track, index } = addKeyframe(read(), store.state.season);
      writeTrack(track, `${path}.${index}.t`);
    }),
  );

  let shown = '';
  const build = (): void => {
    const track = read();
    const json = JSON.stringify(track);
    if (json === shown) return;
    shown = json;
    strip.style.background = trackGradient(spec, track);
    // Keep the keyboard where it was: on the same input, or on a key that just moved/appeared.
    const active = document.activeElement;
    const inKeys = active !== null && keys.contains(active);
    const focused = focusAfter && (inKeys || active === document.body || active === add) ? focusAfter : inKeys ? active.id : null;
    focusAfter = null;
    keys.replaceChildren(
      ...track.map((_, i) => {
        const row = document.createElement('div');
        row.className = 'keyframe';
        const t = numberControl(context, {
          kind: 'number',
          id: `${path}.${i}.t`,
          label: 't',
          min: 0,
          max: 1,
          step: 0.01,
          get: (state) => (state.definition.season[spec.key] as Track)[i]?.t ?? 0,
          set: (_, value) => {
            const moved = moveKeyframe(read(), i, value);
            writeTrack(moved.track, `${path}.${moved.index}.t`);
          },
        });
        const valuePath = `${path}.${i}.value`;
        const value =
          spec.kind === 'color'
            ? colorControl(context, {
                id: valuePath,
                label: '',
                get: (state) => String((state.definition.season[spec.key] as Track)[i]?.value ?? '#000000'),
                set: (s, v) => setDefinitionValue(s, valuePath, v),
              })
            : numberControl(context, {
                kind: 'slider',
                id: valuePath,
                label: '',
                min: 0,
                max: 1,
                step: 0.01,
                get: (state) => Number((state.definition.season[spec.key] as Track)[i]?.value ?? 0),
                set: (s, v) => setDefinitionValue(s, valuePath, v),
              });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${spec.label} key ${i + 1}`);
        remove.disabled = track.length <= 1;
        remove.addEventListener('click', () => tryEdit(() => writeTrack(removeKeyframe(read(), i))));
        // Short visible labels; full accessible names.
        t.querySelector('input')!.setAttribute('aria-label', `${spec.label} key ${i + 1} Season`);
        value.querySelector('input:not([aria-hidden])')!.setAttribute('aria-label', `${spec.label} key ${i + 1} value`);
        row.append(t, value, remove);
        return row;
      }),
    );
    if (focused) (document.getElementById(focused) as HTMLElement | null)?.focus();
  };
  store.subscribe(build);
  build();
  root.append(heading, strip, keys, add);
  return root;
}

export const seasonPanel: Panel = {
  id: 'season',
  title: 'Season Profile',
  render(context) {
    const root = document.createElement('div');
    root.append(
      ...SEASON_FIELDS.map((field) => fieldControl(context, field)),
      ...SEASON_TRACKS.map((spec) => trackEditor(context, spec)),
    );
    return root;
  },
};
