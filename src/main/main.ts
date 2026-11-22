import { app, dialog, ipcMain, nativeImage, Notification, powerMonitor, shell, type IpcMainInvokeEvent } from 'electron';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSeparator, normalizeAction, parseConfig, SCHEMA_URL, STYLES, type Action, type Config, type MenuEntry, type MenuNode, type Style, type Tray } from '../shared/config';
import { expand } from '../shared/variables';
import type { AgentSkillInfo, AppInfo, ExecutionLog, ExportRequest, ExportResult, LauncherItem, LauncherShow, LoadedConfig, OpenImportResult, SaveResult, SkillsInfo, TestResult } from '../shared/api';
import { canonicalHotkey, formatHotkey } from '../shared/hotkey';
import { defaultShell } from './shell';
import { installSkill, planSkills, renderSkill, skillStatus, uninstallSkill, type SkillEnv } from './skills';
import { AppStateStore } from './appState';
import { defaultAutostartEnv, disableAutostart, isAutostartEnabled, startupFolder, syncAutostart, type LaunchTarget } from './autostart';
import { ConfigStore } from './configStore';
import { createAdminRunner, disableElevatedScript, enableElevatedScript, runElevatedOnce, runElevatedTask } from './elevation';
import { evaluateState, Engine, type ActionKind, type RuntimeEntry } from './engine';
import { HotkeyManager, type HotkeyBinding } from './hotkeys';
import { Alerts } from './alerts';
import { Launcher } from './launcher';
import { LauncherStore } from './launcherStore';
import { appIconFile, assetPath, iconDataUrl, setIconStyle, setMonochromeMenuBar } from './icons';
import { bundleIconOutdated, setBundleIcon } from './macIcon';
import { readImport, saveIcons, writeExport } from './transfer';
import { exportKind } from '../shared/transfer';
import { installForUser, isInstalled, startMenuShortcut } from './install';
import { LogStore } from './logStore';
import { APP_ID, APP_NAME, currentInstallRoot, DOCS_URL, machineInstallDir, samePath, userInstallDir } from './paths';
import { onRunningChange, runningProcesses, runScript } from './runner';
import { TrayManager } from './trays';
import { Updater } from './updater';
import { applyTheme, currentWindow, sendToWindow, setChrome, setWindowIcon, showWindow } from './window';

/* ---------------- arguments & paths ---------------- */

const argv = process.argv.slice(1);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const devUrl = flag('dev') ? (process.env.TRAYCOMMAND_DEV_URL ?? 'http://localhost:5173/') : undefined;
app.setName(APP_NAME);
if (option('data-dir')) app.setPath('userData', path.resolve(option('data-dir')!));
const dataDir = app.getPath('userData');

/*
 * Native notifications only from a real TrayCommand: packaged and not an isolated run (--data-dir,
 * used by the tests). On Windows, Electron registers a Start menu shortcut for the executable the
 * first time it shows a notification: from `electron .` or the tests, that is an "Electron" entry
 * pointing to the development folder. Those runs write their notifications to the console instead.
 */
const nativeNotifications = app.isPackaged && !option('data-dir');
if (process.platform === 'win32' && nativeNotifications) app.setAppUserModelId(APP_ID);

const state = new AppStateStore(path.join(dataDir, 'state.json'));
setMonochromeMenuBar(state.get().monochromeMenuBar === true);
const configPath = path.resolve(option('config') ?? process.env.TRAYCOMMAND_CONFIG ?? state.get().configPath ?? path.join(dataDir, 'traycommand.json'));

/* ---------------- command line tools (also used by the AI agent skill) ---------------- */

function cliExit(output: unknown, code: number): never {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  app.exit(code);
  process.exit(code);
}

