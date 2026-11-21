/*
 * Keyboard shortcuts in Electron accelerator format ("Ctrl+Alt+Space", "Super+Shift+K", "F9").
 * Shared by the main process (registration), the editor (recorder) and validation.
 */

export type Modifier = 'CommandOrControl' | 'Ctrl' | 'Alt' | 'Shift' | 'Super';

const MODIFIER_ALIASES: Record<string, Modifier> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  ctl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  windows: 'Super',
  cmd: 'Super',
  command: 'Super',
};
const MODIFIER_ORDER: Modifier[] = ['CommandOrControl', 'Ctrl', 'Alt', 'Shift', 'Super'];

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  esc: 'Esc',
  escape: 'Esc',
  plus: 'Plus',
  printscreen: 'PrintScreen',
  num0: 'num0', num1: 'num1', num2: 'num2', num3: 'num3', num4: 'num4',
  num5: 'num5', num6: 'num6', num7: 'num7', num8: 'num8', num9: 'num9',
  numadd: 'numadd', numsub: 'numsub', nummult: 'nummult', numdiv: 'numdiv', numdec: 'numdec',
};
const PUNCTUATION = new Set([...")!@#$%^&*(:;+=<,_->.?/~`{]|[}\\'\""]);

export interface ParsedHotkey {
  modifiers: Modifier[];
  key: string;
  /** Canonical accelerator, e.g. "Ctrl+Alt+Space". */
  accelerator: string;
}

function canonicalKey(raw: string): string | undefined {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  const named = NAMED_KEYS[raw.toLowerCase()];
  if (named) return named;
  if (raw.length === 1 && PUNCTUATION.has(raw)) return raw === '+' ? 'Plus' : raw;
  return undefined;
}

/** Parses and normalises an accelerator; throws with a readable message when invalid. */
export function parseHotkey(text: string): ParsedHotkey {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty shortcut');
  // "Ctrl++" means Ctrl and the plus key
  const parts = trimmed.replace(/\+\+$/, '+Plus').split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) throw new Error(`"${text}" is not a valid shortcut`);
  const modifiers = new Set<Modifier>();
  let key: string | undefined;
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (mod) {
      modifiers.add(mod);
      continue;
    }
    if (key) throw new Error(`Only one key besides the modifiers (found "${key}" and "${part}")`);
    key = canonicalKey(part);
    if (!key) throw new Error(`Unknown key "${part}"`);
  }
  if (!key) throw new Error('Add a key besides the modifiers, e.g. Ctrl+Alt+K');
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  const isFunctionKey = /^F\d+$/.test(key);
  const strong = ordered.some((m) => m !== 'Shift');
  if (!strong && !isFunctionKey) throw new Error('Use at least Ctrl, Alt or Win/Cmd with this key, so that it does not block normal typing');
  return { modifiers: ordered, key, accelerator: [...ordered, key].join('+') };
}

export function hotkeyError(text: string): string | undefined {
  try {
    parseHotkey(text);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Canonical form used to compare shortcuts ("ctrl+alt+k" and "Control+Alt+K" are the same). */
export function canonicalHotkey(text: string): string | undefined {
  try {
    return parseHotkey(text).accelerator;
  } catch {
    return undefined;
  }
}

/** Keys to show as separate keycaps, with platform names (Win / ⌘ …). */
export function hotkeyKeys(text: string, platform: string = 'win32'): string[] {
  let parsed: ParsedHotkey;
  try {
    parsed = parseHotkey(text);
  } catch {
    return [text];
  }
  const mac = platform === 'darwin';
  const name = (m: Modifier) =>
    m === 'CommandOrControl' ? (mac ? '⌘' : 'Ctrl') : m === 'Ctrl' ? (mac ? '⌃' : 'Ctrl') : m === 'Alt' ? (mac ? '⌥' : 'Alt') : m === 'Shift' ? (mac ? '⇧' : 'Shift') : mac ? '⌘' : platform === 'win32' ? 'Win' : 'Super';
  const keyName: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Plus: '+', PageUp: 'PgUp', PageDown: 'PgDn' };
  return [...parsed.modifiers.map(name), keyName[parsed.key] ?? parsed.key];
}

export function formatHotkey(text: string, platform?: string): string {
  return hotkeyKeys(text, platform).join(platform === 'darwin' ? '' : '+');
}

/** Minimal shape of a DOM KeyboardEvent, so this module stays DOM-free. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', PrintScreen: 'PrintScreen',
};

/**
 * Accelerator for a key press in the recorder, by physical key (so "Ctrl+Alt+E" is recorded as E,
 * not as "€" on layouts where Ctrl+Alt is AltGr). Undefined while only modifiers are pressed.
 */
export function hotkeyFromEvent(e: KeyLike, platform: string = 'win32'): string | undefined {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code];
  if (!key) return undefined;
  const mods: string[] = [];
  if (platform === 'darwin') {
    if (e.metaKey) mods.push('CommandOrControl');
    if (e.ctrlKey) mods.push('Ctrl');
  } else {
    if (e.ctrlKey) mods.push('Ctrl');
  }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (platform !== 'darwin' && e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}
