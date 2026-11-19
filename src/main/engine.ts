import {
  type Action,
  type ActionInput,
  type Config,
  type MenuEntry,
  type MenuNode,
  type Shell,
  type Tray,
  isSeparator,
  normalizeAction,
} from '../shared/config';
import { expand, type VariableContext } from '../shared/variables';
import type { EntryStatus, ExecutionLog } from '../shared/api';
import { isSuccess, type RunOptions, type RunResult, type Runner } from './runner';
import { defaultShell } from './shell';
import path from 'node:path';

export type ActionKind = 'on' | 'off' | 'right';

export interface EngineDeps {
  run: Runner;
  runAdmin: Runner;
  notify: (title: string, body: string, kind: 'info' | 'warning' | 'error') => void;
  confirm: (title: string, text: string) => Promise<boolean>;
  log: (entry: ExecutionLog) => void;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Delay before re-checking the state after an action (ms). */
  recheckDelay?: number;
}

export interface RuntimeEntry {
  key: string;
  entry: MenuEntry & { rightAction?: ActionInput };
  isTray: boolean;
  parent?: RuntimeEntry;
  children: (RuntimeEntry | 'separator')[];
  on?: boolean;
  busy: boolean;
  checking: boolean;
  inflight?: Promise<void>;
  timer?: NodeJS.Timeout;
  lastCheck?: number;
}

const DEFAULT_TEXT = {
  ok: 'Done',
  stateOn: 'Now ON',
  stateOff: 'Now OFF',
  failed: 'Failed',
  busy: 'Still running, try again when it finishes',
  noAdmin: 'Admin commands are disabled. Enable them in Settings → Advanced.',
};

export class Engine {
  private config?: Config;
  private configDir = '';
  private entries = new Map<string, RuntimeEntry>();
  private byId = new Map<string, RuntimeEntry>();
  private roots: RuntimeEntry[] = [];
  private listeners = new Set<(key?: string) => void>();
  private stopped = true;
  private generation = 0;

  constructor(private readonly deps: EngineDeps) {}

  /* ---------- lifecycle ---------- */

  load(config: Config, configDir: string) {
    this.stop();
    this.config = config;
    this.configDir = configDir;
    this.entries.clear();
    this.byId.clear();
    this.roots = config.trays.map((tray, i) => this.build(tray, `trays[${i}]`, true));
    this.emit();
  }

  start() {
    this.stopped = false;
    const generation = ++this.generation;
    for (const entry of this.entries.values()) {
      if (entry.entry.state) this.scheduleCheck(entry, 0, generation);
    }
  }

