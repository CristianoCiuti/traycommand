import { app, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeAction, parseConfig, type Action, type Config } from '../shared/config';
import type { AppInfo, ExecutionLog, LoadedConfig, SaveResult, TestResult } from '../shared/api';
import { AppStateStore } from './appState';
import { defaultAutostartEnv, disableAutostart, isAutostartEnabled, startupFolder, syncAutostart, type LaunchTarget } from './autostart';
import { ConfigStore } from './configStore';
import { createAdminRunner, disableElevatedScript, enableElevatedScript, runElevatedOnce, runElevatedTask } from './elevation';
import { evaluateState, Engine } from './engine';
import { iconDataUrl } from './icons';
import { installForUser, isInstalled } from './install';
import { LogStore } from './logStore';
import { APP_ID, APP_NAME, currentInstallRoot, DOCS_URL, machineInstallDir, samePath, userInstallDir } from './paths';
import { onRunningChange, runningProcesses, runScript } from './runner';
import { TrayManager } from './trays';
import { Updater } from './updater';
import { applyTheme, currentWindow, sendToWindow, showWindow } from './window';

/* ---------------- arguments & paths ---------------- */

const argv = process.argv.slice(1);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const devUrl = flag('dev') ? (process.env.TRAYCOMMAND_DEV_URL ?? 'http://localhost:5173/') : undefined;
app.setName(APP_NAME);
if (option('data-dir')) app.setPath('userData', path.resolve(option('data-dir')!));
const dataDir = app.getPath('userData');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const state = new AppStateStore(path.join(dataDir, 'state.json'));
const logs = new LogStore(path.join(dataDir, 'logs'));
const configPath = path.resolve(option('config') ?? process.env.TRAYCOMMAND_CONFIG ?? state.get().configPath ?? path.join(dataDir, 'traycommand.json'));

/* ---------------- notifications & dialogs ---------------- */

function notify(title: string, body: string, kind: 'info' | 'warning' | 'error' = 'info') {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: kind === 'info', urgency: kind === 'error' ? 'critical' : 'normal' });
  n.on('click', () => {
    if (kind === 'error') showWindow(state, '/logs', devUrl);
  });
  n.show();
}

async function confirm(title: string, text: string) {
  const w = currentWindow();
  const options = { type: 'question' as const, title, message: title, detail: text, buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true };
  const r = w ? await dialog.showMessageBox(w, options) : await dialog.showMessageBox(options);
  return r.response === 0;
}

/* ---------------- engine, store, trays ---------------- */

const engine = new Engine({
  run: runScript,
  runAdmin: createAdminRunner(),
  notify,
  confirm,
  log: (entry) => logs.add(entry),
});

let configError: string | undefined;

function applyLoaded(loaded: LoadedConfig) {
  if (!loaded.ok) {
    configError = loaded.issues[0] ? `${loaded.issues[0].path || 'file'}: ${loaded.issues[0].message}` : 'invalid file';
    notify('TrayCommand', `The configuration has errors and was not applied.\n${configError}`, 'error');
    trays?.scheduleSync();
    sendToWindow('config-changed');
    return;
  }
  configError = undefined;
  engine.load(loaded.config, store.dir);
  engine.start();
  applyTheme(loaded.config.settings.theme);
  applySettings(loaded.config);
  sendToWindow('config-changed');
}

const store = new ConfigStore(configPath, path.join(dataDir, 'backups'), (loaded) => applyLoaded(loaded));

let trays: TrayManager | undefined;

/* ---------------- autostart / install ---------------- */

const writeShortcut = (file: string, spec: Electron.ShortcutDetails) =>
  shell.writeShortcutLink(file, 'replace', spec) || shell.writeShortcutLink(file, 'create', spec);
const autostartEnv = defaultAutostartEnv((file, spec) => writeShortcut(file, spec));

function relaunchArgs(): string[] {
  const args = ['--hidden'];
  if (option('config')) args.push(`--config=${configPath}`);
  return args;
}

function launchTarget(): LaunchTarget {
  if (process.platform === 'linux' && process.env.APPIMAGE) return { command: process.env.APPIMAGE, args: relaunchArgs(), cwd: os.homedir() };
  return { command: process.execPath, args: relaunchArgs(), cwd: path.dirname(process.execPath) };
}

function applySettings(config: Config) {
  // Autostart points to the running executable; only for packaged builds (never to the dev electron.exe).
  if (app.isPackaged && !state.get().startElevated) {
    try {
      syncAutostart(autostartEnv, config.settings.autostart, launchTarget());
    } catch (error) {
      notify('TrayCommand', `Cannot update start at login: ${(error as Error).message}`, 'error');
    }
  }
  updater.schedule(config.settings.checkUpdates);
}