if (flag('info')) {
  let settingsShell: unknown;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, '')) as { settings?: { shell?: unknown } };
    settingsShell = raw.settings?.shell;
  } catch {
    /* missing or invalid file: default shell */
  }
  cliExit(
    {
      version: app.getVersion(),
      configPath,
      configDir: path.dirname(configPath),
      configExists: fs.existsSync(configPath),
      dataDir,
      backupsDir: path.join(dataDir, 'backups'),
      platform: process.platform,
      defaultShell: settingsShell ?? defaultShell(),
      schema: SCHEMA_URL,
      docs: DOCS_URL,
    },
    0,
  );
}

const validateArg = argv.find((a) => a === '--validate' || a.startsWith('--validate='));
if (validateArg) {
  const file = path.resolve(validateArg.includes('=') ? validateArg.slice('--validate='.length) : configPath);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    cliExit({ ok: false, file, issues: [{ path: '', message: (error as Error).message }], warnings: [] }, 1);
  }
  const r = parseConfig(raw);
  if (!r.ok) cliExit({ ok: false, file, issues: r.issues, warnings: [] }, 1);
  // icons are resolved like at run time: variables, then relative to the file folder
  const ctx = { variables: r.config.variables, env: process.env, configDir: path.dirname(file) };
  const warnings = [...r.warnings];
  const visit = (node: MenuNode | Tray, at: string) => {
    if (isSeparator(node as MenuNode)) return;
    const entry = node as MenuEntry;
    for (const [key, value] of [['icon', entry.icon], ['state.iconOff', entry.state?.iconOff]] as const) {
      if (value && !fs.existsSync(path.resolve(path.dirname(file), expand(value, ctx)))) warnings.push({ path: `${at}.${key}`, message: `Icon file not found: ${value}` });
    }
    entry.menu?.forEach((child, i) => visit(child, `${at}.menu[${i}]`));
  };
  r.config.trays.forEach((t, i) => visit(t, `trays[${i}]`));
  cliExit({ ok: true, file, issues: [], warnings }, 0);
}

