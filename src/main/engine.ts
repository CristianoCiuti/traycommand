import {
  type Action,
  type ActionInput,
  type Config,
  type Input,
  type MenuEntry,
  type MenuNode,
  type Schedule,
  type Shell,
  type Tray,
  isSeparator,
  normalizeAction,
} from '../shared/config';
import { expand, type VariableContext } from '../shared/variables';
import { nextCron, parseCron, parseInterval } from '../shared/cron';
import { inWindow, nextWindowChange, parseWindow, windowed, type TimeWindow } from '../shared/window';
import { fileMatcher, patternList } from '../shared/glob';
import type { EntryStatus, ExecutionLog, PromptField, PromptRequest, RunSource, WatchStatus } from '../shared/api';
import { FolderWatch, type FileChange } from './watcher';
import { isSuccess, type RunOptions, type RunResult, type Runner } from './runner';
import { defaultShell } from './shell';
import path from 'node:path';

export type ActionKind = 'on' | 'off' | 'right';

export interface InputMemory {
  get(key: string): Record<string, string> | undefined;
  set(key: string, values: Record<string, string>): void;
}

export interface EngineDeps {
  run: Runner;
  runAdmin: Runner;
  notify: (title: string, body: string, kind: 'info' | 'warning' | 'error') => void;
  confirm: (title: string, text: string) => Promise<boolean>;
  log: (entry: ExecutionLog) => void;
  /** Shows the form for the inputs of an action; undefined = cancelled. */
  prompt?: (request: PromptRequest) => Promise<Record<string, string> | undefined>;
  /** Last values typed for the inputs, per entry. */
  memory?: InputMemory;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Delay before re-checking the state after an action (ms). */
  recheckDelay?: number;
  /** Delay of "startup" schedules after TrayCommand starts (ms). */
  startupDelay?: number;
  /** Retry delay of folder watches whose folder is missing (ms). */
  watchRetry?: number;
}

export interface TriggerOptions {
  source?: RunSource;
  /** Values for inputs (not asked again). */
  values?: Record<string, string>;
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
  /** Next scheduled run per schedule index. */
  nextRuns: Map<number, number>;
  /** Folder watches per schedule index. */
  watches: Map<number, { watch: FolderWatch; path: string; window?: TimeWindow }>;
  /** Runs started by file events, one after the other. */
  watchQueue?: Promise<void>;
}

interface ExecContext {
  values: Record<string, string>;
  secrets: string[];
  interactive: boolean;
  source: RunSource;
}

interface CollectedInput {
  input: Input;
  owner: RuntimeEntry | undefined;
  action: Action;
}

const DEFAULT_TEXT = {
  ok: 'Done',
  stateOn: 'Now ON',
  stateOff: 'Now OFF',
  failed: 'Failed',
  busy: 'Still running, try again when it finishes',
  noAdmin: 'Admin commands are disabled. Enable them in Settings → Advanced.',
};

/** Longest single wait of a schedule timer: longer waits are split, so clock changes are noticed. */
const MAX_WAIT = 60 * 60 * 1000;

export function inputDefault(input: Input): string {
  if (input.type === 'checkbox') return input.default === true || input.default === 'true' ? 'true' : 'false';
  return input.default === undefined ? '' : String(input.default);
}

