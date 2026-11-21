import { CalendarClock, Plus, Trash2 } from 'lucide-preact';
import type { Action, Schedule } from '../../shared/config';
import { cronError, describeCron, describeInterval, nextCronRuns, parseCron, parseInterval } from '../../shared/cron';
import { Field, Switch } from '../components/ui';

type Mode = 'every' | 'times' | 'cron' | 'startup';
const DAYS = [
  { n: 1, s: 'Mon' },
  { n: 2, s: 'Tue' },
  { n: 3, s: 'Wed' },
  { n: 4, s: 'Thu' },
  { n: 5, s: 'Fri' },
  { n: 6, s: 'Sat' },
  { n: 0, s: 'Sun' },
];

/** A cron the "At times" form can show: fixed minutes and hours, any day of month and month. */
function timesOf(cron: string): { times: string[]; days: number[] } | undefined {
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

function cronOf(times: string[], days: number[]): string {
  const parsed = times.map((t) => /^(\d{1,2}):(\d{2})$/.exec(t.trim())).filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60) as RegExpExecArray[];
  const minute = parsed[0] ? Number(parsed[0][2]) : 0;
  const hours = [...new Set(parsed.map((m) => Number(m[1])))].sort((a, b) => a - b);
  const dow = days.length === 7 || !days.length ? '*' : [...days].sort((a, b) => a - b).join(',');
  return `${minute} ${hours.length ? hours.join(',') : '9'} * * ${dow}`;
}

function modeOf(s: Schedule): Mode {
  if (s.startup) return 'startup';
  if (s.every !== undefined) return 'every';
  if (s.cron !== undefined && timesOf(s.cron)) return 'times';
  return 'cron';
}

const fmt = (d: Date) => d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Summary(props: { schedule: Schedule }) {
  const s = props.schedule;
  if (s.startup) return <span class="hint">Once, when TrayCommand starts</span>;
  if (s.every !== undefined) {
    const sec = parseInterval(s.every);
    return <span class="hint">{sec ? `${describeInterval(sec)}, counted from when TrayCommand starts` : 'Invalid interval'}</span>;
  }
  if (s.cron === undefined) return null;
  const error = cronError(s.cron);
  if (error) return <span class="hint" style={{ color: 'var(--danger)' }}>{error}</span>;
  const next = nextCronRuns(s.cron, 3);
  return (
    <span class="hint">
      {describeCron(s.cron)}
      {next.length > 0 && <> · next: {next.map(fmt).join(', ')}</>}
    </span>
  );
}

