import { describe, expect, it } from 'vitest';
import { historyShortcut } from './history-controls';

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: false,
});

describe('undo/redo keyboard shortcuts', () => {
  it('maps Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z or Ctrl+Y to redo', () => {
    expect(historyShortcut(key('z', { ctrl: true }))).toBe('undo');
    expect(historyShortcut(key('z', { meta: true }))).toBe('undo');
    expect(historyShortcut(key('Z', { ctrl: true, shift: true }))).toBe('redo');
    expect(historyShortcut(key('z', { meta: true, shift: true }))).toBe('redo');
    expect(historyShortcut(key('y', { ctrl: true }))).toBe('redo');
  });

  it('ignores other keys', () => {
    expect(historyShortcut(key('z'))).toBeNull();
    expect(historyShortcut(key('y', { shift: true }))).toBeNull();
    expect(historyShortcut({ ...key('z', { ctrl: true }), altKey: true })).toBeNull();
  });
});
