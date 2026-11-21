/*
 * The logic of the schedule editor (and of the tray tooltip), kept apart from the components so
 * that it is unit tested: modes, the "At set times" form, the time window fields, the watch fields.
 */
import type { Alert, Choice, Condition, Schedule, Watch } from './config.ts';
import type { WatchStatus } from './api.ts';
import { parseCron, parseInterval } from './cron.ts';
import { patternList } from './glob.ts';
import { daysText } from './window.ts';

export type ScheduleMode = 'every' | 'times' | 'cron' | 'startup' | 'watch';
export type FileEvent = 'add' | 'change' | 'remove';

export const FILE_EVENTS: { e: FileEvent; s: string; verb: string }[] = [
  { e: 'add', s: 'Created', verb: 'appears' },
  { e: 'change', s: 'Changed', verb: 'changes' },
  { e: 'remove', s: 'Deleted', verb: 'is deleted' },
];

/** A cron the "At set times" form can show: fixed minutes and hours, any day of month and month. */
export function timesOf(cron: string): { times: string[]; days: number[] } | undefined {
  let spec;
  try {
    spec = parseCron(cron);
  } catch {
    return undefined;
  }
  if (!spec.domAny || spec.month.size !== 12 || spec.minute.size !== 1 || spec.hour.size > 6) return undefined;
  const m = [...spec.minute][0]!;
  const times = [...spec.hour].sort((a, b) => a - b).map((h) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  return { times, days: spec.dowAny ? [0, 1, 2, 3, 4, 5, 6] : [...spec.dow] };
}

/** The cron of the "At set times" form (all times share the minutes of the first one). */
export function cronOf(times: string[], days: number[]): string {
  const parsed = times.map((t) => /^(\d{1,2}):(\d{2})$/.exec(t.trim())).filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60) as RegExpExecArray[];
  const minute = parsed[0] ? Number(parsed[0][2]) : 0;
  const hours = [...new Set(parsed.map((m) => Number(m[1])))].sort((a, b) => a - b);
  const dow = days.length === 7 || !days.length ? '*' : [...days].sort((a, b) => a - b).join(',');
  return `${minute} ${hours.length ? hours.join(',') : '9'} * * ${dow}`;
}

export function modeOf(s: Schedule): ScheduleMode {
  if (s.watch) return 'watch';
  if (s.startup) return 'startup';
  if (s.every !== undefined) return 'every';
  if (s.cron !== undefined && timesOf(s.cron)) return 'times';
  return 'cron';
}

/** The schedule after choosing another kind in the editor: keeps run, values, window, disabled. */
export function withMode(s: Schedule, mode: ScheduleMode): Schedule {
  const { cron, every: _e, startup: _s, watch: _w, ...rest } = s;
  void _e;
  void _s;
  void _w;
  switch (mode) {
    case 'every':
      return { ...rest, every: '15m' };
    case 'startup':
      return { ...rest, startup: true };
    case 'watch':
      return { ...rest, watch: { path: '', files: '*.txt' } };
    case 'times':
      return { ...rest, cron: '0 9 * * 1-5' };
    default:
      return { ...rest, cron: cron ?? '*/30 9-18 * * 1-5' };
  }
}

/** Without the keys set to undefined (the editor writes clean JSON). */
export function cleanSchedule(s: Schedule): Schedule {
  const clean = { ...s };
  for (const k of Object.keys(clean) as (keyof Schedule)[]) if (clean[k] === undefined) delete clean[k];
  return clean;
}

/* ---------- time window fields ---------- */

/** From / to shown in the time fields ("24:00" is shown as midnight); a window of days only is the whole day. */
export function windowTimes(between: string | undefined, active: boolean): { from: string; to: string } {
  const [from, to] = (between ?? (active ? '00:00-24:00' : '09:00-18:00')).split('-');
  return { from: from!, to: to === '24:00' || to === undefined ? '00:00' : to };
}

