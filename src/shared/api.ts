import type { Action, Config, ConfigIssue } from './config';

export interface EntryStatus {
  key: string;
  id?: string;
  /** undefined = not a toggle or not checked yet */
  on?: boolean;
  busy: boolean;
  enabled: boolean;
  lastCheck?: number;
}

export interface ExecutionLog {
  time: number;
  key: string;
  label: string;
  kind: 'on' | 'off' | 'right' | 'test';
  script: string;
  code: number | null;
  ok: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface TestResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  /** For state checks: the evaluated state. */
  on?: boolean;
}

export interface RunningInfo {
  id: number;
  label: string;
  script: string;
  startedAt: number;
}

export interface AppInfo {
  version: string;
  platform: 'win32' | 'linux' | 'darwin' | string;
  configPath: string;
  configDir: string;
  dataDir: string;
  installed: boolean;
  installDir: string;
  autostart: boolean;
  elevated: boolean;
  startElevated: boolean;
  docsUrl: string;
}

export type LoadedConfig =
  | { ok: true; config: Config; raw: string; warnings: ConfigIssue[] }
  | { ok: false; raw: string; issues: ConfigIssue[] };

export interface UpdateInfo {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error';
  current: string;
  latest?: string;
  notes?: string;
  url?: string;
  progress?: number;
  error?: string;
}

export interface SaveResult {
  ok: boolean;
  issues?: ConfigIssue[];
}

/** API exposed by the preload script on window.traycommand */
export interface TrayCommandApi {
  info(): Promise<AppInfo>;
  loadConfig(): Promise<LoadedConfig>;
  saveConfig(config: Config): Promise<SaveResult>;
  saveRaw(raw: string): Promise<SaveResult>;
  validate(raw: unknown): Promise<SaveResult>;
  status(): Promise<EntryStatus[]>;
  onStatus(handler: (status: EntryStatus[]) => void): () => void;
  onConfigChanged(handler: () => void): () => void;
  test(action: Action, check?: { on?: string; off?: string }): Promise<TestResult>;
  logs(): Promise<ExecutionLog[]>;
  onLog(handler: (log: ExecutionLog) => void): () => void;
  running(): Promise<RunningInfo[]>;
  kill(id: number): Promise<void>;
  pickFile(options: { title?: string; filters?: { name: string; extensions: string[] }[]; defaultPath?: string; directory?: boolean }): Promise<string | undefined>;
  relativeToConfig(file: string): Promise<string>;
  iconData(path: string): Promise<string | undefined>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  setConfigPath(path: string): Promise<SaveResult>;
  setAutostart(on: boolean): Promise<boolean>;
  setStartElevated(on: boolean): Promise<{ ok: boolean; message?: string }>;
  restartElevated(): Promise<boolean>;
  checkUpdate(): Promise<UpdateInfo>;
  installUpdate(): Promise<void>;
  onUpdate(handler: (info: UpdateInfo) => void): () => void;
  install(): Promise<{ ok: boolean; message?: string }>;
  restoreBackup(name: string): Promise<SaveResult>;
  backups(): Promise<{ name: string; time: number }[]>;
  onNavigate(handler: (route: string) => void): () => void;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
}

declare global {
  interface Window {
    traycommand: TrayCommandApi;
  }
}
