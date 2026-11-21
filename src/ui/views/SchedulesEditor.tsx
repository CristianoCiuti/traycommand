import { CalendarClock, FolderOpen, Plus, Trash2 } from 'lucide-preact';
import type { Action, Schedule, Watch } from '../../shared/config';
import type { WatchStatus } from '../../shared/api';
import { cronError, describeCron, describeInterval, nextCronRuns, parseInterval } from '../../shared/cron';
import { describeWindow, parseDays, windowError } from '../../shared/window';
import { globError, patternList } from '../../shared/glob';
import {
  FILE_EVENTS,
  cleanSchedule,
  cronOf,
  filesText,
  modeOf,
  patchWatch,
  settleOf,
  settleSeconds,
  timesOf,
  toggleEvent,
  watchEvents,
  watchStateText,
  watchText,
  windowTimes,
  withDays,
  withMode,
  withTimes,
  withWindow,
  type ScheduleMode,
} from '../../shared/scheduleForm';
import { api } from '../store';
import { Field, Switch } from '../components/ui';

const DAYS = [
  { n: 1, s: 'Mon' },
  { n: 2, s: 'Tue' },
  { n: 3, s: 'Wed' },
  { n: 4, s: 'Thu' },
  { n: 5, s: 'Fri' },
  { n: 6, s: 'Sat' },
  { n: 0, s: 'Sun' },
];

const fmt = (d: Date) => d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Summary(props: { schedule: Schedule; watch?: WatchStatus }) {
  const s = props.schedule;
  const window = describeWindow(s.between, s.days);
  const tail = window ? `, ${window}` : '';
  if (s.watch) {
    const st = props.watch;
    return (
      <span class="hint" data-testid="watch-summary">
        {watchText(s.watch, props.watch?.path)}
        {tail}
        {st && (
          <>
            {' · '}
            <span class={`watch-state ${st.state}`} data-testid="watch-state">
              {watchStateText(st)}
            </span>
          </>
        )}
      </span>
    );
  }
  if (s.startup) return <span class="hint">Once, when TrayCommand starts{window ? ` (only ${window})` : ''}</span>;
  if (s.every !== undefined) {
    const sec = parseInterval(s.every);
    return <span class="hint">{sec ? `${describeInterval(sec)}, counted from when TrayCommand starts${tail}` : 'Invalid interval'}</span>;
  }
  if (s.cron === undefined) return null;
  const error = cronError(s.cron);
  if (error) return <span class="hint" style={{ color: 'var(--danger)' }}>{error}</span>;
  const next = window ? [] : nextCronRuns(s.cron, 3);
  return (
    <span class="hint">
      {describeCron(s.cron)}
      {tail}
      {next.length > 0 && <> · next: {next.map(fmt).join(', ')}</>}
    </span>
  );
}

function DayButtons(props: { days: number[]; onChange: (days: number[]) => void; testId?: string }) {
  return (
    <span class="days" role="group" aria-label="Days" data-testid={props.testId}>
      {DAYS.map((d) => {
        const on = props.days.includes(d.n);
        return (
          <button class={`day${on ? ' on' : ''}`} aria-pressed={on} onClick={() => props.onChange(on ? props.days.filter((x) => x !== d.n) : [...props.days, d.n])}>
            {d.s}
          </button>
        );
      })}
    </span>
  );
}

/** "Only between 09:00 and 18:00 on Mon…Fri": limits any schedule to a time window. */
function WindowEditor(props: { s: Schedule; onChange: (s: Schedule) => void; i: number }) {
  const { s } = props;
  const on = s.between !== undefined || s.days !== undefined;
  const { from, to } = windowTimes(s.between, on);
  let days: number[] = [0, 1, 2, 3, 4, 5, 6];
  try {
    if (s.days !== undefined) days = [...parseDays(s.days)];
  } catch {
    /* invalid: shown below */
  }
  const problem = windowError(s.between, s.days);
  const setTimes = (a: string, b: string) => props.onChange(withTimes(s, a, b));
  return (
    <div class="window-row" data-testid={`schedule-window-${props.i}`}>
      <Switch
        checked={on}
        onChange={(v) => props.onChange(withWindow(s, v))}
        label="Only in a time window"
        testId={`schedule-window-toggle-${props.i}`}
      />
      {on && (
        <span class="inline">
          <span class="hint">from</span>
          <input class="input mono" type="time" style={{ width: 136 }} value={from} onChange={(e) => setTimes((e.currentTarget as HTMLInputElement).value, to)} aria-label="From" data-testid={`schedule-from-${props.i}`} />
          <span class="hint">to</span>
          <input class="input mono" type="time" style={{ width: 136 }} value={to} onChange={(e) => setTimes(from, (e.currentTarget as HTMLInputElement).value)} aria-label="To" data-testid={`schedule-to-${props.i}`} />
          <DayButtons days={days} onChange={(d) => {
              const next = withDays(s, d);
              if (next) props.onChange(next);
            }} testId={`schedule-window-days-${props.i}`} />
        </span>
      )}
      {problem && <span class="hint" style={{ color: 'var(--danger)' }}>{problem.between ?? problem.days}</span>}
    </div>
  );
}

