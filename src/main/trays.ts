import { Menu, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { watchTooltip } from '../shared/scheduleForm';
import type { Engine, RuntimeEntry } from './engine';
import { appIcon, sizedIcon, trayIcon } from './icons';
import type { RunningProcess } from './runner';
import { canonicalHotkey } from '../shared/hotkey';

export interface TrayHooks {
  openWindow: (route?: string) => void;
  openConfigFile: () => void;
  reload: () => void;
  quit: () => void;
  setTrayHidden: (trayId: string, hidden: boolean) => void;
  isAutostart: () => boolean;
  setAutostart: (on: boolean) => void;
  running: () => RunningProcess[];
  update: () => { version: string } | undefined;
  installUpdate: () => void;
  configError: () => string | undefined;
  openLauncher: () => void;
  launcherHotkey: () => string | undefined;
  hasSchedules: () => boolean;
  schedulesPaused: () => boolean;
  setSchedulesPaused: (paused: boolean) => void;
  /** macOS: monochrome menu bar icon in the Apple style instead of the colour icon of the look. */
  monochromeMenuBar: () => boolean;
  setMonochromeMenuBar: (on: boolean) => void;
}

/** Shortcut text shown next to a menu item (the shortcut itself is global, not a menu accelerator). */
function shortcut(hotkey: string | undefined): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> {
  const accelerator = hotkey ? canonicalHotkey(hotkey) : undefined;
  return accelerator ? { accelerator, registerAccelerator: false } : {};
}

function clock(t: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

const APP_KEY = '__traycommand__';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = !isWin && !isMac;

export class TrayManager {
  private trays = new Map<string, Tray>();
  private pending?: NodeJS.Timeout;

  constructor(
    private readonly engine: Engine,
    private readonly hooks: TrayHooks,
  ) {
    engine.onChange(() => this.scheduleSync());
  }

  /** Debounced: many state changes arrive together after a reload. */
  scheduleSync() {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.sync(), 60);
  }

  destroy() {
    for (const tray of this.trays.values()) tray.destroy();
    this.trays.clear();
  }

  private get appMenuTarget(): string {
    return this.engine.settings?.appMenu ?? 'own';
  }

  sync() {
    const wanted = new Map<string, RuntimeEntry | undefined>();
    const visible = this.engine.trays.filter((t) => !t.entry.hidden);
    const appTarget = this.appMenuTarget;
    const appHost = visible.find((t) => t.entry.id === appTarget);
    // The TrayCommand icon is shown when requested, when the host tray is hidden, or when nothing else is visible.
    if (appTarget === 'own' || !appHost || this.hooks.configError()) wanted.set(APP_KEY, undefined);
    for (const t of visible) wanted.set(t.entry.id!, t);

    for (const [key, tray] of this.trays) {
      if (!wanted.has(key)) {
        tray.destroy();
        this.trays.delete(key);
      }
    }
    for (const [key, entry] of wanted) {
      let tray = this.trays.get(key);
      const image = entry ? this.trayImage(entry) : trayIcon(16);
      if (!tray) {
        tray = new Tray(image);
        if (isMac) tray.setIgnoreDoubleClickEvents(true);
        this.bind(tray, key);
        this.trays.set(key, tray);
      } else {
        tray.setImage(image);
      }
      tray.setToolTip(entry ? this.tooltip(entry) : this.appTooltip());
      if (isLinux || (isMac && !(entry && this.engine.clickKind(entry)))) tray.setContextMenu(this.menuFor(key));
    }
  }

  private trayImage(entry: RuntimeEntry): NativeImage {
    return sizedIcon(this.engine.iconFor(entry), 16) ?? trayIcon(16);
  }

  private tooltip(entry: RuntimeEntry): string {
    const parts = [this.engine.label(entry)];
    if (entry.entry.state && entry.on !== undefined) parts.push(entry.on ? 'ON' : 'OFF');
    if (entry.busy) parts.push('running…');
    if (entry.entry.disabled) parts.push('disabled');
    const next = this.engine.nextRun(entry);
    if (next) parts.push(`next run ${clock(next)}`);
    const watching = watchTooltip(this.engine.watchStatus(entry));
    if (watching) parts.push(watching);
    return parts.join(' — ');
  }

  private appTooltip(): string {
    const error = this.hooks.configError();
    return error ? `TrayCommand — configuration error: ${error}` : 'TrayCommand';
  }

  private bind(tray: Tray, key: string) {
    const popup = () => tray.popUpContextMenu(this.menuFor(key));
    tray.on('click', () => {
      if (key === APP_KEY) {
        if (isWin) popup();
        return;
      }
      const entry = this.engine.get(key);
      if (!entry) return;
      if (this.engine.clickKind(entry) && this.engine.isEnabled(entry)) void this.engine.click(key);
      else if (!isLinux) popup();
    });
    tray.on('right-click', () => {
      const entry = key === APP_KEY ? undefined : this.engine.get(key);
      if (entry?.entry.rightAction && this.engine.isEnabled(entry)) void this.engine.rightClick(key);
      else if (!isLinux) popup();
    });
  }

  /** Builds the menu fresh, so it always reflects the current state. */
  menuFor(key: string): Menu {
    const items: MenuItemConstructorOptions[] = [];
    const entry = key === APP_KEY ? undefined : this.engine.get(key);
    if (entry) {
      // Linux trays cannot receive clicks: expose the click actions as menu items.
      if (isLinux) {
        const kind = this.engine.clickKind(entry);
        if (kind) items.push({ label: kind === 'off' ? `Turn off ${this.engine.label(entry)}` : `Run ${this.engine.label(entry)}`, enabled: this.engine.isEnabled(entry), click: () => void this.engine.click(entry.key) });
        if (entry.entry.rightAction) items.push({ label: `${this.engine.label(entry)} (alternate)`, click: () => void this.engine.rightClick(entry.key) });
        if (items.length && entry.children.length) items.push({ type: 'separator' });
      }
      items.push(...this.children(entry));
    }
    if (key === APP_KEY || entry?.entry.id === this.appMenuTarget) {
      if (items.length) items.push({ type: 'separator' });
      items.push(...(key === APP_KEY ? this.appItems() : [{ label: 'TrayCommand', icon: appIcon(16), submenu: this.appItems() }]));
    }
    if (!items.length) items.push({ label: 'Empty menu', enabled: false });
    return Menu.buildFromTemplate(items);
  }

  private children(entry: RuntimeEntry): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [];
    for (const child of entry.children) {
      if (child === 'separator') {
        if (items.length && items.at(-1)?.type !== 'separator') items.push({ type: 'separator' });
        continue;
      }
      if (child.entry.hidden) continue;
      items.push(this.item(child));
    }
    if (items.at(-1)?.type === 'separator') items.pop();
    return items;
  }

  private item(entry: RuntimeEntry): MenuItemConstructorOptions {
    const enabled = this.engine.isEnabled(entry);
    const label = `${this.engine.label(entry)}${entry.busy ? ' …' : ''}`;
    const icon = sizedIcon(this.engine.iconFor(entry), 16);
    const isToggle = !!entry.entry.state;
    const kind = this.engine.clickKind(entry);
    const base: MenuItemConstructorOptions = { label, enabled: enabled || entry.children.length > 0, ...(entry.children.length ? {} : shortcut(entry.entry.hotkey)) };
    if (icon) base.icon = icon;

    if (entry.children.length) {
      const sub = this.children(entry);
      if (kind) {
        sub.unshift({ label: kind === 'off' ? 'Turn off' : 'Run', enabled, click: () => void this.engine.click(entry.key) }, { type: 'separator' });
      }
      return { ...base, submenu: sub.length ? sub : [{ label: 'Empty', enabled: false }] };
    }
    if (isToggle && !icon) {
      // nothing to run (a title that shows the state): greyed out
      return { ...base, enabled: enabled && !!kind, type: 'checkbox', checked: entry.on === true, click: () => void this.engine.click(entry.key) };
    }
    return { ...base, enabled: enabled && !!kind, click: () => void this.engine.click(entry.key) };
  }

  private appItems(): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [];
    const error = this.hooks.configError();
    if (error) items.push({ label: `⚠ Configuration error — open editor`, click: () => this.hooks.openWindow('/json') }, { type: 'separator' });
    items.push({ label: 'Open TrayCommand', click: () => this.hooks.openWindow('/') });
    if (this.engine.trays.length) items.push({ label: 'Search and run…', click: () => this.hooks.openLauncher(), ...shortcut(this.hooks.launcherHotkey()) });

    const trays = this.engine.trays;
    if (trays.length) {
      items.push({
        label: 'Show trays',
        submenu: trays.map((t) => ({
          label: this.engine.label(t),
          type: 'checkbox' as const,
          checked: !t.entry.hidden,
          click: () => this.hooks.setTrayHidden(t.entry.id!, !t.entry.hidden),
        })),
      });
    }

    const running = this.hooks.running();
    if (running.length) {
      items.push({
        label: `Running (${running.length})`,
        submenu: running.map((p) => ({ label: `Stop “${p.label}” (${Math.round((Date.now() - p.startedAt) / 1000)}s)`, click: () => p.kill() })),
      });
    }

    if (this.hooks.hasSchedules()) {
      items.push({ label: 'Pause schedules', type: 'checkbox', checked: this.hooks.schedulesPaused(), click: (item) => this.hooks.setSchedulesPaused(item.checked) });
    }

    const update = this.hooks.update();
    if (update) items.push({ type: 'separator' }, { label: `Install update ${update.version}`, click: () => this.hooks.installUpdate() });

    items.push(
      { type: 'separator' },
      { label: 'Edit configuration file', click: () => this.hooks.openConfigFile() },
      { label: 'Reload configuration', click: () => this.hooks.reload() },
      { label: 'Start at login', type: 'checkbox', checked: this.hooks.isAutostart(), click: (item) => this.hooks.setAutostart(item.checked) },
      ...(isMac ? [{ label: 'Monochrome menu bar icon', type: 'checkbox' as const, checked: this.hooks.monochromeMenuBar(), click: (item: { checked: boolean }) => this.hooks.setMonochromeMenuBar(item.checked) }] : []),
      { label: 'Settings', click: () => this.hooks.openWindow('/settings') },
      { type: 'separator' },
      { label: 'Quit TrayCommand', click: () => this.hooks.quit() },
    );
    return items;
  }
}
