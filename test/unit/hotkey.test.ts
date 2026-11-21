import { describe, expect, it } from 'vitest';
import { canonicalHotkey, formatHotkey, hotkeyError, hotkeyFromEvent, hotkeyKeys, parseHotkey } from '../../src/shared/hotkey';
import { fuzzyMatch, fold } from '../../src/shared/fuzzy';

describe('hotkeys', () => {
  it('normalises aliases and order', () => {
    expect(parseHotkey('alt+ctrl+space').accelerator).toBe('Ctrl+Alt+Space');
    expect(parseHotkey('Control+Shift+k').accelerator).toBe('Ctrl+Shift+K');
    expect(parseHotkey('Win+E').accelerator).toBe('Super+E');
    expect(parseHotkey('CmdOrCtrl+Alt+F5').accelerator).toBe('CommandOrControl+Alt+F5');
    expect(parseHotkey('Ctrl++').accelerator).toBe('Ctrl+Plus');
    expect(parseHotkey('F9').accelerator).toBe('F9');
    expect(canonicalHotkey('ctrl+alt+v')).toBe(canonicalHotkey('Control+Alt+V'));
  });

  it('rejects shortcuts that would block typing or are malformed', () => {
    expect(hotkeyError('K')).toMatch(/at least Ctrl/);
    expect(hotkeyError('Shift+K')).toMatch(/at least Ctrl/);
    expect(hotkeyError('Ctrl+Alt')).toMatch(/Add a key/);
    expect(hotkeyError('Ctrl+K+L')).toMatch(/Only one key/);
    expect(hotkeyError('Ctrl+Banana')).toMatch(/Unknown key/);
    expect(hotkeyError('')).toMatch(/Empty/);
    expect(hotkeyError('Shift+F2')).toBeUndefined();
  });

  it('records by physical key', () => {
    const e = { key: '€', code: 'KeyE', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    expect(hotkeyFromEvent(e)).toBe('Ctrl+Alt+E');
    expect(hotkeyFromEvent({ ...e, code: 'ControlLeft' })).toBeUndefined();
    expect(hotkeyFromEvent({ ...e, code: 'Space', altKey: false })).toBe('Ctrl+Space');
    expect(hotkeyFromEvent({ ...e, code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false }, 'darwin')).toBe('CommandOrControl+K');
  });

  it('formats for display', () => {
    expect(hotkeyKeys('Ctrl+Alt+Space')).toEqual(['Ctrl', 'Alt', 'Space']);
    expect(hotkeyKeys('Super+Up', 'win32')).toEqual(['Win', '↑']);
    expect(formatHotkey('CommandOrControl+Shift+K', 'darwin')).toBe('⌘⇧K');
  });
});

describe('fuzzy', () => {
  it('folds accents and case', () => {
    expect(fold('Perché ÀB')).toBe('perche ab');
  });
  it('matches substrings, initials and the path', () => {
    expect(fuzzyMatch('vpn', 'Toggle VPN')).toBeDefined();
    expect(fuzzyMatch('dcu', 'Docker compose up')).toBeDefined();
    expect(fuzzyMatch('docker up', 'Up', 'Docker › Compose')).toBeDefined();
    expect(fuzzyMatch('xyz', 'Docker')).toBeUndefined();
    expect(fuzzyMatch('perche', 'Perché no')!.label).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('ranks prefix and word starts higher', () => {
    const score = (q: string, l: string) => fuzzyMatch(q, l)!.score;
    expect(score('st', 'Start server')).toBeGreaterThan(score('st', 'Restart server'));
    expect(score('ss', 'Start server')).toBeGreaterThan(score('ss', 'Classic'));
    expect(score('vpn', 'VPN')).toBeGreaterThan(score('vpn', 'Corporate VPN connection'));
  });
});