/** `between` from the time fields; the whole day = no `between`. An empty field means midnight. */
export function betweenOf(from: string, to: string): string | undefined {
  const a = from || '00:00';
  const b = !to || to === '00:00' ? '24:00' : to;
  return a === '00:00' && b === '24:00' ? undefined : `${a}-${b}`;
}

/** The schedule after switching "Only in a time window" on (office hours on weekdays) or off. */
export function withWindow(s: Schedule, on: boolean): Schedule {
  return on ? { ...s, between: '09:00-18:00', days: 'mon-fri' } : { ...s, between: undefined, days: undefined };
}

/** The schedule after editing the time fields; a whole-day window stays on through `days`. */
export function withTimes(s: Schedule, from: string, to: string): Schedule {
  const between = betweenOf(from, to);
  return { ...s, between, days: between === undefined && s.days === undefined ? 'sun-sat' : s.days };
}

/** The schedule after clicking the day buttons; undefined when no day is left (not allowed). */
export function withDays(s: Schedule, days: number[]): Schedule | undefined {
  if (!days.length) return undefined;
  const text = daysText(days);
  // every day and no hours: keep the window on
  return { ...s, days: text ?? (s.between === undefined ? 'sun-sat' : undefined) };
}

/* ---------- watch fields ---------- */

/** The watch after a change in the editor: defaults (false, undefined) are not written. */
export function patchWatch(w: Watch, patch: Partial<Watch>): Watch {
  const next: Watch = { ...w, ...patch };
  for (const k of Object.keys(next) as (keyof Watch)[]) if (next[k] === undefined || next[k] === false) delete next[k];
  return next;
}

export function watchEvents(w: Watch): FileEvent[] {
  return w.events?.length ? w.events : ['add'];
}

/** Events after clicking one; undefined = the default (only "add"); the last one cannot be removed. */
export function toggleEvent(current: FileEvent[], e: FileEvent): FileEvent[] | undefined | 'unchanged' {
  const next = current.includes(e) ? current.filter((x) => x !== e) : [...current, e];
  if (!next.length) return 'unchanged';
  if (next.length === 1 && next[0] === 'add') return undefined;
  return FILE_EVENTS.map((y) => y.e).filter((x) => next.includes(x));
}

export function filesText(w: Watch): string {
  return Array.isArray(w.files) ? w.files.join(', ') : (w.files ?? '');
}

export function settleSeconds(w: Watch): number {
  return parseInterval(w.settle ?? '2s') ?? 2;
}

/** `settle` from the seconds field: 1 to 3600, 2 (the default) is not written. */
export function settleOf(input: string): string | undefined {
  const n = Math.min(3600, Math.max(1, Math.round(Number(input) || 2)));
  return n === 2 ? undefined : `${n}s`;
}

/** "When a file *.txt appears in C:\in or its sub folders". */
export function watchText(w: Watch, resolved?: string): string {
  const files = patternList(w.files);
  const events = watchEvents(w).map((e) => FILE_EVENTS.find((x) => x.e === e)!.verb);
  const what = files.length ? `a file ${files.join(' or ')}` : 'a file';
  const verbs = events.length > 1 ? `${events.slice(0, -1).join(', ')} or ${events.at(-1)}` : events[0];
  return `When ${what} ${verbs} in ${resolved ?? (w.path || '(choose a folder)')}${w.subfolders ? ' or its sub folders' : ''}`;
}

export function watchStateText(st: WatchStatus): string {
  return st.state === 'watching' ? 'watching now' : st.state === 'waiting' ? 'not now (outside the time window, or paused)' : `${st.error}: trying again every few seconds`;
}

/** Part of the tray tooltip about the folder watches of an entry. */
export function watchTooltip(watches: WatchStatus[]): string | undefined {
  const failed = watches.find((w) => w.state === 'error');
  if (failed) return `folder watch: ${failed.error}`;
  const watching = watches.filter((w) => w.state === 'watching');
  if (watching.length) return `watching ${watching.map((w) => w.path.split(/[\\/]/).filter(Boolean).pop()).join(', ')}`;
  return undefined;
}

