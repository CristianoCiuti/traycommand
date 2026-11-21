/*
 * Minimal 5-field cron (minute hour day-of-month month day-of-week), local time.
 *
 * Supports "*", lists "1,5", ranges "1-5", steps "*\/15" "1-30/5" "5/10", names (JAN-DEC, SUN-SAT),
 * day of week 0-7 (0 and 7 = Sunday) and the macros @hourly @daily @weekly @monthly @yearly @weekdays.
 * Like Vixie cron, when both day fields are restricted a day matches if EITHER matches.
 */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
  source: string;
}

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@weekdays': '0 9 * * 1-5',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldDef {
  name: string;
  min: number;
  max: number;
  names?: string[];
  namesBase?: number;
}

const FIELDS: FieldDef[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, namesBase: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAYS, namesBase: 0 },
];

function parseValue(text: string, def: FieldDef): number {
  const upper = text.toUpperCase();
  if (def.names) {
    const i = def.names.indexOf(upper);
    if (i >= 0) return i + def.namesBase!;
  }
  if (!/^\d+$/.test(text)) throw new Error(`"${text}" is not valid for ${def.name}`);
  const n = Number(text);
  if (n < def.min || n > def.max) throw new Error(`${def.name} must be between ${def.min} and ${def.max} (found ${n})`);
  return n;
}

