import { BrowserWindow, dialog, nativeTheme, screen, shell } from 'electron';
import path from 'node:path';
import type { AppStateStore } from './appState';
import { appIconFile } from './icons';

let win: BrowserWindow | undefined;
let pendingRoute: string | undefined;

export type ThemeSetting = 'system' | 'light' | 'dark';

/** Colours of the default look, until the editor tells the ones of the look in use. */
const DEFAULT_CHROME = {
  light: { bg: '#f1eefb', fg: '#1b1934' },
  dark: { bg: '#090b18', fg: '#eef0ff' },
};
let stateRef: AppStateStore | undefined;

/** Light, dark or as the system: the pages follow it (prefers-color-scheme) and send their title bar colours back. */
export function applyTheme(theme: ThemeSetting) {
  nativeTheme.themeSource = theme;
}

// light/dark changed (setting or system): the editor sends the colours of its title bar again, as now drawn
nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.webContents.send('chrome:request');
});

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i;

/**
 * The window buttons drawn by the system (minimize, maximize, close) take the colours of the
 * title bar of the look shown by the editor, light or dark, so they always match the page.
 */
export function setChrome(colors: { bg: string; fg: string }) {
  if (!COLOR.test(colors.bg) || !COLOR.test(colors.fg)) return;
  if (stateRef && (stateRef.get().chrome?.bg !== colors.bg || stateRef.get().chrome?.fg !== colors.fg)) stateRef.update({ chrome: colors });
  if (!win || win.isDestroyed()) return;
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: 44 });
    } catch {
      /* not supported on this platform */
    }
  }
  win.setBackgroundColor(colors.bg);
}

/** The window and taskbar icon of a look. */
export function setWindowIcon(style?: string) {
  if (win && !win.isDestroyed()) win.setIcon(appIconFile(style));
}

function visibleOnSomeDisplay(b: { x?: number; y?: number; width: number; height: number }) {
  if (b.x === undefined || b.y === undefined) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! + 80 > a.x && b.y! + 40 > a.y && b.x! < a.x + a.width - 80 && b.y! < a.y + a.height - 40;
  });
}

export function showWindow(state: AppStateStore, route?: string, dev?: string) {
  if (win && !win.isDestroyed()) {
    if (route) win.webContents.send('navigate', route);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  pendingRoute = route;
  const saved = state.get().window;
  const bounds = saved && visibleOnSomeDisplay(saved) ? saved : { width: saved?.width ?? 1100, height: saved?.height ?? 740 };
  stateRef = state;
  const c = state.get().chrome ?? (nativeTheme.shouldUseDarkColors ? DEFAULT_CHROME.dark : DEFAULT_CHROME.light);

  win = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'TrayCommand',
    backgroundColor: c.bg,
    icon: appIconFile(),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: c.bg, symbolColor: c.fg, height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();

  // The editor blocks unload while there are unsaved changes: ask before closing.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      detail: 'Close the editor and discard them?',
      buttons: ['Discard and close', 'Keep editing'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !(dev && url.startsWith(dev))) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  const save = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    state.update({ window: { ...b, maximized: win.isMaximized() } });
  };
  win.on('resized', save);
  win.on('moved', save);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('close', save);
  win.on('closed', () => {
    win = undefined;
  });
  win.once('ready-to-show', () => win?.show());

  const hash = encodeURIComponent(pendingRoute ?? '/');
  if (dev) void win.loadURL(`${dev}#${pendingRoute ?? '/'}`);
  else void win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'), { hash: decodeURIComponent(hash) });
  return win;
}

export function currentWindow() {
  return win && !win.isDestroyed() ? win : undefined;
}

export function sendToWindow(channel: string, ...args: unknown[]) {
  const w = currentWindow();
  if (w) w.webContents.send(channel, ...args);
}