/** Checks a value against the rules of its input; returns the problem or undefined. */
export function inputProblem(input: Pick<Input, 'type' | 'optional' | 'pattern'>, value: string): string | undefined {
  if (input.type === 'checkbox') return undefined;
  if (value === '') return input.optional ? undefined : 'Required';
  if (input.type === 'number' && !Number.isFinite(Number(value))) return 'Not a number';
  if (input.pattern) {
    try {
      if (!new RegExp(`^(?:${input.pattern})$`).test(value)) return 'Not in the expected format';
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class Engine {
  private config?: Config;
  private configDir = '';
  private entries = new Map<string, RuntimeEntry>();
  private byId = new Map<string, RuntimeEntry>();
  private roots: RuntimeEntry[] = [];
  private listeners = new Set<(key?: string) => void>();
  private stopped = true;
  private generation = 0;
  private startedOnce = false;
  private paused = false;
  /** Start time of "every" schedules, kept across reloads so that saving does not restart them. */
  private anchors = new Map<string, number>();
  private scheduleTimers = new Set<NodeJS.Timeout>();
  /** Folder watches of the last start, to tell new ones (they report the files already there, with "existing"). */
  private watchKeys = new Set<string>();
  private promptId = 0;
  private optionLoaders = new Map<string, () => Promise<{ options?: string[]; error?: string }>>();

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
    this.armSchedules(generation, !this.startedOnce);
    this.startedOnce = true;
  }

  stop() {
    this.stopped = true;
    this.generation++;
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.nextRuns.clear();
      for (const w of entry.watches.values()) w.watch.close();
      entry.watches.clear();
    }
    for (const t of this.scheduleTimers) clearTimeout(t);
    this.scheduleTimers.clear();
  }

  onChange(listener: (key?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(key?: string) {
    for (const listener of this.listeners) listener(key);
  }

  private build(node: Tray | MenuEntry, key: string, isTray: boolean, parent?: RuntimeEntry): RuntimeEntry {
    const runtime: RuntimeEntry = { key, entry: node, isTray, parent, children: [], busy: false, checking: false, nextRuns: new Map(), watches: new Map() };
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

  /** All entries, depth first in menu order. */
  get all(): RuntimeEntry[] {
    return [...this.entries.values()];
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

  /** Disabled itself or through an ancestor (hidden entries still run from shortcuts, launcher and schedules). */
  isDisabled(entry: RuntimeEntry): boolean {
    for (let e: RuntimeEntry | undefined = entry; e; e = e.parent) if (e.entry.disabled) return true;
    return false;
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

  nextRun(entry: RuntimeEntry): number | undefined {
    if (this.paused || !entry.nextRuns.size || this.isDisabled(entry)) return undefined;
    return Math.min(...entry.nextRuns.values());
  }

  status(entry: RuntimeEntry): EntryStatus {
    return {
      key: entry.key,
      id: entry.entry.id,
      on: entry.entry.state ? entry.on : undefined,
      busy: entry.busy,
      enabled: this.isEnabled(entry),
      lastCheck: entry.lastCheck,
      nextRun: this.nextRun(entry),
      watches: entry.watches.size ? this.watchStatus(entry) : undefined,
    };
  }

  watchStatus(entry: RuntimeEntry): WatchStatus[] {
    const now = new Date();
    return [...entry.watches].map(([index, w]) => ({
      index,
      path: w.path,
      state: w.watch.error ? 'error' : this.paused || this.isDisabled(entry) || !inWindow(w.window, now) ? 'waiting' : 'watching',
      error: w.watch.error,
    }));
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

  /** "Tray › Sub menu" (ancestors only). */
  pathLabel(entry: RuntimeEntry): string {
    const parts: string[] = [];
    for (let e = entry.parent; e; e = e.parent) parts.unshift(this.label(e));
    return parts.join(' › ');
  }

  /* ---------- helpers ---------- */

  private get ctx(): VariableContext {
    return { variables: this.config?.variables ?? {}, env: this.deps.env ?? process.env, configDir: this.configDir };
  }

  /** Expands ${NAME}; `values` (inputs) take precedence over the configuration variables. */
  expandText(text: string, values?: Record<string, string>): string {
    const ctx = this.ctx;
    return expand(text, values ? { ...ctx, variables: { ...ctx.variables, ...values } } : ctx);
  }

  resolvePath(p: string, values?: Record<string, string>): string {
    const expanded = this.expandText(p, values);
    return path.isAbsolute(expanded) ? expanded : path.resolve(this.configDir, expanded);
  }

  private shellFor(entry: RuntimeEntry, own?: Shell): Shell {
    return own ?? this.config?.settings.shell ?? defaultShell(this.deps.platform);
  }

  actionOf(entry: RuntimeEntry, kind: ActionKind): Action | undefined {
    const e = entry.entry;
    return normalizeAction(kind === 'on' ? e.action : kind === 'off' ? e.offAction : e.rightAction);
  }

  /* ---------- clicks ---------- */

  /** Which action a left click runs; undefined means "open the menu". */
  clickKind(entry: RuntimeEntry): ActionKind | undefined {
    if (entry.entry.state && entry.on === true && entry.entry.offAction) return 'off';
    return entry.entry.action ? 'on' : undefined;
  }

  async click(key: string, source: RunSource = 'click'): Promise<boolean> {
    const entry = this.get(key);
    if (!entry) return false;
    const kind = this.clickKind(entry);
    if (!kind) return false;
    await this.trigger(entry, kind, { source });
    return true;
  }

  async rightClick(key: string, source: RunSource = 'click'): Promise<boolean> {
    const entry = this.get(key);
    if (!entry?.entry.rightAction) return false;
    await this.trigger(entry, 'right', { source });
    return true;
  }

  /** User-initiated action: respects disabled/busy state. */
  async trigger(entry: RuntimeEntry, kind: ActionKind, options: TriggerOptions = {}) {
    if (!this.isEnabled(entry)) {
      if (entry.busy) this.deps.notify(this.label(entry), DEFAULT_TEXT.busy, 'warning');
      return;
    }
    const source = options.source ?? 'click';
    const interactive = source !== 'schedule' && source !== 'watch';
    const resolved = await this.resolveInputs(this.collectInputs(entry, kind), {
      title: this.label(entry),
      subtitle: this.pathLabel(entry) || undefined,
      icon: this.iconFor(entry),
      memoryKey: `${entry.entry.id ?? entry.key}:${kind}`,
      given: options.values ?? {},
      interactive,
      submitLabel: kind === 'off' ? 'Turn off' : 'Run',
    });
    if (!resolved) return;
    if ('error' in resolved) {
      const label = this.label(entry);
      this.deps.notify(label, `${DEFAULT_TEXT.failed}: ${resolved.error}`, 'error');
      this.deps.log({ time: Date.now(), key: entry.key, label, kind, script: this.actionOf(entry, kind)?.run ?? '', code: null, ok: false, durationMs: 0, stdout: '', stderr: '', error: resolved.error, source });
      return;
    }
    await this.execute(entry, kind, new Set(), { ...resolved, interactive, source });
  }

  /* ---------- inputs ---------- */

  /** Inputs of an action and of the actions it runs (before / parallel / after); the first definition of a name wins. */
  collectInputs(entry: RuntimeEntry, kind: ActionKind, visited = new Set<string>(), out: CollectedInput[] = []): CollectedInput[] {
    const visitKey = `${entry.key}:${kind}`;
    if (visited.has(visitKey)) return out;
    visited.add(visitKey);
    const action = this.actionOf(entry, kind);
    if (!action) return out;
    for (const input of action.inputs ?? []) if (!out.some((c) => c.input.name === input.name)) out.push({ input, owner: entry, action });
    for (const ref of [...(action.before ?? []), ...(action.parallel ?? []), ...(action.after ?? [])]) {
      const t = this.refTargets(ref, kind);
      if (t) this.collectInputs(t.entry, t.kind, visited, out);
    }
    return out;
  }

  /** True when running this entry asks for values first. */
  needsInput(entry: RuntimeEntry, kind: ActionKind): boolean {
    return this.collectInputs(entry, kind).length > 0;
  }

  private async resolveInputs(
    collected: CollectedInput[],
    o: { title: string; subtitle?: string; icon?: string; memoryKey: string; given: Record<string, string>; interactive: boolean; submitLabel: string },
  ): Promise<{ values: Record<string, string>; secrets: string[] } | { error: string } | undefined> {
    const values: Record<string, string> = { ...o.given };
    if (!collected.length) return { values, secrets: [] };
    const remembered = this.deps.memory?.get(o.memoryKey) ?? {};
    const initial = (input: Input) =>
      o.given[input.name] ?? (input.remember !== false && input.type !== 'password' ? remembered[input.name] : undefined) ?? inputDefault(input);
    const secrets = () => collected.filter((c) => c.input.type === 'password').map((c) => values[c.input.name]).filter((v): v is string => !!v);

    const toAsk = collected.filter((c) => o.given[c.input.name] === undefined);
    if (!o.interactive || !toAsk.length || !this.deps.prompt) {
      for (const c of collected) {
        const value = initial(c.input);
        const problem = inputProblem(c.input, value);
        if (problem) {
          const hint = problem === 'Required' ? (o.interactive ? 'no value' : 'no value (scheduled runs do not ask: set it in the schedule values or as default)') : problem;
          return { error: `${c.input.label ?? c.input.name}: ${hint}` };
        }
        values[c.input.name] = value;
      }
      return { values, secrets: secrets() };
    }

    const id = ++this.promptId;
    const fields: PromptField[] = toAsk.map(({ input, owner, action }) => {
      const field: PromptField = {
        name: input.name,
        label: this.expandText(input.label ?? input.name),
        type: input.type ?? 'text',
        value: initial(input),
        placeholder: input.placeholder,
        optional: input.optional,
        pattern: input.pattern,
      };
      if (input.options) field.options = input.options.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : { value: opt.value, label: opt.label ?? opt.value }));
      if (input.optionsCommand) {
        field.dynamic = true;
        const script = this.expandText(input.optionsCommand, values);
        this.optionLoaders.set(`${id}:${input.name}`, async () => {
          const r = await this.deps.run(script, { ...this.runOptions(owner, action), timeout: action.timeout ?? 30 });
          if (!isSuccess(r)) return { error: r.error ?? (r.timedOut ? 'Timed out' : (r.stderr || `Exit code ${r.code}`).split(/\r?\n/).slice(-2).join(' ')) };
          return { options: r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) };
        });
      }
      return field;
    });
    try {
      const answer = await this.deps.prompt({ id, title: o.title, subtitle: o.subtitle, icon: o.icon, fields, submitLabel: o.submitLabel });
      if (!answer) return undefined;
      for (const c of collected) values[c.input.name] = answer[c.input.name] ?? values[c.input.name] ?? initial(c.input);
      const keep: Record<string, string> = { ...remembered };
      for (const c of collected) if (c.input.type !== 'password' && c.input.remember !== false && answer[c.input.name] !== undefined) keep[c.input.name] = answer[c.input.name]!;
      this.deps.memory?.set(o.memoryKey, keep);
      return { values, secrets: secrets() };
    } finally {
      for (const f of fields) this.optionLoaders.delete(`${id}:${f.name}`);
    }
  }

  /** Choices of a "select" whose options come from a script (asked by the form while it is open). */
  async inputOptions(promptId: number, name: string): Promise<{ options?: string[]; error?: string }> {
    const loader = this.optionLoaders.get(`${promptId}:${name}`);
    return loader ? loader() : { error: 'The form is no longer open' };
  }

  /* ---------- execution ---------- */

  private refTargets(ref: string, kind: ActionKind): { entry: RuntimeEntry; kind: ActionKind } | undefined {
    const [id, forced] = ref.split(':') as [string, ActionKind | undefined];
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return { entry, kind: forced ?? (kind === 'right' ? 'on' : kind) };
  }

  private async execute(entry: RuntimeEntry, kind: ActionKind, visited: Set<string>, ctx: ExecContext): Promise<RunResult | undefined> {
    const visitKey = `${entry.key}:${kind}`;
    if (visited.has(visitKey)) return undefined;
    visited.add(visitKey);

    const action = this.actionOf(entry, kind);
    if (!action) return undefined;

    // scheduled runs never ask: the user chose to run them unattended
    if (action.confirm && ctx.interactive) {
      const ok = await this.deps.confirm(this.label(entry), this.expandText(action.confirm, ctx.values));
      if (!ok) return undefined;
    }

    const runRefs = async (refs: string[] | undefined, parallel: boolean) => {
      const targets = (refs ?? []).map((r) => this.refTargets(r, kind)).filter((t) => t !== undefined);
      if (parallel) await Promise.all(targets.map((t) => this.execute(t.entry, t.kind, visited, ctx)));
      else for (const t of targets) await this.execute(t.entry, t.kind, visited, ctx);
    };

    await runRefs(action.before, false);
    const [result] = await Promise.all([this.runOwn(entry, kind, action, ctx), runRefs(action.parallel, true)]);
    await runRefs(action.after, false);
    return result;
  }

  private async runOwn(entry: RuntimeEntry, kind: ActionKind, action: Action, ctx: ExecContext): Promise<RunResult> {
    const label = this.label(entry);
    entry.busy = true;
    this.emit(entry.key);
    let result: RunResult;
    try {
      if (action.admin && !this.config?.settings.allowAdminCommands) {
        result = { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: false, error: DEFAULT_TEXT.noAdmin };
      } else {
        const options = this.runOptions(entry, action, ctx.values);
        const script = this.expandText(action.run, ctx.values);
        result = await (action.admin ? this.deps.runAdmin : this.deps.run)(script, options);
      }
    } finally {
      entry.busy = false;
      this.emit(entry.key);
    }

    const ok = isSuccess(result);
    const redact = (text: string) => ctx.secrets.reduce((t, s) => (s ? t.split(s).join('••••') : t), text);
    const own = new Set((action.inputs ?? []).map((i) => i.name));
    const shown = Object.entries(ctx.values).filter(([k]) => own.has(k) || k === 'TC_EVENT' || k === 'TC_FILE' || (k === 'TC_FILES' && ctx.values.TC_FILES !== ctx.values.TC_FILE));
    this.deps.log({
      time: Date.now(),
      key: entry.key,
      label,
      kind,
      script: action.run,
      code: result.code,
      ok,
      durationMs: result.durationMs,
      stdout: redact(result.stdout),
      stderr: redact(result.stderr),
      error: result.error ?? (result.timedOut ? 'Timed out' : result.killed ? 'Stopped' : undefined),
      source: ctx.source,
      inputs: shown.length ? Object.fromEntries(shown.map(([k, v]) => [k, v && ctx.secrets.includes(v) ? '••••' : v])) : undefined,
    });

    if (!ok) {
      const reason = result.error ?? (result.timedOut ? `Timed out after ${action.timeout}s` : result.killed ? 'Stopped' : `Exit code ${result.code}`);
      const detail = redact(result.stderr || result.stdout).split(/\r?\n/).slice(-3).join('\n');
      this.deps.notify(label, `${DEFAULT_TEXT.failed}: ${reason}${detail ? `\n${detail}` : ''}`, 'error');
    } else if (action.notify) {
      this.deps.notify(label, typeof action.notify === 'string' ? this.expandText(action.notify, ctx.values) : DEFAULT_TEXT.ok, 'info');
    }

    if (entry.entry.state && !this.stopped) this.scheduleCheck(entry, this.deps.recheckDelay ?? 700, this.generation);
    return result;
  }

  runOptions(entry: RuntimeEntry | undefined, action: Pick<Action, 'shell' | 'cwd' | 'env' | 'timeout' | 'terminal'>, values?: Record<string, string>): RunOptions {
    const own = action.env ? Object.fromEntries(Object.entries(action.env).map(([k, v]) => [k, this.expandText(v, values)])) : undefined;
    // input values are also environment variables: safer than ${NAME} for values with quotes or spaces
    const env = values && Object.keys(values).length ? { ...values, ...own } : own;
    return {
      shell: entry ? this.shellFor(entry, action.shell) : (action.shell ?? this.config?.settings.shell ?? defaultShell(this.deps.platform)),
      cwd: action.cwd ? this.resolvePath(action.cwd, values) : this.configDir || undefined,
      env,
      timeout: action.timeout,
      terminal: action.terminal,
      label: entry ? this.label(entry) : undefined,
    };
  }

  /** Runs an action from the editor without touching the configuration ("Test" button). */
  async test(action: Action, check = false): Promise<RunResult> {
    let values: Record<string, string> | undefined;
    if (!check && action.inputs?.length) {
      const resolved = await this.resolveInputs(
        action.inputs.map((input) => ({ input, owner: undefined, action })),
        { title: 'Test run', subtitle: 'Values for this test', memoryKey: '__test__', given: {}, interactive: true, submitLabel: 'Run test' },
      );
      if (!resolved) return { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: true, error: 'Cancelled' };
      if ('error' in resolved) return { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: false, error: resolved.error };
      values = resolved.values;
    }
    const options = this.runOptions(undefined, action, values);
    const script = this.expandText(action.run, values);
    if (action.admin && !check) {
      if (!this.config?.settings.allowAdminCommands)
        return { code: null, stdout: '', stderr: '', durationMs: 0, timedOut: false, killed: false, error: DEFAULT_TEXT.noAdmin };
      return this.deps.runAdmin(script, options);
    }
    return this.deps.run(script, { ...options, timeout: options.timeout ?? (check ? 60 : undefined) });
  }

  /* ---------- schedules ---------- */

  get schedulesPaused() {
    return this.paused;
  }

  setSchedulesPaused(paused: boolean) {
    this.paused = paused;
    this.emit();
  }

  private armSchedules(generation: number, appStart: boolean, rearm = false) {
    const now = Date.now();
    const used = new Set<string>();
    const watchKeys = new Set<string>();
    for (const entry of this.entries.values()) {
      entry.entry.schedules?.forEach((schedule, index) => {
        if (schedule.disabled) return;
        const window = parseWindow(schedule.between, schedule.days);
        if (schedule.watch) {
          const key = `${entry.entry.id ?? entry.key}#${index}#${JSON.stringify(schedule)}`;
          watchKeys.add(key);
          if (!rearm) this.startWatch(entry, index, schedule, window, appStart || !this.watchKeys.has(key));
          if (window) this.armWindowEdges(entry, index, schedule, window, generation);
          return;
        }
        if (schedule.startup) {
          // only when TrayCommand starts, not at every reload of the configuration
          if (appStart) this.later(generation, this.deps.startupDelay ?? 3000, () => void this.fireSchedule(entry, schedule));
          return;
        }
        if (schedule.cron !== undefined) {
          let spec: ReturnType<typeof parseCron>;
          try {
            spec = parseCron(schedule.cron);
          } catch {
            return;
          }
          this.armAt(entry, index, schedule, generation, windowed(window, (from) => nextCron(spec, new Date(from))?.getTime()));
          return;
        }
        const seconds = schedule.every !== undefined ? parseInterval(schedule.every) : undefined;
        if (!seconds) return;
        const anchorKey = `${entry.entry.id ?? entry.key}#${index}#${schedule.every}`;
        used.add(anchorKey);
        const anchor = this.anchors.get(anchorKey) ?? now;
        this.anchors.set(anchorKey, anchor);
        const ms = seconds * 1000;
        this.armAt(entry, index, schedule, generation, windowed(window, (from) => anchor + (Math.floor((from - anchor) / ms) + 1) * ms));
      });
    }
    for (const key of [...this.anchors.keys()]) if (!used.has(key)) this.anchors.delete(key);
    if (!rearm) this.watchKeys = watchKeys;
  }

  private startWatch(entry: RuntimeEntry, index: number, schedule: Schedule, window: TimeWindow | undefined, isNew: boolean) {
    const w = schedule.watch!;
    let match: (relative: string) => boolean;
    try {
      match = fileMatcher(patternList(w.files), (this.deps.platform ?? process.platform) !== 'linux');
    } catch {
      return;
    }
    const dir = this.resolvePath(w.path);
    const watch = new FolderWatch({
      dir,
      match,
      subfolders: w.subfolders === true,
      events: new Set(w.events?.length ? w.events : ['add']),
      settleMs: Math.max(0.2, parseInterval(w.settle ?? '2s') ?? 2) * 1000,
      retryMs: this.deps.watchRetry,
      onChanges: (changes) => this.onFileChanges(entry, schedule, window, changes),
      onState: () => this.emit(entry.key),
    });
    entry.watches.set(index, { watch, path: dir, window });
    // the files already there: when TrayCommand starts or the schedule is new, and only inside the time window
    watch.start(w.existing === true && isNew && !this.paused && !this.isDisabled(entry) && inWindow(window, new Date()));
  }

  /** At each opening and closing of the time window of a watch: refresh its state; on opening, report the files already there. */
  private armWindowEdges(entry: RuntimeEntry, index: number, schedule: Schedule, window: TimeWindow, generation: number) {
    const at = nextWindowChange(window, new Date())?.getTime();
    if (at === undefined) return;
    const wait = () =>
      this.later(generation, Math.max(0, Math.min(at - Date.now(), MAX_WAIT)), () => {
        if (Date.now() < at - 1000) return wait();
        this.emit(entry.key);
        if (schedule.watch?.existing && !this.paused && inWindow(window, new Date())) entry.watches.get(index)?.watch.reportExisting();
        this.armWindowEdges(entry, index, schedule, window, generation);
      });
    wait();
  }

  private onFileChanges(entry: RuntimeEntry, schedule: Schedule, window: TimeWindow | undefined, changes: FileChange[]) {
    if (this.paused || this.stopped || this.isDisabled(entry) || !inWindow(window, new Date())) return;
    const w = schedule.watch!;
    const dir = this.resolvePath(w.path);
    const valuesOf = (list: FileChange[]): Record<string, string> => {
      const first = list[0]!;
      const events = new Set(list.map((c) => c.event));
      return {
        TC_FILE: first.file,
        TC_FILE_NAME: path.basename(first.file),
        TC_FILE_DIR: path.dirname(first.file),
        TC_EVENT: events.size === 1 ? first.event : 'mixed',
        TC_FILES: list.map((c) => c.file).join('\n'),
        TC_WATCH_DIR: dir,
      };
    };
    const runs = w.batch ? [valuesOf(changes)] : changes.map((c) => valuesOf([c]));
    const generation = this.generation;
    for (const values of runs) {
      entry.watchQueue = (entry.watchQueue ?? Promise.resolve()).then(async () => {
        // one after the other: wait for the previous run (or a click) to finish
        for (let waited = 0; entry.busy && waited < 30 * 60 * 1000; waited += 250) await new Promise((r) => setTimeout(r, 250));
        if (generation !== this.generation) return;
        await this.fireSchedule(entry, schedule, values, 'watch').catch(() => undefined);
      });
    }
  }

  private later(generation: number, ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.scheduleTimers.delete(t);
      if (generation === this.generation) fn();
    }, ms);
    this.scheduleTimers.add(t);
  }

  /** Arms the next run after max(now, notBefore); `next(from)` returns the first run strictly after `from`. */
  private armAt(entry: RuntimeEntry, index: number, schedule: Schedule, generation: number, next: (from: number) => number | undefined, notBefore = 0) {
    const at = next(Math.max(Date.now(), notBefore));
    if (at === undefined) {
      entry.nextRuns.delete(index);
      return;
    }
    entry.nextRuns.set(index, at);
    this.emit(entry.key);
    const wait = () =>
      this.later(generation, Math.max(0, Math.min(at - Date.now(), MAX_WAIT)), () => {
        if (Date.now() < at - 1000) {
          // a long wait split in parts, or the clock moved: still the same next run?
          if (next(Math.max(Date.now(), notBefore)) === at) wait();
          else this.armAt(entry, index, schedule, generation, next, notBefore);
          return;
        }
        void this.fireSchedule(entry, schedule);
        this.armAt(entry, index, schedule, generation, next, at + 1000);
      });
    wait();
  }

  /** After sleep or a clock change: compute the next runs again (missed runs are not recovered). */
  rearmSchedules() {
    if (this.stopped) return;
    for (const t of this.scheduleTimers) clearTimeout(t);
    this.scheduleTimers.clear();
    for (const entry of this.entries.values()) entry.nextRuns.clear();
    this.armSchedules(this.generation, false, true);
    this.emit();
  }

  async fireSchedule(entry: RuntimeEntry, schedule: Schedule, extra?: Record<string, string>, source: RunSource = 'schedule') {
    if (this.paused || this.stopped || this.isDisabled(entry)) return;
    if (!inWindow(parseWindow(schedule.between, schedule.days), new Date())) return;
    const label = this.label(entry);
    if (entry.busy) {
      this.deps.log({ time: Date.now(), key: entry.key, label, kind: 'on', script: '', code: null, ok: false, durationMs: 0, stdout: '', stderr: '', error: 'Skipped: the previous run is still going', source });
      return;
    }
    const run = schedule.run ?? 'click';
    if (run !== 'right' && entry.entry.state && entry.on === undefined) await this.checkNow(entry.key);
    let kind: ActionKind | undefined;
    if (run === 'click') kind = this.clickKind(entry);
    else if (run === 'on') kind = entry.entry.state && entry.on === true ? undefined : 'on';
    else if (run === 'off') kind = entry.entry.state && entry.on === false ? undefined : 'off';
    else kind = 'right';
    if (!kind || !this.actionOf(entry, kind)) return;
    await this.trigger(entry, kind, { source, values: extra ? { ...schedule.values, ...extra } : schedule.values });
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
