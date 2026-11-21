import type { Action, Config, ConfigIssue } from './config';

export interface EntryStatus {
  key: string;
  id?: string;
  /** undefined = not a toggle or not checked yet */
  on?: boolean;
  busy: boolean;
  enabled: boolean;
  lastCheck?: number;
  /** Next scheduled run (ms since epoch). */
  nextRun?: number;
  /** Folder watches of the schedules. */
  watches?: WatchStatus[];
}

export interface WatchStatus {
  /** Index in `schedules`. */
  index: number;
  /** Folder, resolved. */
  path: string;
  /** "watching" = runs on events; "waiting" = outside its time window or paused; "error" = the folder cannot be watched (retried). */
  state: 'watching' | 'waiting' | 'error';
  error?: string;
}

/** What started an action. */
export type RunSource = 'click' | 'hotkey' | 'launcher' | 'schedule' | 'watch' | 'alert' | 'test' | 'cli';

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
  source?: RunSource;
  /** Values typed for the inputs of the action (passwords masked). */
  inputs?: Record<string, string>;
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

/** One field of the form shown before an action runs. */
export interface PromptField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox' | 'file' | 'folder';
  value: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Options come from a script: ask them with launcher.options(). */
  dynamic?: boolean;
  optional?: boolean;
  pattern?: string;
}

export interface PromptRequest {
  id: number;
  title: string;
  /** Where the entry is, e.g. "Docker › Compose". */
  subtitle?: string;
  icon?: string;
  fields: PromptField[];
  submitLabel: string;
  /** An alert instead of a form: a message and buttons. The answer is { choice: "<index>" }. */
  alert?: PromptAlert;
}

export interface PromptAlert {
  text?: string;
  /** Labels of the buttons; empty = only an OK button. */
  choices: string[];
  /** Index of the choice run when the time is up. */
  defaultChoice?: number;
  /** When the alert closes by itself (ms since epoch). */
  deadline?: number;
}

/** What the engine asks to show for an alert. */
export interface AlertRequest {
  id: number;
  style: 'window' | 'notification';
  title: string;
  subtitle?: string;
  /** Icon file. */
  icon?: string;
  text?: string;
  choices: string[];
  defaultChoice?: number;
  deadline?: number;
}

/** An entry as listed in the launcher. */
export interface LauncherItem {
  key: string;
  id?: string;
  label: string;
  path: string;
  icon?: string;
  /** What Enter does: undefined = nothing to run (only a menu). */
  kind?: 'on' | 'off';
  toggle: boolean;
  on?: boolean;
  enabled: boolean;
  busy: boolean;
  hidden: boolean;
  hotkey?: string;
  hasInputs: boolean;
  /** Has a right click action (Shift+Enter). */
  alternate: boolean;
  /** Has a sub menu: Tab opens it. */
  group: boolean;
  /** Usage rank for "Recent" (higher = more recent / frequent). */
  recent?: number;
}

export interface LauncherShow {
  items: LauncherItem[];
  /** Key of the menu the launcher is limited to (shortcut of a tray with only a menu). */
  scope?: string;
  scopeLabel?: string;
  hotkey?: string;
  platform: string;
}

export interface HotkeyStatus {
  path: string;
  hotkey: string;
  label: string;
  ok: boolean;
  error?: string;
}

/** API of the launcher window. */
export interface LauncherApi {
  onShow(handler: (data: LauncherShow) => void): () => void;
  onPrompt(handler: (request: PromptRequest & { fromList: boolean }) => void): () => void;
  onHide(handler: () => void): () => void;
  /** The form was cancelled with Esc: back to the list it was opened from. */
  onBack(handler: () => void): () => void;
  run(key: string, alternate: boolean): Promise<{ ok: boolean; message?: string }>;
  submit(id: number, values: Record<string, string>): void;
  cancel(id: number, back: boolean): void;
  options(id: number, name: string): Promise<{ options?: string[]; error?: string }>;
  pick(type: 'file' | 'folder', current: string): Promise<string | undefined>;
  edit(key: string): void;
  close(): void;
  resize(height: number): void;
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

export interface AgentSkillInfo {
  id: 'claude' | 'opencode';
  label: string;
  present: boolean;
  state: 'missing' | 'current' | 'outdated' | 'modified';
  version?: string;
  dir: string;
}

export interface SkillsInfo {
  agents: AgentSkillInfo[];
  /** Agents to propose (install or update), not declined by the user. */
  offer: AgentSkillInfo['id'][];
  auto: boolean;
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
  skills(): Promise<SkillsInfo>;
  installSkill(ids: AgentSkillInfo['id'][]): Promise<SkillsInfo>;
  uninstallSkill(id: AgentSkillInfo['id']): Promise<SkillsInfo>;
  declineSkill(ids: AgentSkillInfo['id'][]): Promise<SkillsInfo>;
  onSkills(handler: (info: SkillsInfo) => void): () => void;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
  hotkeys(): Promise<HotkeyStatus[]>;
  onHotkeys(handler: (status: HotkeyStatus[]) => void): () => void;
  openLauncher(): Promise<void>;
  /** Pauses global shortcuts while the editor records a new one. */
  recordingHotkey(on: boolean): void;
  schedulesPaused(): Promise<boolean>;
  setSchedulesPaused(paused: boolean): Promise<boolean>;
  launcher: LauncherApi;
}

declare global {
  interface Window {
    traycommand: TrayCommandApi;
  }
}