export function SchedulesEditor(props: {
  value: Schedule[] | undefined;
  onChange: (v: Schedule[] | undefined) => void;
  isToggle: boolean;
  hasOff: boolean;
  hasRight: boolean;
  action: Action | undefined;
}) {
  const list = props.value ?? [];
  const set = (next: Schedule[]) => props.onChange(next.length ? next : undefined);
  const update = (i: number, s: Schedule) => {
    const next = [...list];
    const clean = { ...s };
    for (const k of Object.keys(clean) as (keyof Schedule)[]) if (clean[k] === undefined) delete clean[k];
    next[i] = clean;
    set(next);
  };
  const setMode = (i: number, mode: Mode) => {
    const { cron: _c, every: _e, startup: _s, ...rest } = list[i]!;
    void _c;
    void _e;
    void _s;
    update(i, mode === 'every' ? { ...rest, every: '15m' } : mode === 'startup' ? { ...rest, startup: true } : mode === 'times' ? { ...rest, cron: '0 9 * * 1-5' } : { ...rest, cron: list[i]!.cron ?? '*/30 9-18 * * 1-5' });
  };
  const inputs = props.action?.inputs ?? [];

  return (
    <div class="card-body schedules" data-testid="schedules">
      {list.map((s, i) => {
        const mode = modeOf(s);
        const times = s.cron !== undefined ? timesOf(s.cron) : undefined;
        const everyMatch = /^(\d+)\s*([smhd])$/.exec(s.every ?? '');
        return (
          <div class={`schedule${s.disabled ? ' off' : ''}`} data-testid="schedule">
            <div class="schedule-head">
              <select class="select" style={{ width: 150 }} value={mode} onChange={(e) => setMode(i, (e.currentTarget as HTMLSelectElement).value as Mode)} aria-label="Kind of schedule" data-testid={`schedule-mode-${i}`}>
                <option value="times">At set times</option>
                <option value="every">Every…</option>
                <option value="cron">Cron expression</option>
                <option value="startup">At startup</option>
              </select>

              {mode === 'every' && (
                <span class="inline">
                  <input
                    class="input"
                    type="number"
                    min={1}
                    style={{ width: 80 }}
                    value={everyMatch ? everyMatch[1] : ''}
                    placeholder={s.every}
                    onInput={(e) => update(i, { ...s, every: `${Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)}${everyMatch?.[2] ?? 'm'}` })}
                    aria-label="Interval"
                    data-testid={`schedule-every-${i}`}
                  />
                  <select class="select" style={{ width: 110 }} value={everyMatch?.[2] ?? 'm'} onChange={(e) => update(i, { ...s, every: `${everyMatch?.[1] ?? '15'}${(e.currentTarget as HTMLSelectElement).value}` })} aria-label="Unit">
                    <option value="s">seconds</option>
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                    <option value="d">days</option>
                  </select>
                </span>
              )}

              {mode === 'times' && times && (
                <span class="inline">
                  <input
                    class="input mono"
                    style={{ width: 150 }}
                    value={times.times.join(', ')}
                    placeholder="09:00, 13:00"
                    title="One or more times, separated by commas (same minutes)"
                    onChange={(e) => update(i, { ...s, cron: cronOf((e.currentTarget as HTMLInputElement).value.split(','), times.days) })}
                    aria-label="Times"
                    data-testid={`schedule-times-${i}`}
                  />
                  <span class="days" role="group" aria-label="Days">
                    {DAYS.map((d) => {
                      const on = times.days.includes(d.n);
                      return (
                        <button
                          class={`day${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => update(i, { ...s, cron: cronOf(times.times, on ? times.days.filter((x) => x !== d.n) : [...times.days, d.n]) })}
                        >
                          {d.s}
                        </button>
                      );
                    })}
                  </span>
                </span>
              )}

              {mode === 'cron' && (
                <input
                  class={`input mono${s.cron && cronError(s.cron) ? ' invalid' : ''}`}
                  style={{ flex: 1 }}
                  value={s.cron ?? ''}
                  placeholder="minute hour day month weekday"
                  onInput={(e) => update(i, { ...s, cron: (e.currentTarget as HTMLInputElement).value })}
                  aria-label="Cron expression"
                  data-testid={`schedule-cron-${i}`}
                />
              )}

              <span style={{ flex: 1 }} />
              <Switch checked={!s.disabled} onChange={(v) => update(i, { ...s, disabled: v ? undefined : true })} />
              <button class="btn ghost sm icon danger" onClick={() => set(list.filter((_, j) => j !== i))} aria-label="Remove schedule">
                <Trash2 size={14} />
              </button>
            </div>
            <Summary schedule={s} />
            {(props.isToggle || props.hasRight || inputs.length > 0) && (
              <div class="grid3">
                {(props.isToggle || props.hasRight) && (
                  <Field label="Runs">
                    <select class="select" value={s.run ?? 'click'} onChange={(e) => update(i, { ...s, run: (e.currentTarget as HTMLSelectElement).value === 'click' ? undefined : ((e.currentTarget as HTMLSelectElement).value as Schedule['run']) })}>
                      <option value="click">Like a click{props.isToggle ? ' (switches)' : ''}</option>
                      {props.isToggle && <option value="on">Turn on (if OFF)</option>}
                      {props.isToggle && props.hasOff && <option value="off">Turn off (if ON)</option>}
                      {props.hasRight && <option value="right">Right click action</option>}
                    </select>
                  </Field>
                )}
                {inputs.map((input) => {
                  const value = s.values?.[input.name] ?? '';
                  const setValue = (v: string) => {
                    const values = { ...s.values };
                    if (v === '') delete values[input.name];
                    else values[input.name] = v;
                    update(i, { ...s, values: Object.keys(values).length ? values : undefined });
                  };
                  const fallback = input.type === 'checkbox' ? (input.default === true || input.default === 'true' ? 'on' : 'off') : input.default !== undefined ? String(input.default) : undefined;
                  const hint = fallback !== undefined ? `Empty = default (${fallback})` : input.optional || input.type === 'checkbox' ? 'Can be empty' : 'Required: scheduled runs never ask';
                  const options = (input.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }));
                  return (
                    <Field label={input.label ?? input.name} hint={hint}>
                      {input.type === 'checkbox' ? (
                        <select class="select" value={value} onChange={(e) => setValue((e.currentTarget as HTMLSelectElement).value)}>
                          <option value="">Default</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : input.type === 'select' && options.length ? (
                        <select class="select" value={value} onChange={(e) => setValue((e.currentTarget as HTMLSelectElement).value)}>
                          <option value="">{fallback !== undefined ? 'Default' : '(choose)'}</option>
                          {options.map((o) => (
                            <option value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input class="input" type={input.type === 'password' ? 'password' : 'text'} value={value} onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} />
                      )}
                    </Field>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div class="row" style={{ alignItems: 'center' }}>
        <button class="btn sm" onClick={() => set([...list, { cron: '0 9 * * 1-5' }])} data-testid="add-schedule">
          <Plus size={14} /> Add schedule
        </button>
        <span class="hint">
          {list.length ? (
            <>
              <CalendarClock size={12} style={{ verticalAlign: -2 }} /> Scheduled runs never ask for confirmation or values; runs missed while the PC was off are skipped.
            </>
          ) : (
            'Run this entry automatically: at set times, at an interval, or when TrayCommand starts.'
          )}
        </span>
      </div>
    </div>
  );
}
