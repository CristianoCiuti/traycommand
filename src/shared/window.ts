/*
 * Time windows of schedules: "between": "08:30-18:00" (may cross midnight: "22:00-06:00") and
 * "days": "mon-fri" (cron day-of-week syntax). Local time. A window that crosses midnight belongs
 * to the day it starts on.
 */
import { parseCron } from './cron.ts';

export interface TimeWindow {
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** undefined = every day (0 = Sunday). */
  days?: Set<number>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function parseTime(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59 || (Number(m[1]) === 24 && Number(m[2]) !== 0)) throw new Error(`"${text.trim()}" is not a time: use HH:MM, e.g. 08:30`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseBetween(text: string): { start: number; end: number } {
  const parts = text.split('-');
  if (parts.length !== 2) throw new Error('Use two times: "08:00-18:00"');
  const start = parseTime(parts[0]!);
  const end = parseTime(parts[1]!);
  if (start === end) throw new Error('Start and end are the same time');
  if (start === 1440) throw new Error('The start must be before 24:00');
  return { start, end };
}

export function parseDays(text: string): Set<number> {
  const t = text.trim();
  if (!t) throw new Error('No days');
  try {
    return parseCron(`0 0 * * ${t.replace(/\s+/g, '')}`).dow;
  } catch (error) {
    throw new Error((error as Error).message.replace('day of week', 'days'));
  }
}

export function windowError(between?: string, days?: string): { between?: string; days?: string } | undefined {
  const out: { between?: string; days?: string } = {};
  if (between !== undefined) {
    try {
      parseBetween(between);
    } catch (e) {
      out.between = (e as Error).message;
    }
  }
  if (days !== undefined) {
    try {
      parseDays(days);
    } catch (e) {
      out.days = (e as Error).message;
    }
  }
  return out.between || out.days ? out : undefined;
}

/** undefined when the schedule has no window (always active) or the window is invalid. */
export function parseWindow(between?: string, days?: string): TimeWindow | undefined {
  if (between === undefined && days === undefined) return undefined;
  try {
    const { start, end } = between !== undefined ? parseBetween(between) : { start: 0, end: 1440 };
    const set = days !== undefined ? parseDays(days) : undefined;
    return { start, end, days: set && set.size < 7 ? set : undefined };
  } catch {
    return undefined;
  }
}

const dayOk = (w: TimeWindow, day: number) => !w.days || w.days.has(day);
const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const at = (base: Date, dayOffset: number, mins: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, Math.floor(mins / 60), mins % 60, 0, 0);

export function inWindow(w: TimeWindow | undefined, d: Date): boolean {
  if (!w) return true;
  const m = minutes(d);
  if (w.start < w.end) return dayOk(w, d.getDay()) && m >= w.start && m < w.end;
  // crosses midnight
  if (m >= w.start) return dayOk(w, d.getDay());
  if (m < w.end) return dayOk(w, (d.getDay() + 6) % 7);
  return false;
}

/** Next time strictly after `after` when the window opens or closes. */
export function nextWindowChange(w: TimeWindow, after: Date): Date | undefined {
  let best: Date | undefined;
  for (let i = -1; i <= 8; i++) {
    const day = at(after, i, 0);
    if (!dayOk(w, day.getDay())) continue;
    const open = at(after, i, w.start);
    const close = at(after, i + (w.end <= w.start ? 1 : 0), w.end);
    for (const t of [open, close]) if (t > after && (!best || t < best)) best = t;
  }
  return best;
}

/** First time strictly after `after` when the window opens. */
export function nextWindowStart(w: TimeWindow, after: Date): Date | undefined {
  for (let i = 0; i <= 8; i++) {
    const open = at(after, i, w.start);
    if (open > after && dayOk(w, open.getDay())) return open;
  }
  return undefined;
}

/** `next(from)` restricted to the window: the first run inside it. */
export function windowed(w: TimeWindow | undefined, next: (from: number) => number | undefined): (from: number) => number | undefined {
  if (!w) return next;
  return (from) => {
    let t = next(from);
    for (let i = 0; i < 1000 && t !== undefined; i++) {
      if (inWindow(w, new Date(t))) return t;
      const open = nextWindowStart(w, new Date(t));
      if (!open) return undefined;
      t = next(open.getTime() - 1);
    }
    return undefined;
  };
}

function ranges(values: number[]): string {
  // Monday first
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = order.filter((d) => values.includes(d));
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && order.indexOf(sorted[j + 1]!) === order.indexOf(sorted[j]!) + 1) j++;
    out.push(j - i >= 2 ? `${DAY_NAMES[sorted[i]!]}–${DAY_NAMES[sorted[j]!]}` : sorted.slice(i, j + 1).map((d) => DAY_NAMES[d]).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}

export function describeDays(days: Set<number>): string {
  const list = [...days];
  if (list.length === 7) return 'every day';
  if (list.sort().join() === '1,2,3,4,5') return 'on weekdays';
  if (list.sort().join() === '0,6') return 'on weekends';
  return `on ${ranges(list)}`;
}

/** "from 08:00 to 18:00 on weekdays" (empty when there is no window). */
export function describeWindow(between?: string, days?: string): string {
  const w = parseWindow(between, days);
  if (!w) return between !== undefined || days !== undefined ? 'invalid time window' : '';
  const time = between !== undefined ? `from ${pad(Math.floor(w.start / 60))}:${pad(w.start % 60)} to ${pad(Math.floor(w.end / 60))}:${pad(w.end % 60)}${w.end <= w.start ? ' (next day)' : ''}` : '';
  const d = w.days ? describeDays(w.days) : '';
  return [time, d].filter(Boolean).join(' ');
}

/** Days as written in the configuration, from a set: "mon-fri", "sat,sun", "mon,wed,fri". */
export function daysText(days: number[]): string | undefined {
  if (!days.length || days.length === 7) return undefined;
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j - i >= 2 ? `${names[sorted[i]!]}-${names[sorted[j]!]}` : sorted.slice(i, j + 1).map((d) => names[d]).join(','));
    i = j + 1;
  }
  return out.join(',');
}
