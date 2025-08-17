import { describe, it, expect } from 'vitest';
import { HotkeyManager, normalizeChord } from '../../core/hotkeys/index.js';

describe('HotkeyManager', () => {
  it('registers default palette hotkey Mod+K and triggers handler', async () => {
    const hk = new HotkeyManager('darwin');
    let ok = 0;
    hk.register('palette.open', 'Mod+K', () => { ok++; });
    const handled = await hk.handle({ key: 'k', metaKey: true });
    expect(handled).toBe(true);
    expect(ok).toBe(1);
  });

  it('remaps hotkey and avoids conflicts', () => {
    const hk = new HotkeyManager('win32');
    hk.register('palette.open', 'Mod+K', () => {}); // resolves to Ctrl+K on win32
    expect(() => hk.register('something', 'Ctrl+K', () => {})).toThrow();
    hk.remap('palette.open', 'Ctrl+Shift+P');
    // old chord no longer matches
    return hk.handle({ key: 'k', ctrlKey: true }).then((v) => {
      expect(v).toBe(false);
    });
  });

  it('normalizes chords case-insensitively and matches event modifiers exactly', () => {
    const mac = normalizeChord('cmd+shift+p', 'darwin');
    expect(`${mac.modifiers.join('+')}+${mac.key}`).toBe('Meta+Shift+P');
    const win = normalizeChord('mod+shift+p', 'win32');
    expect(`${win.modifiers.join('+')}+${win.key}`).toBe('Ctrl+Shift+P');
  });
});