function WatchEditor(props: { w: Watch; onChange: (w: Watch) => void; i: number }) {
  const { w } = props;
  const events = watchEvents(w);
  const set = (patch: Partial<Watch>) => props.onChange(patchWatch(w, patch));
  const files = filesText(w);
  const badPattern = patternList(w.files).map(globError).find(Boolean);
  const settle = settleSeconds(w);
  return (
    <div class="watch" data-testid={`schedule-watch-${props.i}`}>
      <div class="grid2">
        <Field label="Folder">
          <span class="inline" style={{ display: 'flex', gap: 6 }}>
            <input
              class={`input mono${!w.path.trim() ? ' invalid' : ''}`}
              style={{ flex: 1 }}
              value={w.path}
              placeholder="C:\Users\me\Downloads or ${HOME}/inbox"
              onInput={(e) => set({ path: (e.currentTarget as HTMLInputElement).value })}
              aria-label="Folder to watch"
              data-testid={`watch-path-${props.i}`}
            />
            <button
              class="btn sm"
              onClick={async () => {
                const dir = await api.pickFile({ title: 'Folder to watch', directory: true, defaultPath: w.path || undefined });
                if (dir) set({ path: dir });
              }}
              aria-label="Choose the folder"
              title="Choose the folder"
            >
              <FolderOpen size={14} />
            </button>
          </span>
        </Field>
        <Field label="Files" hint={badPattern ? <span style={{ color: 'var(--danger)' }}>{badPattern}</span> : 'Patterns separated by commas, e.g. *.txt, *.{csv,xlsx}. Empty = every file.'}>
          <input
            class={`input mono${badPattern ? ' invalid' : ''}`}
            value={files}
            placeholder="*.txt"
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              set({ files: v.trim() ? v : undefined });
            }}
            aria-label="File patterns"
            data-testid={`watch-files-${props.i}`}
          />
        </Field>
      </div>
      <div class="watch-options">
        <span class="inline">
          <span class="hint">Run when a file is</span>
          <span class="days" role="group" aria-label="Events" data-testid={`watch-events-${props.i}`}>
            {FILE_EVENTS.map((x) => {
              const on = events.includes(x.e);
              return (
                <button
                  class={`day${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    const next = toggleEvent(events, x.e);
                    if (next !== 'unchanged') set({ events: next });
                  }}
                >
                  {x.s}
                </button>
              );
            })}
          </span>
        </span>
        <span class="inline">
          <span class="hint">after</span>
          <input
            class="input"
            type="number"
            min={1}
            max={3600}
            style={{ width: 64 }}
            value={settle}
            onInput={(e) => set({ settle: settleOf((e.currentTarget as HTMLInputElement).value) })}
            aria-label="Quiet seconds"
            data-testid={`watch-settle-${props.i}`}
          />
          <span class="hint" title="Waits until the folder has been quiet this long, so that files are completely written">s of quiet</span>
        </span>
      </div>
      <div class="watch-options">
        <Switch checked={w.subfolders === true} onChange={(v) => set({ subfolders: v })} label="Sub folders too" testId={`watch-subfolders-${props.i}`} />
        <Switch checked={w.existing === true} onChange={(v) => set({ existing: v })} label="Also the files already there" hint="When watching starts" testId={`watch-existing-${props.i}`} />
        <Switch checked={w.batch === true} onChange={(v) => set({ batch: v })} label="One run for files arriving together" hint="Otherwise one run per file" testId={`watch-batch-${props.i}`} />
      </div>
      <span class="hint">
        The command gets the file in <code>TC_FILE</code> (also <code>TC_FILE_NAME</code>, <code>TC_FILE_DIR</code>, <code>TC_EVENT</code> = add / change / remove, <code>TC_FILES</code> one per line), as environment variables and as <code>{'${TC_FILE}'}</code>.
      </span>
    </div>
  );
}

export function SchedulesEditor(props: {
  value: Schedule[] | undefined;
  watches?: WatchStatus[];
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
    next[i] = cleanSchedule(s);
    set(next);
  };
  const setMode = (i: number, mode: ScheduleMode) => update(i, withMode(list[i]!, mode));
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
              <select class="select" style={{ width: 170 }} value={mode} onChange={(e) => setMode(i, (e.currentTarget as HTMLSelectElement).value as ScheduleMode)} aria-label="Kind of schedule" data-testid={`schedule-mode-${i}`}>
                <option value="times">At set times</option>
                <option value="every">Every…</option>
                <option value="cron">Cron expression</option>
                <option value="startup">At startup</option>
                <option value="watch">When files change</option>
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
                  <DayButtons days={times.days} onChange={(d) => update(i, { ...s, cron: cronOf(times.times, d) })} />
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
            {mode === 'watch' && s.watch && <WatchEditor w={s.watch} i={i} onChange={(w) => update(i, { ...s, watch: w })} />}
            <Summary schedule={s} watch={props.watches?.find((w) => w.index === i)} />
            {mode !== 'times' && <WindowEditor s={s} i={i} onChange={(next) => update(i, next)} />}
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
            'Run this entry automatically: at set times, at an interval, when TrayCommand starts, or when files appear in a folder.'
          )}
        </span>
      </div>
    </div>
  );
}