function setAutostart(on: boolean): boolean {
  const loaded = store.loaded;
  if (!loaded?.ok) return isAutostartEnabled(autostartEnv);
  const config = { ...loaded.config, settings: { ...loaded.config.settings, autostart: on } };
  saveConfig(config);
  return on;
}

/* ---------------- updates ---------------- */

const updater = new Updater(dataDir, relaunchArgs);
updater.onChange((info) => {
  sendToWindow('update', info);
  if (info.state === 'available') trays?.scheduleSync();
});

function quit() {
  trays?.destroy();
  engine.stop();
  store.unwatch();
  app.exit(0);
}

/* ---------------- config operations ---------------- */

function saveConfig(config: Config): SaveResult {
  const result = store.save(config);
  if (result.ok && store.loaded) applyLoaded(store.loaded);
  return result;
}

function setTrayHidden(trayId: string, hidden: boolean) {
  const loaded = store.loaded;
  if (!loaded?.ok) return;
  saveConfig({ ...loaded.config, trays: loaded.config.trays.map((t) => (t.id === trayId ? { ...t, hidden: hidden || undefined } : t)) });
}

function openConfigFile() {
  void shell.openPath(store.path);
}

/* ---------------- opt-in elevated start (Windows) ---------------- */

async function setStartElevated(on: boolean): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== 'win32') return { ok: false, message: 'Only available on Windows' };
  const target = machineInstallDir();
  if (on) {
    const user = `${process.env.USERDOMAIN ?? os.hostname()}\\${process.env.USERNAME ?? os.userInfo().username}`;
    const result = await runElevatedOnce(enableElevatedScript(currentInstallRoot(), target, user, path.join(startupFolder(autostartEnv), `${APP_NAME}.lnk`)));
    if (!result.ok) return result;
    state.update({ startElevated: true });
    return { ok: true, message: 'TrayCommand will start as administrator at the next login.' };
  }
  const runningFromTarget = samePath(currentInstallRoot(), target);
  const result = await runElevatedOnce(disableElevatedScript(target, runningFromTarget));
  if (!result.ok) return result;
  state.update({ startElevated: false });
  if (store.loaded?.ok && app.isPackaged) {
    const exe = runningFromTarget && fs.existsSync(userInstallDir()) ? path.join(userInstallDir(), `${APP_NAME}.exe`) : process.execPath;
    syncAutostart(autostartEnv, store.loaded.config.settings.autostart, { ...launchTarget(), command: exe, cwd: path.dirname(exe) });
  }
  return { ok: true };
}

/* ---------------- IPC ---------------- */

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => R | Promise<R>) {
  ipcMain.handle(channel, (_event: IpcMainInvokeEvent, ...args: unknown[]) => fn(...(args as T)));
}

function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    configPath: store.path,
    configDir: store.dir,
    dataDir,
    installed: isInstalled(),
    installDir: userInstallDir(),
    autostart: state.get().startElevated ? true : isAutostartEnabled(autostartEnv),
    elevated: false,
    startElevated: state.get().startElevated === true,
    docsUrl: DOCS_URL,
  };
}

