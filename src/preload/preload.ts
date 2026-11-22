import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { LauncherApi, TrayCommandApi } from '../shared/api';

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
function subscribe<T>(channel: string) {
  return (handler: (value: T) => void) => {
    const listener = (_e: IpcRendererEvent, value: T) => handler(value);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const api: TrayCommandApi = {
  info: invoke('info') as TrayCommandApi['info'],
  loadConfig: invoke('config:load') as TrayCommandApi['loadConfig'],
  saveConfig: invoke('config:save') as TrayCommandApi['saveConfig'],
  saveRaw: invoke('config:saveRaw') as TrayCommandApi['saveRaw'],
  validate: invoke('config:validate') as TrayCommandApi['validate'],
  status: invoke('status') as TrayCommandApi['status'],
  onStatus: subscribe('status'),
  onConfigChanged: (handler) => subscribe<void>('config-changed')(() => handler()),
  test: invoke('test') as TrayCommandApi['test'],
  logs: invoke('logs') as TrayCommandApi['logs'],
  onLog: subscribe('log'),
  running: invoke('running') as TrayCommandApi['running'],
  kill: invoke('kill') as TrayCommandApi['kill'],
  pickFile: invoke('pickFile') as TrayCommandApi['pickFile'],
  relativeToConfig: invoke('relativeToConfig') as TrayCommandApi['relativeToConfig'],
  iconData: invoke('iconData') as TrayCommandApi['iconData'],
  openPath: invoke('openPath') as TrayCommandApi['openPath'],
  openExternal: invoke('openExternal') as TrayCommandApi['openExternal'],
  setConfigPath: invoke('config:setPath') as TrayCommandApi['setConfigPath'],
  setAutostart: invoke('setAutostart') as TrayCommandApi['setAutostart'],
  setStartElevated: invoke('setStartElevated') as TrayCommandApi['setStartElevated'],
  restartElevated: invoke('elevated:restart') as TrayCommandApi['restartElevated'],
  checkUpdate: invoke('update:check') as TrayCommandApi['checkUpdate'],
  installUpdate: invoke('update:install') as TrayCommandApi['installUpdate'],
  onUpdate: subscribe('update'),
  install: invoke('install') as TrayCommandApi['install'],
  restoreBackup: invoke('config:restore') as TrayCommandApi['restoreBackup'],
  backups: invoke('config:backups') as TrayCommandApi['backups'],
  onNavigate: subscribe('navigate'),
  skills: invoke('skills:status') as TrayCommandApi['skills'],
  installSkill: invoke('skills:install') as TrayCommandApi['installSkill'],
  uninstallSkill: invoke('skills:uninstall') as TrayCommandApi['uninstallSkill'],
  declineSkill: invoke('skills:decline') as TrayCommandApi['declineSkill'],
  onSkills: subscribe('skills'),
  windowControl: (action) => ipcRenderer.send('window', action),
  hotkeys: invoke('hotkeys') as TrayCommandApi['hotkeys'],
  onHotkeys: subscribe('hotkeys'),
  openLauncher: invoke('launcher:open') as TrayCommandApi['openLauncher'],
  resetLauncherPosition: invoke('launcher:resetPosition') as TrayCommandApi['resetLauncherPosition'],
  recordingHotkey: (on) => ipcRenderer.send('hotkeys:recording', on),
  schedulesPaused: invoke('schedules:paused') as TrayCommandApi['schedulesPaused'],
  setSchedulesPaused: invoke('schedules:setPaused') as TrayCommandApi['setSchedulesPaused'],
  exportPack: invoke('transfer:export') as TrayCommandApi['exportPack'],
  openImport: invoke('transfer:open') as TrayCommandApi['openImport'],
  importIcons: invoke('transfer:icons') as TrayCommandApi['importIcons'],
  pathForFile: (file) => webUtils.getPathForFile(file),
  setChrome: (colors, style) => ipcRenderer.send('chrome', colors, style),
  onChromeRequest: (handler) => subscribe<void>('chrome:request')(() => handler()),
  launcher: {
    onShow: subscribe('launcher:show'),
    onPrompt: subscribe('launcher:prompt'),
    onHide: (handler) => subscribe<void>('launcher:hide')(() => handler()),
    onBack: (handler) => subscribe<void>('launcher:back')(() => handler()),
    run: invoke('launcher:run') as LauncherApi['run'],
    submit: (id, values) => ipcRenderer.send('launcher:submit', id, values),
    cancel: (id, back) => ipcRenderer.send('launcher:cancel', id, back),
    options: invoke('launcher:options') as LauncherApi['options'],
    pick: invoke('launcher:pick') as LauncherApi['pick'],
    edit: (key) => ipcRenderer.send('launcher:edit', key),
    close: () => ipcRenderer.send('launcher:close'),
    resize: (height) => ipcRenderer.send('launcher:resize', height),
    style: invoke('style') as LauncherApi['style'],
    onStyle: subscribe('style'),
  },
};

contextBridge.exposeInMainWorld('traycommand', api);
