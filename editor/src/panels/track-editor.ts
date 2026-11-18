// A keyframe track editor (Season Profile tracks, Crown Shape curves): keyframes can be added,
// moved (edit their t; the track re-sorts) and removed (a track keeps at least one). A strip under
// the heading shows the track across 0..1. An optional track that is absent shows `absent` (what it
// means) and is written on the first edit.
import type { HexColor, Keyframe, TreeDefinition } from '@casmo/tree.js';
import { getAt, setAt } from '../definition-path';
import type { EditorState } from '../store';
import { colorControl, errorMessage, numberControl, setDefinitionValue } from './controls';
import { addKeyframe, moveKeyframe, removeKeyframe } from './keyframes';
import type { PanelContext } from './types';

type Track = Keyframe<HexColor | number>[];

export interface TrackSpec {
  /** Definition path of the track, e.g. "season.blossom" or "branches.0.lengthProfile". */
  path: string;
  /** DOM id of the editor root. */
  id: string;
  label: string;
  /** Keyframe values: colours, or numbers with a slider over `min`..`max`. */
  kind: 'color' | 'number';
  min?: number;
  max?: number;
  /** Optional tracks: the track in force while absent. */
  absent?: Track;
  /** Optional tracks: text of a button that removes the track (back to `absent`), e.g. "Flat". */
  resetText?: string;
  /** What a key's t is, for its accessible name ("Season", "position"). */
  tName: string;
  /** Where "Add keyframe" puts the new key. */
  addAt(state: EditorState, track: Track): number;
  /** Tooltip of the add button. */
  addHint: string;
  /** Strip colour of a number value (default: green with the value as opacity). */
  numberColor?(value: number): string;
}

/** CSS gradient of a track across 0..1. */
function trackGradient(spec: TrackSpec, track: Track): string {
  const colour = (value: HexColor | number): string =>
    spec.kind === 'color'
      ? String(value)
      : (spec.numberColor?.(Number(value)) ?? `rgb(62 125 43 / ${Math.round(Math.min(1, Number(value)) * 100)}%)`);
  const stops = track.map((key) => `${colour(key.value)} ${(key.t * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.length === 1 ? `${stops[0]}, ${stops[0]}` : stops.join(', ')})`;
}

/** The track at `spec.path` (or what an absent optional track means). */
export function readTrack(definition: TreeDefinition, spec: Pick<TrackSpec, 'path' | 'absent'>): Track {
  return (getAt(definition, spec.path) as Track | undefined) ?? spec.absent ?? [];
}

export function trackEditor(context: PanelContext, spec: TrackSpec): HTMLElement {
  const { store } = context;
  const { path } = spec;
  const read = (state: EditorState = store.state): Track => readTrack(state.definition, spec);
  const root = document.createElement('div');
  root.className = 'track';
  root.id = spec.id;
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
  add.title = spec.addHint;
  const buttons = document.createElement('div');
  buttons.className = 'track-buttons';
  buttons.append(add);
  let reset: HTMLButtonElement | null = null;
  if (spec.resetText !== undefined) {
    reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = spec.resetText;
    reset.setAttribute('aria-label', `${spec.resetText} ${spec.label}`);
    reset.addEventListener('click', () => tryEdit(() => setDefinitionValue(store, path, undefined)));
    buttons.append(reset);
  }

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
      const { track, index } = addKeyframe(read(), spec.addAt(store.state, read()));
      writeTrack(track, `${path}.${index}.t`);
    }),
  );
  /** A key's value: the stored one, or the absent track's while the track is absent. */
  const keyValue = (state: EditorState, i: number) => read(state)[i]?.value;
  const writeValue = (i: number, value: HexColor | number): void => {
    if (getAt(store.state.definition, path) === undefined) writeTrack(read().map((key, k) => (k === i ? { ...key, value } : { ...key })));
    else setDefinitionValue(store, `${path}.${i}.value`, value);
  };

  let shown = '';
  const build = (): void => {
    if (!root.isConnected && shown !== '') return unsubscribe();
    if (reset) reset.disabled = getAt(store.state.definition, path) === undefined;
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
          get: (state) => read(state)[i]?.t ?? 0,
          set: (_, value) => {
            const moved = moveKeyframe(read(), i, value);
            writeTrack(moved.track, `${path}.${moved.index}.t`);
          },
        });
        const valueId = `${path}.${i}.value`;
        const value =
          spec.kind === 'color'
            ? colorControl(context, {
                id: valueId,
                label: '',
                get: (state) => String(keyValue(state, i) ?? '#000000'),
                set: (_, v) => writeValue(i, v),
              })
            : numberControl(context, {
                kind: 'slider',
                id: valueId,
                label: '',
                min: spec.min ?? 0,
                max: spec.max ?? 1,
                step: 0.01,
                get: (state) => Number(keyValue(state, i) ?? 0),
                set: (_, v) => writeValue(i, v),
              });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${spec.label} key ${i + 1}`);
        remove.disabled = track.length <= 1;
        remove.addEventListener('click', () => tryEdit(() => writeTrack(removeKeyframe(read(), i))));
        // Short visible labels; full accessible names.
        t.querySelector('input')!.setAttribute('aria-label', `${spec.label} key ${i + 1} ${spec.tName}`);
        value.querySelector('input:not([aria-hidden])')!.setAttribute('aria-label', `${spec.label} key ${i + 1} value`);
        row.append(t, value, remove);
        return row;
      }),
    );
    if (focused) (document.getElementById(focused) as HTMLElement | null)?.focus();
  };
  const unsubscribe = store.subscribe(() => build());
  build();
  root.append(heading, strip, keys, buttons);
  return root;
}
