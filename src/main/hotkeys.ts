import { globalShortcut } from 'electron';
import { canonicalHotkey, hotkeyError } from '../shared/hotkey';
import type { HotkeyStatus } from '../shared/api';

export interface HotkeyBinding {
  /** Where it is defined, e.g. "settings.launcherHotkey" or "trays[0].menu[1]". */
  path: string;
  hotkey: string;
  label: string;
  handler: () => void;
}

/** Holding the keys repeats the press: ignore repeats closer than this. */
const REPEAT_MS = 350;

/**
 * Registers global shortcuts. Shortcuts that did not change stay registered across
 * configuration reloads, so a save never opens a window in which they do not work.
 */
export class HotkeyManager {
  private registered = new Map<string, HotkeyBinding>();
  private last = new Map<string, number>();
  private wanted: HotkeyBinding[] = [];
  private current: HotkeyStatus[] = [];
  private suspended = false;
  private listeners = new Set<(status: HotkeyStatus[]) => void>();

  apply(bindings: HotkeyBinding[]) {
    this.wanted = bindings;
    if (this.suspended) return;
    const desired = new Map<string, HotkeyBinding>();
    const status: HotkeyStatus[] = [];
    for (const b of bindings) {
      const base = { path: b.path, hotkey: b.hotkey, label: b.label };
      const error = hotkeyError(b.hotkey);
      if (error) {
        status.push({ ...base, ok: false, error });
        continue;
      }
      const accelerator = canonicalHotkey(b.hotkey)!;
      if (desired.has(accelerator)) {
        status.push({ ...base, ok: false, error: `Also used by ${desired.get(accelerator)!.label}` });
        continue;
      }
      desired.set(accelerator, b);
    }
    for (const accelerator of [...this.registered.keys()]) {
      if (!desired.has(accelerator)) {
        globalShortcut.unregister(accelerator);
        this.registered.delete(accelerator);
      }
    }
    for (const [accelerator, b] of desired) {
      const base = { path: b.path, hotkey: b.hotkey, label: b.label };
      if (this.registered.has(accelerator)) {
        this.registered.set(accelerator, b); // same keys: only the handler may have changed
        status.push({ ...base, ok: true });
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => this.fire(accelerator));
      } catch (error) {
        status.push({ ...base, ok: false, error: (error as Error).message });
        continue;
      }
      if (ok) {
        this.registered.set(accelerator, b);
        status.push({ ...base, ok: true });
      } else {
        status.push({ ...base, ok: false, error: process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland' ? 'Global shortcuts are not available on Wayland' : 'Already used by another application' });
      }
    }
    this.current = status;
    for (const l of this.listeners) l(status);
  }

  private fire(accelerator: string) {
    const now = Date.now();
    if (now - (this.last.get(accelerator) ?? 0) < REPEAT_MS) return;
    this.last.set(accelerator, now);
    this.registered.get(accelerator)?.handler();
  }

  /** While the editor records a new shortcut, the existing ones must not fire. */
  suspend(on: boolean) {
    if (on === this.suspended) return;
    this.suspended = on;
    if (on) {
      globalShortcut.unregisterAll();
      this.registered.clear();
    } else {
      this.apply(this.wanted);
    }
  }

  status(): HotkeyStatus[] {
    return this.current;
  }

  failures(): HotkeyStatus[] {
    return this.current.filter((s) => !s.ok);
  }

  onChange(listener: (status: HotkeyStatus[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    globalShortcut.unregisterAll();
    this.registered.clear();
  }
}