function registerIpc() {
  handle('info', async () => {
    const info = appInfo();
    if (process.platform === 'win32') info.elevated = (await runScript('net session', { shell: 'cmd', timeout: 10 })).code === 0;
    return info;
  });
  handle('config:load', () => store.loaded ?? store.load());
  handle('config:save', (config: Config) => saveConfig(config));
  handle('config:saveRaw', (raw: string) => {
    const result = store.saveRaw(raw);
    if (result.ok && store.loaded) applyLoaded(store.loaded);
    return result;
  });
  handle('config:validate', (raw: unknown) => {
    const r = parseConfig(raw);
    return r.ok ? { ok: true } : { ok: false, issues: r.issues };
  });
  handle('config:setPath', (file: string) => {
    try {
      store.setPath(path.resolve(file));
      state.update({ configPath: store.path });
      if (store.loaded) applyLoaded(store.loaded);
      return { ok: store.loaded?.ok ?? false, issues: store.loaded && !store.loaded.ok ? store.loaded.issues : undefined };
    } catch (error) {
      return { ok: false, issues: [{ path: '', message: (error as Error).message }] };
    }
  });
  handle('config:backups', () => store.backups());
  handle('config:restore', (name: string) => {
    const result = store.restore(name);
    if (result.ok && store.loaded) applyLoaded(store.loaded);
    return result;
  });
  handle('status', () => engine.allStatus());
  handle('test', async (input: Action, check?: { on?: string; off?: string }): Promise<TestResult> => {
    const action = normalizeAction(input)!;
    const r = await engine.test(action, !!check);
    const log: ExecutionLog = {
      time: Date.now(),
      key: 'editor',
      label: 'Test from editor',
      kind: 'test',
      script: action.run,
      code: r.code,
      ok: r.code === 0,
      durationMs: r.durationMs,
      stdout: r.stdout,
      stderr: r.stderr,
      error: r.error,
    };
    logs.add(log);
    return { ...r, on: check ? evaluateState(r, check.on, check.off) : undefined };
  });
  handle('logs', () => logs.list());
  handle('running', () => runningProcesses().map(({ id, label, script, startedAt }) => ({ id, label, script, startedAt })));
  handle('kill', (id: number) => runningProcesses().find((p) => p.id === id)?.kill());
  handle('pickFile', async (o: { title?: string; filters?: { name: string; extensions: string[] }[]; defaultPath?: string; directory?: boolean }) => {
    const w = currentWindow();
    const options = { title: o.title, defaultPath: o.defaultPath ?? store.dir, filters: o.filters, properties: [o.directory ? ('openDirectory' as const) : ('openFile' as const)] };
    const r = w ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options);
    return r.canceled ? undefined : r.filePaths[0];
  });
  handle('relativeToConfig', (file: string) => {
    const rel = path.relative(store.dir, file);
    return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
  });
  handle('iconData', (file: string) => iconDataUrl(engine.resolvePath(file)));
  handle('openPath', (p: string) => void shell.openPath(p));
  handle('openExternal', (url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  handle('setAutostart', (on: boolean) => setAutostart(on));
  handle('setStartElevated', (on: boolean) => setStartElevated(on));
  handle('elevated:restart', async () => {
    const r = await runElevatedTask();
    if (r.code === 0) setTimeout(quit, 500);
    return r.code === 0;
  });
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install(quit));
  handle('install', () => {
    const r = installForUser((f, s) => writeShortcut(f, s));
    if (r.ok && r.executable) {
      setTimeout(() => {
        spawn(r.executable!, relaunchArgs().filter((a) => a !== '--hidden'), { detached: true, stdio: 'ignore' }).unref();
        quit();
      }, 300);
    }
    return r;
  });
  ipcMain.on('window', (_e, action: 'minimize' | 'maximize' | 'close') => {
    const w = currentWindow();
    if (!w) return;
    if (action === 'minimize') w.minimize();
    else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
    else w.close();
  });

  engine.onChange(() => {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => sendToWindow('status', engine.allStatus()), 50);
  });
  logs.onLog((l) => sendToWindow('log', l));
  onRunningChange(() => trays?.scheduleSync());
}
let statusTimer: NodeJS.Timeout | undefined;

/* ---------------- startup ---------------- */

app.on('second-instance', () => showWindow(state, '/', devUrl));
app.on('window-all-closed', () => {
  /* keep running in the tray */
});
if (process.platform === 'darwin') app.dock?.hide();

void app.whenReady().then(() => {
  registerIpc();
  trays = new TrayManager(engine, {
    openWindow: (route) => showWindow(state, route, devUrl),
    openConfigFile,
    reload: () => applyLoaded(store.load()),
    quit,
    setTrayHidden,
    isAutostart: () => (store.loaded?.ok ? store.loaded.config.settings.autostart : false),
    setAutostart,
    running: runningProcesses,
    update: () => (updater.state.state === 'available' && updater.state.latest ? { version: updater.state.latest } : undefined),
    installUpdate: () => void updater.install(quit),
    configError: () => configError,
  });

  // test hook: lets the end-to-end tests inspect tray menus and drive the engine
  if (process.env.TRAYCOMMAND_E2E === '1') (globalThis as Record<string, unknown>).__traycommand = { engine, trays, store };

  const loaded = store.load();
  applyLoaded(loaded);
  store.watch();
  trays.sync();

  // Opt-in elevated mode: the logon task replaces the Startup shortcut.
  if (state.get().startElevated && process.platform === 'win32') {
    try {
      disableAutostart(autostartEnv);
    } catch {
      /* ignore */
    }
  }

  const resultFile = path.join(dataDir, 'update-result.json');
  if (fs.existsSync(resultFile)) {
    try {
      const r = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^﻿/, '')) as { ok: boolean; version: string; message?: string };
      notify('TrayCommand', r.ok ? `Updated to version ${r.version}` : `Update to ${r.version} failed: ${r.message ?? 'unknown error'}`, r.ok ? 'info' : 'error');
    } catch {
      /* ignore */
    }
    fs.rmSync(resultFile, { force: true });
  }

  const firstRun = state.get().lastVersion === undefined;
  state.update({ lastVersion: app.getVersion() });
  const settings = loaded.ok ? loaded.config.settings : undefined;
  if (!flag('hidden') || firstRun) showWindow(state, app.isPackaged && !isInstalled() && process.platform !== 'darwin' ? '/welcome' : '/', devUrl);
  else if (settings?.notifyOnStartup) notify('TrayCommand', 'Running in the tray');
});