/* ---------- "only if" ---------- */

export function conditionFields(c: Condition | undefined): { check: string; on: string; off: string } {
  if (c === undefined) return { check: '', on: '', off: '' };
  if (typeof c === 'string') return { check: c, on: '', off: '' };
  return { check: c.check, on: c.on ?? '', off: c.off ?? '' };
}

/** The schedule with its check changed (undefined = no check). A check without patterns is written as a string. */
export function withCondition(s: Schedule, fields: { check: string; on: string; off: string } | undefined): Schedule {
  if (!fields) return { ...s, if: undefined };
  const old = typeof s.if === 'object' ? s.if : undefined;
  const extra = { shell: old?.shell, timeout: old?.timeout };
  const plain = !fields.on && !fields.off && extra.shell === undefined && extra.timeout === undefined;
  if (plain) return { ...s, if: fields.check };
  const c: Exclude<Condition, string> = { check: fields.check };
  if (fields.on) c.on = fields.on;
  if (fields.off) c.off = fields.off;
  if (extra.shell !== undefined) c.shell = extra.shell;
  if (extra.timeout !== undefined) c.timeout = extra.timeout;
  return { ...s, if: c };
}

/* ---------- alert ---------- */

export type ChoiceKind = 'self' | 'entry' | 'command';

/** The schedule with its alert switched on (a message and a button that runs the entry) or off. */
export function withAlert(s: Schedule, on: boolean): Schedule {
  return on ? { ...s, alert: { text: '', choices: [{ label: 'Run', run: 'self' }] } } : { ...s, alert: undefined };
}

/** The alert after a change in the editor: empty texts and defaults are not written. */
export function patchAlert(a: Alert, patch: Partial<Alert>): Alert {
  const next: Alert = { ...a, ...patch };
  if (next.style === 'window') delete next.style;
  for (const k of ['title', 'timeout'] as const) if (!next[k]) delete next[k];
  if (next.choices && !next.choices.length) delete next.choices;
  // the default must stay one of the choices (an empty label while it is being retyped is still that button)
  if (next.default === undefined || !(next.choices ?? []).some((c) => c.label === next.default)) delete next.default;
  return next;
}

export function choiceKind(c: Choice): ChoiceKind {
  if (c.action !== undefined) return 'command';
  return c.run === 'self' || c.run === undefined ? 'self' : 'entry';
}

/** The choice after changing what it does; `firstId` is proposed for "another entry". */
export function withChoiceKind(c: Choice, kind: ChoiceKind, firstId: string | undefined): Choice {
  if (kind === 'self') return { label: c.label, run: 'self' };
  if (kind === 'entry') return { label: c.label, run: firstId ?? '' };
  return { label: c.label, action: '' };
}

/** A new choice for the editor: a label not used yet. */
export function newChoice(choices: Choice[]): Choice {
  let n = choices.length + 1;
  while (choices.some((c) => c.label === `Choice ${n}`)) n++;
  return { label: `Choice ${n}`, run: 'self' };
}

/** Index of the default button (the first with that label, as when it runs), -1 = none. */
export function defaultIndex(a: Alert): number {
  return a.default === undefined ? -1 : (a.choices ?? []).findIndex((c) => c.label === a.default);
}

/**
 * The alert after renaming a button: the default stays on the same button, whatever the labels pass through.
 * While two buttons have the default's label (one is being retyped), the default is the one not being renamed.
 */
export function renameChoice(a: Alert, index: number, label: string): Alert {
  const old = a.choices ?? [];
  const matches = a.default === undefined ? [] : old.map((c, i) => (c.label === a.default ? i : -1)).filter((i) => i >= 0);
  const d = matches.find((i) => i !== index) ?? matches[0] ?? -1;
  const choices = old.map((c, i) => (i === index ? { ...c, label } : c));
  return patchAlert(a, { choices, default: d >= 0 ? choices[d]!.label : undefined });
}

