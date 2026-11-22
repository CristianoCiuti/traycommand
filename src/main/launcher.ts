import { app, BrowserWindow, dialog, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { LauncherShow, PromptRequest } from '../shared/api';
import { launcherOrigin } from './launcherPlace';

export interface LauncherHooks {
  /** Data for the list (built fresh at every opening: the engine is in memory, this is fast). */
  show: (scope?: string) => LauncherShow;
  run: (key: string, alternate: boolean) => { ok: boolean; message?: string; keepOpen?: boolean };
  options: (promptId: number, name: string) => Promise<{ options?: string[]; error?: string }>;
  edit: (key: string) => void;
  /** Where the person last moved the launcher (top-left corner of the window); centred when undefined. */
  position?: () => { x: number; y: number } | undefined;
  setPosition?: (position: { x: number; y: number } | undefined) => void;
}

const WIDTH = 680;
/** Tallest the palette gets: it is centred on this height, so it does not jump while the list shrinks. */
const MAX_HEIGHT = 520;

interface PendingPrompt {
  request: PromptRequest;
  resolve: (values: Record<string, string> | undefined) => void;
  fromList: boolean;
}

/**
 * The launcher: a frameless window created hidden at startup and kept loaded, so that the
 * shortcut only has to show it. It also hosts the forms that ask the inputs of an action.
 */
export class Launcher {
  private win?: BrowserWindow;
  private loaded?: Promise<void>;
  private mode: 'hidden' | 'list' | 'prompt' = 'hidden';
  private current?: PendingPrompt;
  private queue: PendingPrompt[] = [];
  private height = 120;
  /** The launcher closes when it loses focus, except right after showing (Windows may blur it once). */
  private shownAt = 0;
  /** The look in use. */
  private style = 'aurora';
  /** Last position set by the app: a move to anywhere else was made by the person. */
  private placed?: { x: number; y: number };
  private moveTimer?: NodeJS.Timeout;

  constructor(
    private readonly hooks: LauncherHooks,
    private readonly devUrl?: string,
  ) {
    const own = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.handle('launcher:run', (e, key: string, alternate: boolean) => {
      if (!own(e)) return { ok: false };
      const r = this.hooks.run(key, alternate);
      if (r.ok && !r.keepOpen && this.mode === 'list') this.hide();
      return { ok: r.ok, message: r.message };
    });
    ipcMain.on('launcher:submit', (e, id: number, values: Record<string, string>) => {
      if (own(e) && this.current?.request.id === id) this.finish(values, !!this.current.request.alert);
    });
    ipcMain.on('launcher:cancel', (e, id: number, back: boolean) => {
      if (own(e) && this.current?.request.id === id) this.finish(undefined, back || !!this.current.request.alert);
    });
    ipcMain.handle('launcher:options', (e, id: number, name: string) => (own(e) ? this.hooks.options(id, name) : { error: 'denied' }));
    ipcMain.handle('launcher:pick', async (e, type: 'file' | 'folder', current: string) => {
      if (!own(e) || !this.win) return undefined;
      const r = await dialog.showOpenDialog(this.win, { defaultPath: current || undefined, properties: [type === 'folder' ? 'openDirectory' : 'openFile'] });
      this.win.focus();
      return r.canceled ? undefined : r.filePaths[0];
    });
    ipcMain.on('launcher:edit', (e, key: string) => {
      if (!own(e)) return;
      this.hide();
      this.hooks.edit(key);
    });
    ipcMain.on('launcher:close', (e) => {
      if (!own(e)) return;
      if (this.current) this.finish(undefined, false);
      else this.hide();
    });
    ipcMain.handle('style', (e) => (own(e) ? this.style : 'aurora'));
    ipcMain.on('launcher:resize', (e, height: number) => {
      if (!own(e) || !this.win) return;
      this.height = Math.max(60, Math.min(Math.ceil(height), MAX_HEIGHT + 40));
      this.place();
    });
  }

  /** Shows another look (sent to the window if it is already loaded; asked by it otherwise). */
  setStyle(style: string) {
    if (style === this.style) return;
    this.style = style;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('style', style);
  }

  /** Creates the window in the background; call once the app is ready. */
  create() {
    if (this.win && !this.win.isDestroyed()) return;
    const win = new BrowserWindow({
      width: WIDTH,
      height: this.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      // moved by dragging its search bar, form header or footer (where it goes is remembered)
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'TrayCommand launcher',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, 'pop-up-menu');
    // macOS: also over full-screen apps and on every desktop
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('blur', () => {
      if (this.mode === 'list' && Date.now() - this.shownAt > 150) this.hide();
    });
    win.on('move', () => {
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => this.moved(), 250);
    });
    win.on('closed', () => {
      this.win = undefined;
      this.loaded = undefined;
      this.mode = 'hidden';
    });
    this.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    if (this.devUrl) void win.loadURL(`${this.devUrl}launcher.html`);
    else void win.loadFile(path.join(__dirname, '..', 'ui', 'launcher.html'));
  }

  get visible() {
    return this.mode !== 'hidden';
  }

  /** Window bounds: where the person moved it (kept on a screen), else centred on the primary display. */
  private place() {
    if (!this.win || this.win.isDestroyed()) return;
    const { x, y } = launcherOrigin(
      this.hooks.position?.(),
      { width: WIDTH, height: this.height, maxHeight: MAX_HEIGHT },
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    this.placed = { x, y };
    this.win.setBounds({ x, y, width: WIDTH, height: this.height });
  }

  /** Forgets where the person moved the launcher: it opens centred on the primary screen again. */
  resetPosition() {
    this.hooks.setPosition?.(undefined);
    if (this.visible) this.place();
  }

  /** The window was moved: remember where, unless the move was the app placing it. */
  private moved() {
    if (!this.win || this.win.isDestroyed()) return;
    const { x, y } = this.win.getBounds();
    if (this.placed && Math.abs(this.placed.x - x) <= 1 && Math.abs(this.placed.y - y) <= 1) return;
    this.placed = { x, y };
    this.hooks.setPosition?.({ x, y });
  }

  private async reveal() {
    this.create();
    await this.loaded;
    const win = this.win!;
    this.place();
    this.shownAt = Date.now();
    if (!win.isVisible()) win.show();
    // a menu bar app is not active on macOS: take the focus explicitly
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.moveTop();
    win.focus();
    win.webContents.focus();
  }

  /** Opens the list (or closes it when it is already open: the shortcut toggles). */
  async toggle(scope?: string) {
    if (this.mode === 'list') return this.hide();
    if (this.mode === 'prompt') return this.reveal();
    return this.open(scope);
  }

  async open(scope?: string) {
    if (this.mode === 'prompt') return this.reveal();
    this.create();
    await this.loaded;
    this.mode = 'list';
    this.win!.webContents.send('launcher:show', this.hooks.show(scope));
    await this.reveal();
  }

  hide() {
    if (this.current) return; // a form is waiting for an answer
    this.mode = 'hidden';
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.webContents.send('launcher:hide');
    win.hide();
  }

  /** Asks the inputs of an action; resolves with the values, or undefined when cancelled. */
  prompt(request: PromptRequest): Promise<Record<string, string> | undefined> {
    return new Promise((resolve) => {
      const pending: PendingPrompt = { request, resolve, fromList: false };
      if (this.current) this.queue.push(pending);
      else void this.startPrompt(pending);
    });
  }

  private async startPrompt(pending: PendingPrompt, fromList = this.mode === 'list') {
    pending.fromList = fromList;
    this.current = pending;
    this.create();
    await this.loaded;
    this.mode = 'prompt';
    this.win!.webContents.send('launcher:prompt', { ...pending.request, fromList: pending.fromList });
    await this.reveal();
  }

  private finish(values: Record<string, string> | undefined, back: boolean) {
    const done = this.current;
    if (!done) return;
    this.current = undefined;
    done.resolve(values);
    const next = this.queue.shift();
    // back to the list only when a person asked for it (Esc on a form) or answered an alert that interrupted it;
    // a form submitted from the list runs and closes, an alert closed by itself does not bring the list back
    const toList = back && done.fromList;
    if (next) {
      void this.startPrompt(next, toList);
      return;
    }
    if (toList) {
      this.mode = 'list';
      this.win?.webContents.send('launcher:back');
      return;
    }
    this.hide();
  }

  /** Closes a form or alert shown or waiting (answered as cancelled). */
  dismiss(id: number) {
    if (this.current?.request.id === id) return this.finish(undefined, false);
    const i = this.queue.findIndex((p) => p.request.id === id);
    if (i >= 0) this.queue.splice(i, 1)[0]!.resolve(undefined);
  }

  destroy() {
    for (const p of [this.current, ...this.queue]) p?.resolve(undefined);
    this.current = undefined;
    this.queue = [];
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
