/*
 * The logic of the schedule editor (and of the tray tooltip), kept apart from the components so
 * that it is unit tested: modes, the "At set times" form, the time window fields, the watch fields.
 */
import type { Schedule, Watch } from './config.ts';
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

/** Description of the Schedule card of an entry. */
export function scheduleCardText(st: { nextRun?: number; watches?: WatchStatus[] } | undefined, paused: boolean, hasSchedules: boolean, fmt: (t: number) => string): string {
  const failed = st?.watches?.find((w) => w.state === 'error');
  if (failed) return `Folder watch: ${failed.error}`;
  if (st?.nextRun) return `Next run ${fmt(st.nextRun)}`;
  if (st?.watches?.some((w) => w.state === 'watching')) return 'Watching for files';
  if (paused && hasSchedules) return 'Paused from the tray menu';
  return 'Run automatically';
}