/** The alert without one of its buttons (the default goes with it, or stays on its button). */
export function removeChoice(a: Alert, index: number): Alert {
  const d = defaultIndex(a);
  const choices = (a.choices ?? []).filter((_, i) => i !== index);
  return patchAlert(a, { choices, default: d >= 0 && d !== index ? a.choices![d]!.label : undefined });
}

/** The timeout in the largest whole unit: "2m" → 2 minutes, "1h30m" → 90 minutes, "1d" → 24 hours; invalid → undefined. */
export function timeoutParts(timeout: string | undefined): { n: number; unit: 's' | 'm' | 'h' } | undefined {
  const seconds = timeout === undefined ? undefined : parseInterval(timeout);
  if (!seconds) return undefined;
  if (seconds % 3600 === 0) return { n: seconds / 3600, unit: 'h' };
  if (seconds % 60 === 0) return { n: seconds / 60, unit: 'm' };
  return { n: seconds, unit: 's' };
}

/** The timeout written from the editor fields: the number as typed and the unit chosen (no normalisation while typing). */
export function timeoutOf(n: string, unit: 's' | 'm' | 'h'): string | undefined {
  const value = Math.round(Number(n));
  return n.trim() && value > 0 ? `${value}${unit}` : undefined;
}

/** "b:off" → { id: 'b', how: 'off' }; how '' = like a click. */
export function choiceTarget(run: string | undefined): { id: string; how: '' | 'on' | 'off' | 'right' } {
  const [id = '', how = ''] = (run ?? '').split(':');
  return { id, how: how as '' | 'on' | 'off' | 'right' };
}

export function choiceRun(id: string, how: '' | 'on' | 'off' | 'right'): string {
  return how ? `${id}:${how}` : id;
}

/* ---------- alert window ---------- */

/** Keys and clicks are ignored this long after an alert appears (typing elsewhere must not answer it). */
export const ALERT_ARM_MS = 500;

/** "0:42", "12:05", "1:00:00": time left before an alert closes. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type AlertKey = { type: 'none' } | { type: 'block' } | { type: 'dismiss' } | { type: 'focus'; index: number } | { type: 'choose'; index: number };

/** What a key does in an alert with `count` buttons, the `focused` one (-1 = none) and the `initial` one. */
export function alertKey(key: string, count: number, focused: number, initial: number, armed: boolean): AlertKey {
  if (!armed) return key === 'Tab' ? { type: 'none' } : { type: 'block' };
  if (key === 'Escape') return { type: 'dismiss' };
  const from = focused >= 0 ? focused : initial;
  if (key === 'ArrowRight' || key === 'ArrowDown') return { type: 'focus', index: (from + 1) % count };
  if (key === 'ArrowLeft' || key === 'ArrowUp') return { type: 'focus', index: (from - 1 + count) % count };
  if (key === 'Home') return { type: 'focus', index: 0 };
  if (key === 'End') return { type: 'focus', index: count - 1 };
  if (key === 'Enter' || key === ' ') return { type: 'choose', index: from };
  if (/^[1-9]$/.test(key) && Number(key) <= count) return { type: 'choose', index: Number(key) - 1 };
  return { type: 'none' };
}

/** Description of the Schedule card of an entry. */
export function scheduleCardText(st: { nextRun?: number; watches?: WatchStatus[] } | undefined, paused: boolean, hasSchedules: boolean, fmt: (t: number) => string): string {
  const failed = st?.watches?.find((w) => w.state === 'error');
  if (failed) return `Folder watch: ${failed.error}`;
  if (st?.nextRun) return `Next run ${fmt(st.nextRun)}`;
  if (st?.watches?.some((w) => w.state === 'watching')) return 'Watching for files';
  if (paused && hasSchedules) return 'Paused from the tray menu';
  return 'Run automatically';
}
