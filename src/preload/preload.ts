import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TrayCommandApi } from '../shared/api';

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
  windowControl: (action) => ipcRenderer.send('window', action),
};

contextBridge.exposeInMainWorld('traycommand', api);