  stop() {
    this.stopped = true;
    this.generation++;
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  onChange(listener: (key?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(key?: string) {
    for (const listener of this.listeners) listener(key);
  }

  private build(node: Tray | MenuEntry, key: string, isTray: boolean, parent?: RuntimeEntry): RuntimeEntry {
    const runtime: RuntimeEntry = { key, entry: node, isTray, parent, children: [], busy: false, checking: false };
    this.entries.set(key, runtime);
    if (node.id) this.byId.set(node.id, runtime);
    runtime.children = (node.menu ?? []).map((child: MenuNode, i) =>
      isSeparator(child) ? 'separator' : this.build(child, `${key}.menu[${i}]`, false, runtime),
    );
    return runtime;
  }

  /* ---------- queries ---------- */

  get trays(): RuntimeEntry[] {
    return this.roots;
  }

  get settings() {
    return this.config?.settings;
  }

  get(key: string): RuntimeEntry | undefined {
    return this.entries.get(key) ?? this.byId.get(key);
  }

  /** Hidden or disabled itself or through an ancestor. */
  isActive(entry: RuntimeEntry): boolean {
    for (let e: RuntimeEntry | undefined = entry; e; e = e.parent) {
      if (e.entry.hidden || e.entry.disabled) return false;
    }
    return true;
  }

  isEnabled(entry: RuntimeEntry): boolean {
    if (entry.entry.disabled || entry.busy) return false;
    const cond = entry.entry.enabledWhen;
    if (cond) {
      const negate = cond.startsWith('!');
      const target = this.byId.get(negate ? cond.slice(1) : cond);
      const on = target?.on === true;
      if (negate ? on : !on) return false;
    }
    return true;
  }

  status(entry: RuntimeEntry): EntryStatus {
    return {
      key: entry.key,
      id: entry.entry.id,
      on: entry.entry.state ? entry.on : undefined,
      busy: entry.busy,
      enabled: this.isEnabled(entry),
      lastCheck: entry.lastCheck,
    };
  }

  allStatus(): EntryStatus[] {
    return [...this.entries.values()].map((e) => this.status(e));
  }

  /** Icon path (already resolved) according to the state. */
  iconFor(entry: RuntimeEntry): string | undefined {
    const raw = entry.entry.state && entry.on === false && entry.entry.state.iconOff ? entry.entry.state.iconOff : entry.entry.icon;
    return raw ? this.resolvePath(raw) : undefined;
  }

  label(entry: RuntimeEntry): string {
    return this.expandText(entry.entry.label);
  }

  /* ---------- helpers ---------- */

  private get ctx(): VariableContext {
    return { variables: this.config?.variables ?? {}, env: this.deps.env ?? process.env, configDir: this.configDir };
  }

  expandText(text: string): string {
    return expand(text, this.ctx);
  }

  resolvePath(p: string): string {
    const expanded = this.expandText(p);
    return path.isAbsolute(expanded) ? expanded : path.resolve(this.configDir, expanded);
  }

  private shellFor(entry: RuntimeEntry, own?: Shell): Shell {
    return own ?? this.config?.settings.shell ?? defaultShell(this.deps.platform);
  }

  private actionOf(entry: RuntimeEntry, kind: ActionKind): Action | undefined {
    const e = entry.entry;
    return normalizeAction(kind === 'on' ? e.action : kind === 'off' ? e.offAction : e.rightAction);
  }

  /* ---------- clicks ---------- */

  /** Which action a left click runs; undefined means "open the menu". */
  clickKind(entry: RuntimeEntry): ActionKind | undefined {
    if (entry.entry.state && entry.on === true && entry.entry.offAction) return 'off';
    return entry.entry.action ? 'on' : undefined;
  }

  async click(key: string): Promise<boolean> {
    const entry = this.get(key);
    if (!entry) return false;
    const kind = this.clickKind(entry);
    if (!kind) return false;
    await this.trigger(entry, kind);
    return true;
  }

  async rightClick(key: string): Promise<boolean> {
    const entry = this.get(key);
    if (!entry?.entry.rightAction) return false;
    await this.trigger(entry, 'right');
    return true;
  }

  /** User-initiated action: respects disabled/busy state. */
  async trigger(entry: RuntimeEntry, kind: ActionKind) {
    if (!this.isEnabled(entry)) {
      if (entry.busy) this.deps.notify(this.label(entry), DEFAULT_TEXT.busy, 'warning');
      return;
    }
    await this.execute(entry, kind, new Set());
  }

  /* ---------- execution ---------- */

  private refTargets(ref: string, kind: ActionKind): { entry: RuntimeEntry; kind: ActionKind } | undefined {
    const [id, forced] = ref.split(':') as [string, ActionKind | undefined];
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return { entry, kind: forced ?? (kind === 'right' ? 'on' : kind) };
  }

  private async execute(entry: RuntimeEntry, kind: ActionKind, visited: Set<string>): Promise<RunResult | undefined> {
    const visitKey = `${entry.key}:${kind}`;
    if (visited.has(visitKey)) return undefined;
    visited.add(visitKey);

    const action = this.actionOf(entry, kind);
    if (!action) return undefined;

    if (action.confirm) {
      const ok = await this.deps.confirm(this.label(entry), this.expandText(action.confirm));
      if (!ok) return undefined;
    }

    const runRefs = async (refs: string[] | undefined, parallel: boolean) => {
      const targets = (refs ?? []).map((r) => this.refTargets(r, kind)).filter((t) => t !== undefined);
      if (parallel) await Promise.all(targets.map((t) => this.execute(t.entry, t.kind, visited)));
      else for (const t of targets) await this.execute(t.entry, t.kind, visited);
    };

    await runRefs(action.before, false);
    const [result] = await Promise.all([this.runOwn(entry, kind, action), runRefs(action.parallel, true)]);
    await runRefs(action.after, false);
    return result;
  }

  private async runOwn(entry: RuntimeEntry, kind: ActionKind, action: Action): Promise<RunResult> {
    const label = this.label(entry);
    entry.busy = true;
    this.emit(entry.key);
    let result: RunResult;
    try {
      if (action.admin && !this.config?.settings.allowAdminCommands) {
        result = { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: false, error: DEFAULT_TEXT.noAdmin };
      } else {
        const options = this.runOptions(entry, action);
        const script = this.expandText(action.run);
        result = await (action.admin ? this.deps.runAdmin : this.deps.run)(script, options);
      }
    } finally {
      entry.busy = false;
      this.emit(entry.key);
    }

    const ok = isSuccess(result);
    this.deps.log({
      time: Date.now(),
      key: entry.key,
      label,
      kind,
      script: action.run,
      code: result.code,
      ok,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error ?? (result.timedOut ? 'Timed out' : result.killed ? 'Stopped' : undefined),
    });

    if (!ok) {
      const reason = result.error ?? (result.timedOut ? `Timed out after ${action.timeout}s` : result.killed ? 'Stopped' : `Exit code ${result.code}`);
      const detail = (result.stderr || result.stdout).split(/\r?\n/).slice(-3).join('\n');
      this.deps.notify(label, `${DEFAULT_TEXT.failed}: ${reason}${detail ? `\n${detail}` : ''}`, 'error');
    } else if (action.notify) {
      this.deps.notify(label, typeof action.notify === 'string' ? this.expandText(action.notify) : DEFAULT_TEXT.ok, 'info');
    }

    if (entry.entry.state && !this.stopped) this.scheduleCheck(entry, this.deps.recheckDelay ?? 700, this.generation);
    return result;
  }

  runOptions(entry: RuntimeEntry | undefined, action: Pick<Action, 'shell' | 'cwd' | 'env' | 'timeout' | 'terminal'>): RunOptions {
    const env = action.env ? Object.fromEntries(Object.entries(action.env).map(([k, v]) => [k, this.expandText(v)])) : undefined;
    return {
      shell: entry ? this.shellFor(entry, action.shell) : (action.shell ?? this.config?.settings.shell ?? defaultShell(this.deps.platform)),
      cwd: action.cwd ? this.resolvePath(action.cwd) : this.configDir || undefined,
      env,
      timeout: action.timeout,
      terminal: action.terminal,
      label: entry ? this.label(entry) : undefined,
    };
  }

  /** Runs an action from the editor without touching the configuration ("Test" button). */
  async test(action: Action, check = false): Promise<RunResult> {
    const options = this.runOptions(undefined, action);
    const script = this.expandText(action.run);
    if (action.admin && !check) {
      if (!this.config?.settings.allowAdminCommands)
        return { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: false, error: DEFAULT_TEXT.noAdmin };
      return this.deps.runAdmin(script, options);
    }
    return this.deps.run(script, { ...options, timeout: options.timeout ?? (check ? 60 : undefined) });
  }

  /* ---------- state checks ---------- */

  private scheduleCheck(entry: RuntimeEntry, delayMs: number, generation: number) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.check(entry, generation), delayMs);
  }

  /** Runs a check now; if one is already running, waits for it and checks again with fresh data. */
  async checkNow(key: string) {
    const entry = this.get(key);
    if (!entry?.entry.state) return;
    if (entry.inflight) await entry.inflight.catch(() => undefined);
    await this.check(entry, this.generation, true);
  }

  private async check(entry: RuntimeEntry, generation: number, force = false) {
    const state = entry.entry.state;
    if (!state || generation !== this.generation) return;
    entry.timer = undefined;
    if (entry.checking) return;
    if (!force && !this.isActive(entry)) {
      // paused while hidden or disabled: look again later in case it becomes active
      if (!this.stopped) this.scheduleCheck(entry, state.interval * 1000, generation);
      return;
    }
    entry.checking = true;
    let result: RunResult;
    const pending = this.deps.run(this.expandText(state.check), {
      ...this.runOptions(entry, { shell: state.shell, timeout: Math.max(state.interval, 30) }),
    });
    entry.inflight = pending.then(() => undefined);
    try {
      result = await pending;
    } finally {
      entry.checking = false;
      entry.inflight = undefined;
    }
    if (generation !== this.generation) return;
    const on = evaluateState(result, state.on, state.off);
    entry.lastCheck = Date.now();
    const previous = entry.on;
    entry.on = on;
    if (previous !== on) {
      if (previous !== undefined) {
        const message = on ? state.notify?.on : state.notify?.off;
        if (message) this.deps.notify(this.label(entry), typeof message === 'string' ? this.expandText(message) : on ? DEFAULT_TEXT.stateOn : DEFAULT_TEXT.stateOff, 'info');
      }
      this.emit(entry.key);
    }
    if (!this.stopped) this.scheduleCheck(entry, state.interval * 1000, generation);
  }
}

/**
 * Decides ON/OFF from a check result:
 *  - exit code != 0 → OFF
 *  - output matches `off` → OFF
 *  - `on` given → ON only if the output matches it
 *  - otherwise → ON
 */
export function evaluateState(result: RunResult, on?: string, off?: string): boolean {
  if (!isSuccess(result)) return false;
  const output = result.stdout;
  if (off !== undefined && new RegExp(off, 'm').test(output)) return false;
  if (on !== undefined) return new RegExp(on, 'm').test(output);
  return true;
}