function parseField(text: string, def: FieldDef): { values: Set<number>; any: boolean } {
  const values = new Set<number>();
  let any = false;
  for (const part of text.split(',')) {
    if (!part) throw new Error(`Empty value in ${def.name}`);
    const [range, stepText] = part.split('/') as [string, string | undefined];
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step "${stepText}" in ${def.name}`);
    let from: number;
    let to: number;
    if (range === '*') {
      from = def.min;
      to = def.name === 'day of week' ? 6 : def.max;
      if (stepText === undefined) any = true;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-') as [string, string];
      from = parseValue(a, def);
      to = parseValue(b, def);
      if (from > to) throw new Error(`Range ${range} goes backwards in ${def.name}`);
    } else {
      from = parseValue(range, def);
      to = stepText === undefined ? from : def.name === 'day of week' ? 6 : def.max;
    }
    for (let v = from; v <= to; v += step) values.add(def.name === 'day of week' && v === 7 ? 0 : v);
  }
  return { values, any };
}

/** Parses a cron expression; throws an Error with a readable message when invalid. */
export function parseCron(expression: string): CronSpec {
  const source = expression.trim();
  const expanded = MACROS[source.toLowerCase()] ?? source;
  const parts = expanded.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new Error(`Expected 5 fields (minute hour day month weekday), found ${parts.length}`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]!));
  return { minute: minute!.values, hour: hour!.values, dom: dom!.values, month: month!.values, dow: dow!.values, domAny: dom!.any, dowAny: dow!.any, source };
}

export function cronError(expression: string): string | undefined {
  try {
    parseCron(expression);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.dom.has(d.getDate());
  const dow = spec.dow.has(d.getDay());
  if (spec.domAny && spec.dowAny) return true;
  if (spec.domAny) return dow;
  if (spec.dowAny) return dom;
  return dom || dow;
}

/** First time strictly after `after` that matches, or undefined if none within ~5 years. */
export function nextCron(spec: CronSpec, after: Date): Date | undefined {
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = after.getTime() + 5 * 366 * 24 * 3600 * 1000;
  while (d.getTime() <= limit) {
    if (!spec.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return undefined;
}

/** Next `count` run times. */
export function nextCronRuns(expression: string, count: number, after = new Date()): Date[] {
  const spec = parseCron(expression);
  const out: Date[] = [];
  let from = after;
  while (out.length < count) {
    const next = nextCron(spec, from);
    if (!next) break;
    out.push(next);
    from = next;
  }
  return out;
}

/* ---------- human readable description ---------- */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

/** Compresses [1,2,3,5] into "Mon–Wed, Fri" style ranges. */
function ranges(values: number[], name: (n: number) => string): string {
  const out: string[] = [];
  for (let i = 0; i < values.length; ) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j]! + 1) j++;
    out.push(j - i >= 2 ? `${name(values[i]!)}–${name(values[j]!)}` : j > i ? `${name(values[i]!)}, ${name(values[j]!)}` : name(values[i]!));
    i = j + 1;
  }
  return out.join(', ');
}

function stepOf(values: number[], min: number, max: number): number | undefined {
  if (values.length < 2 || values[0] !== min) return undefined;
  const step = values[1]! - values[0]!;
  for (let i = 1; i < values.length; i++) if (values[i]! - values[i - 1]! !== step) return undefined;
  return values.at(-1)! + step > max ? step : undefined;
}

export function describeCron(expression: string): string {
  let spec: CronSpec;
  try {
    spec = parseCron(expression);
  } catch {
    return 'Invalid expression';
  }
  const minutes = sorted(spec.minute);
  const hours = sorted(spec.hour);
  let time: string;
  const minuteStep = stepOf(minutes, 0, 59);
  const hourStep = stepOf(hours, 0, 23);
  const allHours = hours.length === 24;
  if (minutes.length === 60 && allHours) time = 'Every minute';
  else if (minuteStep && allHours) time = `Every ${minuteStep} minutes`;
  else if (minutes.length === 60) time = `Every minute during ${ranges(hours, (h) => `${pad(h)}:00`)}`;
  else if (minuteStep) time = `Every ${minuteStep} minutes from ${pad(hours[0]!)}:00 to ${pad(hours.at(-1)!)}:59`;
  else if (allHours && minutes.length === 1) time = minutes[0] === 0 ? 'Every hour' : `Every hour at :${pad(minutes[0]!)}`;
  else if (hourStep && minutes.length === 1) time = `Every ${hourStep} hours at :${pad(minutes[0]!)}`;
  else if (hours.length * minutes.length <= 6) time = `At ${hours.flatMap((h) => minutes.map((m) => `${pad(h)}:${pad(m)}`)).join(', ')}`;
  else time = `At minute ${minutes.join(',')} of hour ${hours.join(',')}`;

  const parts = [time];
  const dows = sorted(spec.dow);
  if (!spec.dowAny) {
    if (dows.join() === '1,2,3,4,5') parts.push('on weekdays');
    else if (dows.join() === '0,6') parts.push('on weekends');
    else if (dows.length === 1) parts.push(`on ${DAY_NAMES[dows[0]!]}`);
    else parts.push(`on ${ranges(dows, (d) => SHORT_DAYS[d]!)}`);
  }
  if (!spec.domAny) parts.push(`${spec.dowAny ? '' : 'or '}on day ${ranges(sorted(spec.dom), String)} of the month`);
  if (spec.month.size !== 12) parts.push(`in ${ranges(sorted(spec.month), (m) => MONTH_NAMES[m - 1]!)}`);
  return parts.join(' ');
}

/* ---------- intervals ("every") ---------- */

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** "30s", "15m", "2h", "1d" (also "1h30m") → seconds; undefined when invalid. */
export function parseInterval(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!/^(\d+\s*[smhd]\s*)+$/.test(t)) return undefined;
  let total = 0;
  for (const m of t.matchAll(/(\d+)\s*([smhd])/g)) total += Number(m[1]) * UNITS[m[2]!]!;
  return total > 0 ? total : undefined;
}

export function describeInterval(seconds: number): string {
  const parts: string[] = [];
  let rest = seconds;
  for (const [unit, size, name] of [['d', 86400, 'day'], ['h', 3600, 'hour'], ['m', 60, 'minute'], ['s', 1, 'second']] as const) {
    void unit;
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n} ${name}${n > 1 ? 's' : ''}`);
    rest -= n * size;
  }
  return `Every ${parts.join(' ') || '0 seconds'}`.replace(/^Every 1 (\w+)$/, 'Every $1');
}