// end-to-end tests: windows covered by others (the launcher is always on top) keep painting, so screenshots never wait for a frame
if (process.env.TRAYCOMMAND_E2E === '1') {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const logs = new LogStore(path.join(dataDir, 'logs'));
const launcherStore = new LauncherStore(path.join(dataDir, 'launcher.json'));

/* ---------------- notifications & dialogs ---------------- */

function canNotify(title: string, body: string): boolean {
  if (nativeNotifications) return Notification.isSupported();
  console.log(`[notification] ${title}: ${body}`);
  return false;
}

function notify(title: string, body: string, kind: 'info' | 'warning' | 'error' = 'info', route?: string) {
  if (!canNotify(title, body)) return;
  const n = new Notification({ title, body, silent: kind === 'info', urgency: kind === 'error' ? 'critical' : 'normal' });
  n.on('click', () => {
    if (route ?? kind === 'error') showWindow(state, route ?? '/logs', devUrl);
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

const engine: Engine = new Engine({
  run: runScript,
  runAdmin: createAdminRunner(),
  notify,
  confirm,
  log: (entry) => logs.add(entry),
  prompt: (request): Promise<Record<string, string> | undefined> => launcher.prompt(request),
  memory: launcherStore,
  alert: (request) => alerts.show(request),
  closeAlert: (id) => alerts.close(id),
  answeringAlert: (id) => alerts.isAnswering(id),
});
// alerts of schedules: a window over the others (in the launcher), or a notification whose click shows it
const alerts: Alerts = new Alerts({
  window: (request) => launcher.prompt(request),
  dismissWindow: (id) => launcher.dismiss(id),
  notification: ({ title, body, onClick }) => {
    if (!canNotify(title, body)) {
      // development and test runs: a stand-in that is never shown (its click can be simulated)
      if (nativeNotifications) return undefined;
      const stub = new EventEmitter() as EventEmitter & { close(): void };
      stub.close = () => undefined;
      stub.on('click', onClick);
      return stub;
    }
    const n = new Notification({ title, body, urgency: 'normal' });
    n.on('click', onClick);
    n.show();
    return n; // kept by Alerts until answered, so that the click is not lost
  },
  icon: (file) => iconUrl(file),
});
engine.setSchedulesPaused(state.get().schedulesPaused === true);

/* ---------------- launcher & global shortcuts ---------------- */

const iconUrls = new Map<string, string | undefined>();
function iconUrl(file: string | undefined) {
  if (!file) return undefined;
  if (!iconUrls.has(file)) iconUrls.set(file, iconDataUrl(file));
  return iconUrls.get(file);
}

const usageKey = (e: RuntimeEntry) => e.entry.id ?? e.key;

/** Why an entry cannot run right now (busy, or enabledWhen not satisfied). */
function unavailable(e: RuntimeEntry): string {
  if (e.busy) return 'Still running, try again when it finishes';
  if (engine.isDisabled(e)) return 'Disabled';
  const cond = e.entry.enabledWhen;
  if (cond) {
    const target = engine.get(cond.replace(/^!/, ''));
    return `Available only while ${target ? engine.label(target) : cond} is ${cond.startsWith('!') ? 'OFF' : 'ON'}`;
  }
  return 'Not available right now';
}

function launcherItems(): LauncherItem[] {
  const items: LauncherItem[] = [];
  for (const e of engine.all) {
    if (engine.isDisabled(e)) continue;
    const kind = engine.clickKind(e);
    const group = e.children.some((c) => c !== 'separator');
    if (!kind && !e.entry.rightAction && !group) continue;
    items.push({
      key: e.key,
      id: e.entry.id,
      label: engine.label(e),
      path: engine.pathLabel(e),
      icon: iconUrl(engine.iconFor(e)),
      kind: kind === 'right' ? undefined : kind,
      toggle: !!e.entry.state,
      on: e.entry.state ? e.on : undefined,
      enabled: engine.isEnabled(e),
      busy: e.busy,
      hidden: !engine.isActive(e),
      hotkey: e.entry.hotkey ? canonicalHotkey(e.entry.hotkey) : undefined,
      hasInputs: kind ? engine.needsInput(e, kind) : false,
      alternate: !!e.entry.rightAction,
      group,
      recent: launcherStore.rank(usageKey(e)),
    });
  }
  return items;
}

const launcher: Launcher = new Launcher(
  {
    show: (scope): LauncherShow => {
      const s = scope ? engine.get(scope) : undefined;
      const hk = store.loaded?.ok ? store.loaded.config.settings.launcherHotkey : undefined;
      return { items: launcherItems(), scope: s?.key, scopeLabel: s ? engine.label(s) : undefined, hotkey: hk ? canonicalHotkey(hk) : undefined, platform: process.platform };
    },
    run: (key, alternate) => {
      const e = engine.get(key);
      if (!e) return { ok: false, message: 'This entry no longer exists' };
      const kind: ActionKind | undefined = alternate ? (e.entry.rightAction ? 'right' : undefined) : engine.clickKind(e);
      if (!kind) return { ok: false, message: alternate ? 'No right click action' : 'Nothing to run' };
      if (!engine.isEnabled(e)) return { ok: false, message: unavailable(e) };
      launcherStore.bump(usageKey(e));
      const keepOpen = engine.needsInput(e, kind);
      void engine.trigger(e, kind, { source: 'launcher' });
      return { ok: true, keepOpen };
    },
    options: (id, name) => engine.inputOptions(id, name),
    edit: (key) => showWindow(state, `/entry/${key}`, devUrl),
    position: () => launcherStore.position,
    setPosition: (p) => launcherStore.setPosition(p),
  },
  devUrl,
);

const hotkeys = new HotkeyManager();
const reportedHotkeys = new Set<string>();

function hotkeyFired(key: string) {
  const e = engine.get(key);
  if (!e) return;
  const kind = engine.clickKind(e);
  if (!kind) {
    // a tray or sub menu without an action: open the launcher on its menu
    if (e.children.length && !engine.isDisabled(e)) void launcher.open(e.key);
    return;
  }
  if (!engine.isEnabled(e)) {
    notify(engine.label(e), unavailable(e), 'warning');
    return;
  }
  void (async () => {
    if (!(await engine.confirmHotkey(e, kind))) return;
    launcherStore.bump(usageKey(e));
    await engine.trigger(e, kind, { source: 'hotkey' });
  })();
}

function applyHotkeys(config: Config) {
  const bindings: HotkeyBinding[] = [];
  if (config.settings.launcherHotkey) bindings.push({ path: 'settings.launcherHotkey', hotkey: config.settings.launcherHotkey, label: 'Launcher', handler: () => void launcher.toggle() });
  for (const e of engine.all) {
    if (e.entry.hotkey) bindings.push({ path: e.key, hotkey: e.entry.hotkey, label: engine.label(e), handler: () => hotkeyFired(e.key) });
  }
  hotkeys.apply(bindings);
  for (const f of hotkeys.failures()) {
    const id = `${f.hotkey}|${f.error}`;
    if (reportedHotkeys.has(id)) continue;
    reportedHotkeys.add(id);
    notify('TrayCommand', `Shortcut ${formatHotkey(f.hotkey, process.platform)} (${f.label}) does not work: ${f.error}`, 'warning', f.path === 'settings.launcherHotkey' ? '/settings' : '/');
  }
}

function setSchedulesPaused(paused: boolean) {
  engine.setSchedulesPaused(paused);
  state.update({ schedulesPaused: paused || undefined });
  trays?.scheduleSync();
  return paused;
}

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
  iconUrls.clear();
  engine.load(loaded.config, store.dir);
  engine.start();
  if (app.isReady()) applyHotkeys(loaded.config);
  applyTheme(loaded.config.settings.theme);
  applyStyle(loaded.config.settings.style);
  applySettings(loaded.config);
  if (skillsStarted && skillsAutomatic && loaded.config.settings.skillUpdates === 'auto') {
    // switched to automatic updates: bring outdated skills up to date now
    try {
      const outdated = skillsInfo().agents.filter((a) => a.state === 'outdated').map((a) => a.id);
      if (outdated.length) installSkills(outdated);
    } catch {
      /* reported by skillsInfo */
    }
  }
  if (skillsStarted) skillsChanged();
  sendToWindow('config-changed');
}
let skillsStarted = false;

const store = new ConfigStore(configPath, path.join(dataDir, 'backups'), (loaded) => applyLoaded(loaded));

let trays: TrayManager | undefined;

/* ---------------- autostart / install ---------------- */

const writeShortcut = (file: string, spec: Electron.ShortcutDetails) =>
  shell.writeShortcutLink(file, 'replace', spec) || shell.writeShortcutLink(file, 'create', spec);
const autostartEnv = {
  ...defaultAutostartEnv((file, spec) => writeShortcut(file, spec)),
  // macOS: TrayCommand.app itself in "Open at Login", with its name and icon
  ...(process.platform === 'darwin'
    ? {
        loginItem: {
          set: (open: boolean) => {
            try {
              app.setLoginItemSettings({ openAtLogin: open });
              const s = app.getLoginItemSettings();
              return open ? s.openAtLogin || s.status === 'enabled' || s.status === 'requires-approval' : !s.openAtLogin;
            } catch {
              return false;
            }
          },
          get: () => {
            try {
              return app.getLoginItemSettings().openAtLogin;
            } catch {
              return false;
            }
          },
        },
      }
    : {}),
};

function relaunchArgs(): string[] {
  const args = ['--hidden'];
  if (option('config')) args.push(`--config=${configPath}`);
  if (option('data-dir')) args.push(`--data-dir=${dataDir}`);
  return args;
}

function launchTarget(): LaunchTarget {
  if (process.platform === 'linux' && process.env.APPIMAGE) return { command: process.env.APPIMAGE, args: relaunchArgs(), cwd: os.homedir() };
  return { command: process.execPath, args: relaunchArgs(), cwd: path.dirname(process.execPath) };
}

/** The look: icons of the app and of the TrayCommand tray, the launcher, the editor window. */
function applyStyle(style: Style) {
  savedStyle = style;
  setIconStyle(style);
  launcher.setStyle(style);
  setWindowIcon(style);
  trays?.scheduleSync();
  updateShortcutIcon(style);
}

/** The Start menu shortcut (Windows) or the app in Finder (macOS) of an installed TrayCommand shows the icon of the look in use. */
function updateShortcutIcon(style: Style) {
  if (!app.isPackaged || option('data-dir')) return;
  if (process.platform === 'darwin') return void updateBundleIcon(style);
  if (process.platform !== 'win32') return;
  const lnk = startMenuShortcut();
  const icon = assetPath(`icon-${style}.ico`);
  try {
    if (!fs.existsSync(lnk) || !fs.existsSync(icon)) return;
    const current = shell.readShortcutLink(lnk);
    if (current.icon === icon) return;
    shell.writeShortcutLink(lnk, 'update', { ...current, icon, iconIndex: 0 });
  } catch {
    /* a shortcut that cannot be read or written keeps its icon */
  }
}
let savedStyle: Style = 'aurora';

/** macOS: one change at a time; the last look asked wins. */
let bundleIconBusy = false;
let bundleIconWanted: Style | undefined;
async function updateBundleIcon(style: Style) {
  bundleIconWanted = style;
  if (bundleIconBusy) return;
  bundleIconBusy = true;
  try {
    while (bundleIconWanted) {
      const wanted = bundleIconWanted;
      bundleIconWanted = undefined;
      const bundle = currentInstallRoot();
      const image = appIconFile(wanted);
      if (!bundle.endsWith('.app') || !bundleIconOutdated(bundle, wanted, state.get().bundleIcon)) continue;
      if (await setBundleIcon(bundle, image)) state.update({ bundleIcon: wanted });
    }
  } finally {
    bundleIconBusy = false;
  }
}

function applySettings(config: Config) {
  // Autostart points to the running executable; only for packaged builds (never to the dev electron.exe)
  // and never for isolated runs with --data-dir (tests), so they cannot touch the real Startup folder.
  if (app.isPackaged && !option('data-dir') && !state.get().startElevated) {
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

/* ---------------- AI agent skill (Claude Code, opencode) ---------------- */

// Tests point the agents' home elsewhere; isolated runs (--data-dir) never act on their own.
const agentsHome = process.env.TRAYCOMMAND_AGENTS_HOME ?? os.homedir();
const skillsAutomatic = !!process.env.TRAYCOMMAND_AGENTS_HOME || !option('data-dir');
let skillsError: string | undefined;

function skillSource(): string {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'skill', 'traycommand') : '';
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', 'skill', 'traycommand');
}

/** Command line that starts this TrayCommand (packaged executable, AppImage, or electron + app folder in dev). */
function cliParts(): string[] {
  if (process.platform === 'linux' && process.env.APPIMAGE) return [process.env.APPIMAGE];
  return app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
}

function skillEnv(): SkillEnv {
  const parts = cliParts();
  const slash = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);
  return {
    home: agentsHome,
    env: process.env,
    platform: process.platform,
    source: skillSource(),
    version: app.getVersion(),
    values: {
      TRAYCOMMAND_SH: parts.map((p) => `"${slash(p)}"`).join(' '),
      TRAYCOMMAND_PS: `& ${parts.map((p) => `'${p.replace(/'/g, "''")}'`).join(' ')}`,
    },
  };
}

function skillsAuto(): boolean {
  return store.loaded?.ok ? store.loaded.config.settings.skillUpdates === 'auto' : true;
}

function skillsInfo(): SkillsInfo {
  try {
    const agents = skillStatus(skillEnv());
    const plan = planSkills(agents, { auto: false, declined: state.get().skills?.declined ?? [] });
    // with automatic updates, plain "outdated" skills are handled without asking
    const offer = plan.offer.filter((id) => !(skillsAuto() && agents.find((a) => a.id === id)?.state === 'outdated'));
    return { agents, offer, auto: skillsAuto(), error: skillsError };
  } catch (error) {
    return { agents: [], offer: [], auto: skillsAuto(), error: (error as Error).message };
  }
}

function skillsChanged() {
  sendToWindow('skills', skillsInfo());
}

function setDeclined(ids: string[], declined: boolean) {
  const current = new Set(state.get().skills?.declined ?? []);
  for (const id of ids) {
    if (declined) current.add(id);
    else current.delete(id);
  }
  state.update({ skills: { ...state.get().skills, declined: [...current] } });
}

function installSkills(ids: AgentSkillInfo['id'][]): SkillsInfo {
  skillsError = undefined;
  const failed: string[] = [];
  try {
    const e = skillEnv();
    const rendered = renderSkill(e.source, e.values);
    // one agent failing does not stop the others
    for (const id of ids) {
      try {
        installSkill(e, id, rendered);
        setDeclined([id], false);
      } catch (error) {
        failed.push(`${id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    failed.push((error as Error).message);
  }
  if (failed.length) skillsError = `Cannot install the skill (${failed.join('; ')})`;
  const info = skillsInfo();
  skillsChanged();
  return info;
}

/** At startup: silent update of outdated skills (when automatic), then a notification for what needs the user. */
function startupSkills(windowShown: boolean) {
  if (!skillsAutomatic) return;
  try {
    const e = skillEnv();
    const rendered = renderSkill(e.source, e.values);
    const status = skillStatus(e, rendered);
    const plan = planSkills(status, { auto: skillsAuto(), declined: state.get().skills?.declined ?? [] });
    for (const id of plan.autoUpdate) installSkill(e, id, rendered);
    // only when the skill really changed: the rendering carries no version number, so a new
    // release with the same skill leaves the installed one current and says nothing
    if (plan.autoUpdate.length) notify('TrayCommand', 'The TrayCommand skill for AI assistants has been updated');
    const offer = skillsInfo().offer;
    if (offer.length && !windowShown && state.get().skills?.notifiedVersion !== app.getVersion()) {
      state.update({ skills: { ...state.get().skills, notifiedVersion: app.getVersion() } });
      notify('TrayCommand', 'An AI assistant was found on this PC: install the TrayCommand skill to create and change trays by asking it. Click to set it up.', 'info', '/settings');
    }
  } catch (error) {
    skillsError = `Cannot update the skill: ${(error as Error).message}`;
  }
  skillsChanged();
}

function quit() {
  hotkeys.dispose();
  launcher.destroy();
  launcherStore.flush();
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
    style: savedStyle,
  };
}

/* ---------------- export & import ---------------- */

/** The file opened for import (its icons are copied only when the import is confirmed). */
let pendingImport: { token: number; icons: Map<string, Buffer> } | undefined;
let importTokens = 0;

function imagePreview(file: string, data: Buffer): string | undefined {
  if (file.toLowerCase().endsWith('.svg')) return `data:image/svg+xml;base64,${data.toString('base64')}`;
  const image = nativeImage.createFromBuffer(data);
  return image.isEmpty() ? undefined : image.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
}

async function exportPack(req: ExportRequest): Promise<ExportResult> {
  const kind = exportKind(req.pack, req.icons.length);
  const safe = req.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'TrayCommand';
  const options = {
    title: 'Export',
    defaultPath: path.join(app.getPath('documents'), `${safe}.${kind}`),
    filters: [kind === 'zip' ? { name: 'TrayCommand export (zip)', extensions: ['zip'] } : { name: 'TrayCommand export (JSON)', extensions: ['json'] }],
  };
  const w = currentWindow();
  const r = w ? await dialog.showSaveDialog(w, options) : await dialog.showSaveDialog(options);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    const ctx = { variables: req.variables, env: process.env, configDir: store.dir };
    const resolve = (raw: string) => {
      const expanded = expand(raw, ctx);
      return path.isAbsolute(expanded) ? expanded : path.resolve(store.dir, expanded);
    };
    const { missing } = writeExport(r.filePath, kind, req.pack, req.icons, resolve);
    return { ok: true, file: r.filePath, kind, missing };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

async function openImport(given?: string): Promise<OpenImportResult> {
  let file = given;
  if (!file) {
    const options = { title: 'Import', defaultPath: app.getPath('documents'), filters: [{ name: 'TrayCommand export or configuration', extensions: ['zip', 'json'] }], properties: ['openFile' as const] };
    const w = currentWindow();
    const r = w ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options);
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    file = r.filePaths[0];
  }
  const r = readImport(file);
  if (!r.ok) return r;
  const token = ++importTokens;
  pendingImport = { token, icons: r.icons };
  const icons = Object.fromEntries([...r.icons].map(([raw, data]) => [raw, imagePreview(raw, data)]));
  return { ok: true, token, file, name: path.basename(file), kind: r.kind, pack: r.pack, icons, missing: r.missing };
}

function registerIpc() {
  // the editor shows a look (also one being chosen, not saved yet): title bar colours and window icon follow it
  ipcMain.on('chrome', (e, colors: { bg: string; fg: string }, style: string) => {
    const w = currentWindow();
    if (!w || e.sender !== w.webContents || !colors || typeof colors.bg !== 'string' || typeof colors.fg !== 'string') return;
    setChrome(colors);
    if ((STYLES as readonly string[]).includes(style)) setWindowIcon(style);
  });
  handle('transfer:export', (req: ExportRequest) => exportPack(req));
  handle('transfer:open', (file?: string) => openImport(file));
  handle('transfer:icons', (token: number, raws: string[]) => {
    if (pendingImport?.token !== token) return {};
    const out = saveIcons(store.dir, pendingImport.icons, raws);
    iconUrls.clear();
    return out;
  });
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
    app.releaseSingleInstanceLock();
    const r = await runElevatedTask();
    if (r.code !== 0) app.requestSingleInstanceLock();
    if (r.code === 0) setTimeout(quit, 500);
    return r.code === 0;
  });
  handle('skills:status', () => skillsInfo());
  handle('skills:install', (ids: AgentSkillInfo['id'][]) => installSkills(ids));
  handle('skills:uninstall', (id: AgentSkillInfo['id']) => {
    skillsError = undefined;
    try {
      uninstallSkill({ home: agentsHome }, id);
      setDeclined([id], true);
    } catch (error) {
      skillsError = `Cannot remove the skill: ${(error as Error).message}`;
    }
    skillsChanged();
    return skillsInfo();
  });
  handle('skills:decline', (ids: AgentSkillInfo['id'][]) => {
    setDeclined(ids, true);
    skillsChanged();
    return skillsInfo();
  });
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install(quit));
  handle('install', () => {
    const r = installForUser((f, s) => writeShortcut(f, s));
    if (r.ok && r.executable) {
      setTimeout(() => {
        // let the installed copy take the single-instance lock
        app.releaseSingleInstanceLock();
        spawn(r.executable!, relaunchArgs().filter((a) => a !== '--hidden'), { detached: true, stdio: 'ignore' }).unref();
        quit();
      }, 300);
    }
    return r;
  });
  handle('hotkeys', () => hotkeys.status());
  handle('launcher:open', () => launcher.open());
  handle('launcher:resetPosition', () => launcher.resetPosition());
  ipcMain.on('hotkeys:recording', (_e, on: boolean) => hotkeys.suspend(!!on));
  handle('schedules:paused', () => engine.schedulesPaused);
  handle('schedules:setPaused', (paused: boolean) => setSchedulesPaused(!!paused));
  hotkeys.onChange((s) => sendToWindow('hotkeys', s));
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

function loginItemOpened(): boolean {
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  } catch {
    return false;
  }
}

/** --launcher opens the launcher, --run=<id> runs an entry (for other tools, or where global shortcuts do not work). */
function handleArgs(args: string[]): boolean {
  if (args.includes('--launcher')) {
    void launcher.open();
    return true;
  }
  const run = args.find((a) => a.startsWith('--run='))?.slice(6);
  if (run) {
    const e = engine.get(run);
    if (!e) notify('TrayCommand', `No entry with id "${run}"`, 'error');
    else {
      const kind = engine.clickKind(e);
      if (kind) void engine.trigger(e, kind, { source: 'cli' });
      else if (e.children.length) void launcher.open(e.key);
    }
    return true;
  }
  return false;
}

app.on('second-instance', (_e, args) => {
  if (!handleArgs(args)) showWindow(state, '/', devUrl);
});
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
    openLauncher: () => void launcher.open(),
    launcherHotkey: () => (store.loaded?.ok ? store.loaded.config.settings.launcherHotkey : undefined),
    hasSchedules: () => engine.all.some((e) => e.entry.schedules?.some((s) => !s.disabled)),
    schedulesPaused: () => engine.schedulesPaused,
    setSchedulesPaused: (paused) => void setSchedulesPaused(paused),
    monochromeMenuBar: () => state.get().monochromeMenuBar === true,
    setMonochromeMenuBar: (on) => {
      state.update({ monochromeMenuBar: on });
      setMonochromeMenuBar(on);
      trays?.scheduleSync();
    },
  });

  // test hook: lets the end-to-end tests inspect tray menus and drive the engine
  if (process.env.TRAYCOMMAND_E2E === '1') (globalThis as Record<string, unknown>).__traycommand = { engine, trays, store, launcher, launcherStore, hotkeys, hotkeyFired, alerts };

  const loaded = store.load();
  applyLoaded(loaded);
  store.watch();
  trays.sync();
  powerMonitor.on('resume', () => engine.rearmSchedules());
  powerMonitor.on('unlock-screen', () => engine.rearmSchedules());

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
    // the runner may still be closing: clean the downloaded files a bit later
    setTimeout(() => {
      try {
        fs.rmSync(path.join(dataDir, 'update'), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
      } catch {
        /* removed at the next update */
      }
    }, 15000).unref();
  }

  // Installed for this user but the Start menu shortcut is gone: put it back.
  if (process.platform === 'win32' && app.isPackaged && !option('data-dir') && samePath(currentInstallRoot(), userInstallDir()) && !fs.existsSync(startMenuShortcut())) {
    writeShortcut(startMenuShortcut(), { target: process.execPath, args: '', cwd: path.dirname(process.execPath), description: 'Run commands from the tray', icon: process.execPath, appUserModelId: APP_ID });
  }

  const firstRun = state.get().lastVersion === undefined;
  state.update({ lastVersion: app.getVersion() });
  const settings = loaded.ok ? loaded.config.settings : undefined;
  // started at login: hidden (the macOS login item cannot pass --hidden, the system tells instead)
  const atLogin = flag('hidden') || (process.platform === 'darwin' && app.isPackaged && loginItemOpened());
  const showNow = !atLogin || firstRun;
  const fromArgs = handleArgs(argv);
  if (showNow && !(fromArgs && !firstRun)) showWindow(state, app.isPackaged && !isInstalled() && process.platform !== 'darwin' ? '/welcome' : '/', devUrl);
  else if (settings?.notifyOnStartup) notify('TrayCommand', 'Running in the tray');
  startupSkills(showNow);
  skillsStarted = true;
  // the launcher is loaded in the background right after start-up (the editor window comes first),
  // so that its shortcut only has to show it
  setTimeout(() => launcher.create(), 300);
});

