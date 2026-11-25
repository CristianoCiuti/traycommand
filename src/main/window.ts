import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import path from 'node:path';
import type { AppStateStore } from './appState';
import { appIconFile } from './icons';

let win: BrowserWindow | undefined;
let pendingRoute: string | undefined;
/** Look in use: the window opens with it (never with another one, not even for a frame). */
let lookStyle: string | undefined;

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
  lookStyle = style;
  if (win && !win.isDestroyed()) win.setIcon(appIconFile(style));
}

function visibleOnSomeDisplay(b: { x?: number; y?: number; width: number; height: number }) {
  if (b.x === undefined || b.y === undefined) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x! + 80 > a.x && b.y! + 40 > a.y && b.x! < a.x + a.width - 80 && b.y! < a.y + a.height - 40;
  });
}

/** Asked to be shown: shown as soon as its page has drawn its first frame. */
let wantShow = false;
/** Its page has drawn: showing it is immediate. */
let ready = false;
/** Closing for good (the system session ends): the close is not turned into a hide. */
let closingForGood = false;

/**
 * The editor window. It is created once and kept: closing it hides it, so opening it again is
 * immediate (a new window starts a new renderer process and loads the whole page, which takes
 * seconds on some PCs). Its page keeps up with the configuration while hidden.
 */
export function showWindow(state: AppStateStore, route?: string, dev?: string) {
  if (win && !win.isDestroyed()) {
    if (route) win.webContents.send('navigate', route);
    if (!ready) {
      wantShow = true;
      return win;
    }
    if (win.isMinimized()) win.restore();
    // loaded hidden at start-up: it opens as it was left (maximize also shows it)
    if (!win.isVisible() && state.get().window?.maximized && !win.isMaximized()) win.maximize();
    win.show();
    win.focus();
    return win;
  }
  wantShow = true;
  return createWindow(state, route, dev);
}

/** Loads the editor hidden, so that the first open is immediate too (started hidden at login). */
export function prepareWindow(state: AppStateStore, dev?: string) {
  if (win && !win.isDestroyed()) return win;
  wantShow = false;
  return createWindow(state, undefined, dev);
}

/** Closing the editor hides it (its page has already asked about unsaved changes). */
export function hideWindow() {
  if (!win || win.isDestroyed()) return;
  wantShow = false;
  win.hide();
}

function createWindow(state: AppStateStore, route?: string, dev?: string) {
  pendingRoute = route;
  ready = false;
  const saved = state.get().window;
  const bounds = saved && visibleOnSomeDisplay(saved) ? saved : { width: saved?.width ?? 1100, height: saved?.height ?? 740 };
  stateRef = state;
  const c = state.get().chrome ?? (nativeTheme.shouldUseDarkColors ? DEFAULT_CHROME.dark : DEFAULT_CHROME.light);

  const w = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'TrayCommand',
    backgroundColor: c.bg,
    icon: appIconFile(lookStyle),
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
  win = w;
  if (saved?.maximized && wantShow) w.maximize();

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !(dev && url.startsWith(dev))) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  const save = () => {
    if (w.isDestroyed() || !w.isVisible()) return;
    const b = w.getNormalBounds();
    state.update({ window: { ...b, maximized: w.isMaximized() } });
  };
  w.on('resized', save);
  w.on('moved', save);
  w.on('maximize', save);
  w.on('unmaximize', save);
  // the close becomes a hide: the page asks about unsaved changes first, then hides it (window:close).
  // A page that crashed, or the end of the system session, close it for real.
  w.on('close', (event) => {
    save();
    if (closingForGood || w.webContents.isCrashed()) return;
    event.preventDefault();
    w.webContents.send('close-requested');
  });
  w.on('session-end', () => (closingForGood = true));
  w.on('closed', () => {
    if (win === w) win = undefined;
  });
  // a page that crashed is loaded again next time
  w.webContents.on('render-process-gone', () => {
    if (!w.isDestroyed()) w.destroy();
  });
  w.once('ready-to-show', () => {
    ready = true;
    if (!wantShow || w.isDestroyed()) return;
    if (state.get().window?.maximized && !w.isMaximized()) w.maximize();
    w.show();
  });

  // the page is told the look in use, so its first frame (shown by ready-to-show) already has it
  const query = lookStyle ? { style: lookStyle } : undefined;
  if (dev) void w.loadURL(`${dev}${query ? `?${new URLSearchParams(query)}` : ''}#${pendingRoute ?? '/'}`);
  else void w.loadFile(path.join(__dirname, '..', 'ui', 'index.html'), { query, hash: pendingRoute ?? '/' });
  return w;
}

/** The editor window, also while hidden. */
export function currentWindow() {
  return win && !win.isDestroyed() ? win : undefined;
}

export function sendToWindow(channel: string, ...args: unknown[]) {
  const w = currentWindow();
  if (w) w.webContents.send(channel, ...args);
}
