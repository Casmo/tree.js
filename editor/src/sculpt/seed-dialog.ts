// The Seed-change warning as a modal <dialog>, and the one Seed guard per store that every Seed
// control of the editor shares.
import type { EditorStore } from '../store';
import { createSeedGuard, type SeedGuard } from './seed-guard';

/** Shows `message` in a modal dialog; resolves true for "Change Seed", false for "Cancel" (or Escape). */
export function confirmSeedDialog(message: string): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.id = 'seed-warning';
  dialog.setAttribute('aria-labelledby', 'seed-warning-title');
  const title = document.createElement('h2');
  title.id = 'seed-warning-title';
  title.textContent = 'Change Seed?';
  const text = document.createElement('p');
  text.textContent = message;
  const form = document.createElement('form');
  form.method = 'dialog';
  const cancel = document.createElement('button');
  cancel.value = 'cancel';
  cancel.textContent = 'Cancel';
  const change = document.createElement('button');
  change.value = 'change';
  change.textContent = 'Change Seed';
  form.append(cancel, change);
  dialog.append(title, text, form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'change');
      dialog.remove();
    });
    dialog.showModal();
    cancel.focus();
  });
}

const guards = new WeakMap<EditorStore, SeedGuard>();

/** The editor's Seed guard for `store` (warns with the dialog). */
export function seedGuard(store: EditorStore): SeedGuard {
  let guard = guards.get(store);
  if (!guard) guards.set(store, (guard = createSeedGuard(store, confirmSeedDialog)));
  return guard;
}
