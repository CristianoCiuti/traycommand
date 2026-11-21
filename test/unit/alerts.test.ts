/* "Only if" checks and alerts of schedules: configuration, engine, presentation, editor logic. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { Alerts, type AlertDeps } from '../../src/main/alerts';
import { ConfigSchema, parseConfig, type ConfigInput, type Schedule } from '../../src/shared/config';
import type { RunOptions, RunResult } from '../../src/main/runner';
import type { AlertRequest, ExecutionLog, PromptRequest } from '../../src/shared/api';
import {
  alertKey,
  choiceKind,
  choiceRun,
  choiceTarget,
  defaultIndex,
  removeChoice,
  conditionFields,
  formatCountdown,
  newChoice,
  patchAlert,
  renameChoice,
  timeoutParts,
  withAlert,
  withChoiceKind,
  withCondition,
} from '../../src/shared/scheduleForm';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], responder: (script: string, o: RunOptions) => RunResult | Promise<RunResult> = () => res(), extra: Partial<EngineDeps> = {}) {
  const calls: { script: string; o: RunOptions }[] = [];
  const logs: ExecutionLog[] = [];
  const alerts: AlertRequest[] = [];
  const closed: number[] = [];
  const notify = vi.fn();
  let answer: (r: AlertRequest) => Promise<number | undefined> = async () => undefined;
  const deps: EngineDeps = {
    run: async (script, o) => {
      calls.push({ script, o });
      return responder(script, o);
    },
    runAdmin: async () => res(),
    notify,
    confirm: async () => true,
    log: (l) => logs.push(l),
    env: {},
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    alert: (r) => {
      alerts.push(r);
      return answer(r);
    },
    closeAlert: (id) => closed.push(id),
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
  engine.start();
  return {
    engine,
    calls,
    logs,
    alerts,
    closed,
    notify,
    answerWith: (fn: (r: AlertRequest) => Promise<number | undefined>) => (answer = fn),
    fire: (id: string, schedule: Schedule, values?: Record<string, string>) => engine.fireSchedule(engine.get(id)!, schedule, values),
  };
}

afterEach(() => vi.useRealTimers());

describe('configuration', () => {
  const check = (schedules: object[], extraTrays: object[] = []) => {
    const r = parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', schedules }, ...extraTrays] as never });
    return { ok: r.ok, issues: r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`), warnings: r.ok ? r.warnings.map((w) => `${w.path}: ${w.message}`) : [] };
  };

  it('accepts checks and alerts', () => {
    const r = check(
      [
        { every: '1m', if: 'Test-Path x' },
        { every: '1m', if: { check: 'git status', on: 'clean', off: 'error', timeout: 10 } },
        { every: '1m', if: { check: 'plain', timeout: 10 } },
        {
          watch: { path: 'in' },
          alert: { style: 'notification', title: 'New ${TC_FILE_NAME}', text: 'What now?', timeout: '2m', default: 'Archive', choices: [{ label: 'Archive', action: 'mv' }, { label: 'Run', run: 'self' }, { label: 'Other', run: 'b:off' }] },
        },
        { every: '1h', alert: { text: 'Stand up!' } },
      ],
      [{ id: 'b', label: 'B', action: 'b', offAction: 'c' }],
    );
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reports what is wrong', () => {
    const r = check([
      { every: '1m', if: ' ' },
      { every: '1m', if: { check: '', on: '(' , off: '[' } },
      { every: '1m', alert: {} },
      {
        every: '1m',
        alert: {
          timeout: '2s',
          default: 'Nope',
          choices: [{ label: 'A', run: 'self' }, { label: 'A', action: 'x' }, { label: ' ', run: 'self', action: 'y' }, { label: 'B' }, { label: 'C', run: 'bad id!' }],
        },
      },
      { every: '1m', alert: { text: 'x', timeout: 'soon' } },
      { every: '1m', alert: { text: 'x', timeout: '2d' } },
      { every: '1m', alert: { choices: [{ label: 'Go', run: 'ghost' }] } },
    ]);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        'trays[0].schedules[0].if: Write the check command',
        'trays[0].schedules[1].if.check: Write the check command',
        expect.stringMatching(/^trays\[0\]\.schedules\[1\]\.if\.on: Invalid regular expression/),
        expect.stringMatching(/^trays\[0\]\.schedules\[1\]\.if\.off: Invalid regular expression/),
        'trays[0].schedules[2].alert: Write a message or add choices',
        'trays[0].schedules[3].alert.choices: At most 4 choices',
        'trays[0].schedules[3].alert.choices[1].label: Two choices are called "A"',
        'trays[0].schedules[3].alert.choices[2].label: Write the text of the button',
        'trays[0].schedules[3].alert.choices[2]: Set exactly one of run or action',
        'trays[0].schedules[3].alert.choices[3]: Set exactly one of run or action',
        'trays[0].schedules[3].alert.choices[4].run: Use "self" or an entry id, optionally with :on, :off or :right',
        'trays[0].schedules[3].alert.timeout: Between 5 seconds and 1 day',
        'trays[0].schedules[3].alert.default: No choice is called "Nope"',
        'trays[0].schedules[4].alert.timeout: Use a number and a unit: "30s", "5m", "1h"',
        'trays[0].schedules[5].alert.timeout: Between 5 seconds and 1 day',
        'trays[0].schedules[6].alert.choices[0].run: Unknown id "ghost"',
      ]),
    );
  });

  it('an alert without "self" needs no action on the entry; a default without timeout is a warning', () => {
    const r = parseConfig({
      version: 2,
      trays: [
        { id: 'm', label: 'M', menu: [{ id: 'x', label: 'X', action: 'x' }], schedules: [{ every: '1m', alert: { default: 'Go', choices: [{ label: 'Go', run: 'x' }] } }] },
        { id: 'n', label: 'N', menu: [], schedules: [{ every: '1m', alert: { choices: [{ label: 'Me', run: 'self' }] } }] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(['trays[1].schedules[0].run']);
    const w = parseConfig({ version: 2, trays: [{ id: 'm', label: 'M', menu: [{ id: 'x', label: 'X', action: 'x' }], schedules: [{ every: '1m', alert: { default: 'Go', choices: [{ label: 'Go', run: 'x' }] } }] }] });
    expect(w.ok && w.warnings.map((x) => x.message)).toEqual(['The default choice is used only with a timeout']);
  });
});

describe('engine: only if', () => {
  it('runs only when the check passes; the check gets the values', async () => {
    let pass = false;
    const { calls, fire, logs } = setup([{ id: 'a', label: 'A', action: 'go ${TC_FILE}' }], (s) => (s.startsWith('check') ? res({ code: pass ? 0 : 1 }) : res()));
    await fire('a', { every: '1m', if: 'check ${TC_FILE}' }, { TC_FILE: 'f.txt' });
    expect(calls.map((c) => c.script)).toEqual(['check f.txt']);
    expect(calls[0]!.o.env).toMatchObject({ TC_FILE: 'f.txt' });
    expect(calls[0]!.o.timeout).toBe(60);
    expect(logs).toEqual([]); // a negative check is not an error
    pass = true;
    await fire('a', { every: '1m', if: 'check ${TC_FILE}' }, { TC_FILE: 'f.txt' });
    expect(calls.map((c) => c.script)).toEqual(['check f.txt', 'check f.txt', 'go f.txt']);
  });

  it('patterns, shell and timeout like a toggle', async () => {
    const out: Record<string, string> = { a: 'status: ready', b: 'status: ready, error', c: 'status: waiting' };
    const { calls, fire } = setup([{ id: 'a', label: 'A', action: 'go' }], (s) => res({ stdout: out[s.slice(-1)] ?? '' }));
    for (const k of ['a', 'b', 'c']) await fire('a', { every: '1m', if: { check: `chk ${k}`, on: 'ready', off: 'error', shell: 'bash', timeout: 5 } });
    expect(calls.filter((c) => c.script === 'go')).toHaveLength(1);
    expect(calls[0]!.o).toMatchObject({ shell: 'bash', timeout: 5 });
  });

  it('a check that cannot run is logged and notified; an invalid pattern fails', async () => {
    const { calls, fire, logs, notify } = setup([{ id: 'a', label: 'A', action: 'go' }], (s) =>
      s === 'slow' ? res({ code: null, timedOut: true }) : s === 'broken' ? Promise.reject(new Error('no shell')) : s === 'odd' ? Promise.reject('plain') : res(),
    );
    await fire('a', { every: '1m', if: { check: 'slow', timeout: 3 } });
    await fire('a', { every: '1m', if: 'broken' });
    await fire('a', { every: '1m', if: 'odd' });
    await fire('a', { every: '1m', if: { check: 'ok', on: '(' } });
    await fire('a', { every: '1m', if: 'slow' });
    expect(logs.map((l) => l.error)).toEqual(['Check not run: timed out after 3s', 'Check not run: no shell', 'Check not run: plain', 'Check not run: timed out after 60s']);
    expect(notify).toHaveBeenCalledTimes(4);
    expect(calls.map((c) => c.script)).toEqual(['slow', 'broken', 'odd', 'ok', 'slow']);
  });
});

describe('engine: alerts', () => {
  const trays: ConfigInput['trays'] = [
    { id: 'a', label: 'Scans', icon: 'scan.png', action: { run: 'self ${TC_FILE}', confirm: 'Sure?' } },
    { id: 'b', label: 'Other', action: 'other-on ${TC_FILE}', offAction: 'other-off', rightAction: 'other-right' },
    { id: 'menu', label: 'Menu', menu: [{ id: 'sub', label: 'Sub', action: 'sub' }] },
  ];
  const alert = (o: object = {}): Schedule => ({
    every: '1m',
    alert: {
      title: 'New ${TC_FILE}',
      text: '${TC_FILE} arrived',
      choices: [{ label: 'Process', run: 'self' }, { label: 'Other ${TC_FILE}', run: 'b' }, { label: 'Off', run: 'b:off' }, { label: 'Archive', action: 'archive "$env:TC_FILE"' }],
      ...o,
    },
  });

  it('shows the alert with the values and runs the choice, as chosen by a person', async () => {
    const { calls, fire, alerts, answerWith, logs } = setup(trays);
    answerWith(async () => 0);
    await fire('a', alert(), { TC_FILE: 'x.pdf' });
    expect(alerts[0]).toMatchObject({ style: 'window', title: 'New x.pdf', text: 'x.pdf arrived', choices: ['Process', 'Other x.pdf', 'Off', 'Archive'], icon: 'C:\\cfg\\scan.png' });
    expect(alerts[0]!.deadline).toBeUndefined();
    expect(calls.map((c) => c.script)).toEqual(['self x.pdf']);
    expect(logs[0]!.source).toBe('alert');
    for (const i of [1, 2, 3]) {
      answerWith(async () => i);
      await fire('a', alert(), { TC_FILE: 'y.pdf' });
    }
    expect(calls.map((c) => c.script)).toEqual(['self x.pdf', 'other-on y.pdf', 'other-off', 'archive "$env:TC_FILE"']);
    expect(calls[3]!.o.env).toMatchObject({ TC_FILE: 'y.pdf' });
    expect(logs.at(-1)!.label).toBe('Scans › Archive');
  });

  it('dismissed: nothing runs; a choice whose target cannot run is skipped', async () => {
    const { calls, fire, answerWith } = setup(trays);
    await fire('a', alert());
    answerWith(async () => 0);
    await fire('menu', { every: '1m', alert: { choices: [{ label: 'Me', run: 'self' }, { label: 'Ghost', run: 'ghost' }, { label: 'Sub', run: 'sub' }] } });
    answerWith(async () => 1);
    await fire('menu', { every: '1m', alert: { choices: [{ label: 'Ghost', run: 'ghost' }, { label: 'Me', run: 'self' }] } });
    answerWith(async () => 0);
    await fire('menu', { every: '1m', alert: { choices: [{ label: 'Off', run: 'sub:off' }, { label: 'Me', run: 'self' }] } });
    answerWith(async () => 5); // an answer that is not a choice
    await fire('menu', { every: '1m', alert: { choices: [{ label: 'Sub', run: 'sub' }] } });
    expect(calls).toEqual([]);
    // a command choice of an entry without id
    const noId = setup([{ id: 'm', label: 'M', menu: [{ label: 'Child', action: 'c' }] }]);
    noId.answerWith(async () => 0);
    await noId.fire('trays[0].menu[0]', { every: '1m', alert: { choices: [{ label: 'Cmd', action: 'cmd' }] } });
    expect(noId.calls.map((c) => c.script)).toEqual(['cmd']);
    // only "self" choices and nothing to run: the alert is not even shown
    const { alerts, fire: fire2 } = setup([{ id: 't', label: 'T', state: { check: 'c' }, action: 'up' }]);
    await fire2('t', { every: '1m', run: 'on', alert: { choices: [{ label: 'Go', run: 'self' }] } });
    expect(alerts).toEqual([]);
    // an alert with no choices informs even when the entry has nothing to run
    await fire2('t', { every: '1m', run: 'on', alert: { text: 'Hello' } });
    expect(alerts).toHaveLength(1);
  });

  it('timeout: the default runs unattended (no confirmation), the alert is closed', async () => {
    vi.useFakeTimers();
    const { calls, fire, alerts, closed, logs, answerWith } = setup(trays);
    answerWith(() => new Promise(() => undefined)); // nobody answers
    const done = fire('a', alert({ timeout: '30s', default: 'Process' }), { TC_FILE: 'z' });
    await vi.advanceTimersByTimeAsync(0);
    expect(alerts[0]!.deadline).toBe(Date.now() + 30_000);
    expect(alerts[0]!.defaultChoice).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(closed).toEqual([alerts[0]!.id]);
    expect(calls.map((c) => c.script)).toEqual(['self z']);
    expect(logs[0]!.source).toBe('schedule');
    // without a default: closed, nothing runs
    const later = fire('a', alert({ timeout: '10s' }));
    await vi.advanceTimersByTimeAsync(10_000);
    await later;
    expect(calls).toHaveLength(1);
  });

  it('a choice made by a person asks the confirmation and the values', async () => {
    const confirm = vi.fn(async () => false);
    const prompt = vi.fn(async () => ({ NAME: 'n' }));
    const { calls, fire, answerWith } = setup(
      [{ id: 'a', label: 'A', action: { run: 'self', confirm: 'Sure?' } }],
      () => res(),
      { confirm, prompt },
    );
    answerWith(async () => 0);
    await fire('a', { every: '1m', alert: { choices: [{ label: 'Go', run: 'self' }] } });
    expect(confirm).toHaveBeenCalled();
    expect(calls).toEqual([]);
    answerWith(async () => 0);
    await fire('a', { every: '1m', alert: { choices: [{ label: 'Named', action: { run: 'named ${NAME}', inputs: [{ name: 'NAME' }] } }] } });
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'A › Named' }));
    expect(calls.map((c) => c.script)).toEqual(['named n']);
    // a form cancelled, and a required value missing after a timeout
    prompt.mockResolvedValueOnce(undefined as never);
    await fire('a', { every: '1m', alert: { choices: [{ label: 'Named', action: { run: 'named ${NAME}', inputs: [{ name: 'NAME' }] } }] } });
    expect(calls).toHaveLength(1);
  });

  it('a choice with a missing value after a timeout fails clearly; a busy entry is not run twice', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const { calls, fire, logs, notify, engine, answerWith } = setup([{ id: 'a', label: 'A', action: 'slow' }], (s) => (s === 'slow' ? new Promise((r) => (release = () => r(res()))) : res()));
    answerWith(() => new Promise(() => undefined));
    const t = fire('a', { every: '1m', alert: { timeout: '5s', default: 'Named', choices: [{ label: 'Named', action: { run: 'n ${NAME}', inputs: [{ name: 'NAME' }] } }] } });
    await vi.advanceTimersByTimeAsync(5000);
    await t;
    expect(logs[0]!.error).toMatch(/NAME: no value/);
    // the alert is open, meanwhile the entry is started by a click: the choice waits for it, then runs
    let answer!: (i: number) => void;
    answerWith(() => new Promise((r) => (answer = r)));
    const open = fire('a', { every: '1m', alert: { choices: [{ label: 'Cmd', action: 'cmd' }] } });
    await vi.advanceTimersByTimeAsync(0);
    const click = engine.click('a');
    await vi.advanceTimersByTimeAsync(0);
    answer(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map((c) => c.script)).toEqual(['slow']); // still waiting
    release();
    await click;
    await vi.advanceTimersByTimeAsync(300);
    await open;
    expect(calls.map((c) => c.script)).toEqual(['slow', 'cmd']);
    expect(notify).not.toHaveBeenCalledWith('A › Cmd', expect.anything(), 'warning');
    // and a schedule does not start at all while the entry is busy
    const again = engine.click('a');
    await vi.advanceTimersByTimeAsync(0);
    await fire('a', { every: '1m', alert: { choices: [{ label: 'Cmd', action: 'cmd' }] } });
    expect(logs.at(-1)!.error).toBe('Skipped: the previous run is still going');
    release();
    await again;
  });

  it('a window is not shown twice; a newer notification replaces the older one', async () => {
    const pending: ((v: number | undefined) => void)[] = [];
    const { fire, alerts, closed, calls, answerWith } = setup(trays);
    answerWith((r) => new Promise((resolve) => pending.push(resolve)));
    const schedule = alert();
    const first = fire('a', schedule);
    await new Promise((r) => setTimeout(r, 0));
    await fire('a', schedule); // still open: skipped
    expect(alerts).toHaveLength(1);
    pending[0]!(0);
    await first;
    expect(calls.map((c) => c.script)).toEqual(['self ${TC_FILE}']); // no value: left as written
    const note = alert({ style: 'notification' });
    const n1 = fire('a', note);
    await new Promise((r) => setTimeout(r, 0));
    const n2 = fire('a', note);
    await new Promise((r) => setTimeout(r, 0));
    await n1; // replaced: dismissed
    expect(closed).toEqual([alerts[1]!.id]);
    expect(alerts.map((a) => a.style)).toEqual(['window', 'notification', 'notification']);
    pending[2]!(3);
    await n2;
    expect(calls.map((c) => c.script)).toEqual(['self ${TC_FILE}', 'archive "$env:TC_FILE"']);
    pending[1]!(0); // the old notification answered late: ignored
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
  });

  it('saving the configuration closes the alerts; an answer after that runs nothing', async () => {
    const pending: ((v: number | undefined) => void)[] = [];
    const { engine, fire, closed, calls, answerWith, alerts } = setup(trays);
    answerWith(() => new Promise((resolve) => pending.push(resolve)));
    const open = fire('a', alert());
    await new Promise((r) => setTimeout(r, 0));
    engine.stop();
    await open;
    expect(closed).toEqual([alerts[0]!.id]);
    pending[0]!(0);
    expect(calls).toEqual([]);
    // answered after a reload (the alert was not closed by the screen)
    const again = setup(trays, () => res(), { closeAlert: undefined });
    again.answerWith(() => new Promise((resolve) => pending.push(resolve)));
    const p = again.fire('a', alert());
    await new Promise((r) => setTimeout(r, 0));
    again.engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
    again.engine.start();
    pending[1]!(0);
    await p;
    expect(again.calls).toEqual([]);
  });

  it('no screen: as if nobody answered; an alert that fails to show is notified', async () => {
    vi.useFakeTimers();
    const headless = setup(trays, () => res(), { alert: undefined });
    const t = headless.fire('a', alert({ timeout: '5s', default: 'Process' }));
    await vi.advanceTimersByTimeAsync(0);
    await t;
    expect(headless.calls.map((c) => c.script)).toEqual(['self ${TC_FILE}']);
    await headless.fire('a', alert());
    expect(headless.calls).toHaveLength(1);
    const broken = setup(trays);
    broken.answerWith(() => Promise.reject(new Error('no window')));
    await broken.fire('a', alert());
    broken.answerWith(() => Promise.reject('plain'));
    await broken.fire('a', alert());
    expect(broken.notify.mock.calls.map((c) => c[1])).toEqual(['Failed: the alert could not be shown: no window', 'Failed: the alert could not be shown: plain']);
    expect(broken.calls).toEqual([]);
  });

  it('the check runs before the alert; the title defaults to the entry', async () => {
    const { fire, alerts, calls, answerWith } = setup(trays, (s) => res({ code: s === 'no' ? 1 : 0 }));
    answerWith(async () => undefined);
    await fire('a', { every: '1m', if: 'no', alert: { text: 'x' } });
    expect(alerts).toEqual([]);
    await fire('a', { every: '1m', if: 'yes', alert: { text: 'x' } });
    expect(alerts[0]!.title).toBe('Scans');
    expect(alerts[0]!.text).toBe('x');
    expect(calls.map((c) => c.script)).toEqual(['no', 'yes']);
    await fire('menu', { every: '1m', alert: { choices: [{ label: 'S', run: 'sub' }] } });
    expect(alerts[1]).toMatchObject({ subtitle: undefined, text: undefined, icon: undefined });
  });

  it('a watch with an alert asks once per file, one after the other', async () => {
    const order: string[] = [];
    const { fire, answerWith } = setup(trays);
    answerWith(async (r) => {
      order.push(r.text!);
      await new Promise((x) => setTimeout(x, 5));
      return undefined;
    });
    const schedule = alert();
    await Promise.all([fire('a', schedule, { TC_FILE: '1' }), fire('a', schedule, { TC_FILE: '2' })]);
    // the same schedule object: the second is skipped while the first window is open
    expect(order).toEqual(['1 arrived']);
  });
});

describe('alerts on screen', () => {
  function make(o: Partial<AlertDeps> = {}) {
    const windows: PromptRequest[] = [];
    let answer: Record<string, string> | undefined;
    const notes: { title: string; body: string; onClick: () => void; closed: boolean }[] = [];
    const dismissed: number[] = [];
    const deps: AlertDeps = {
      window: async (r) => {
        windows.push(r);
        return answer;
      },
      dismissWindow: (id) => dismissed.push(id),
      notification: (n) => {
        const shown = { ...n, closed: false };
        notes.push(shown);
        return { close: () => (shown.closed = true) };
      },
      icon: (f) => (f ? `url:${f}` : undefined),
      ...o,
    };
    return { alerts: new Alerts(deps), windows, notes, dismissed, setAnswer: (a: Record<string, string> | undefined) => (answer = a) };
  }
  const req = (o: Partial<AlertRequest> = {}): AlertRequest => ({ id: 7, style: 'window', title: 'T', choices: ['A', 'B'], ...o });

  it('a window: the answer is the index of the choice', async () => {
    const { alerts, windows, setAnswer } = make();
    setAnswer({ choice: '1' });
    expect(await alerts.show(req({ icon: 'i.png', text: 'x', deadline: 5, defaultChoice: 0, subtitle: 's' }))).toBe(1);
    expect(windows[0]).toEqual({ id: 7, title: 'T', subtitle: 's', icon: 'url:i.png', fields: [], submitLabel: 'OK', alert: { text: 'x', choices: ['A', 'B'], defaultChoice: 0, deadline: 5 } });
    for (const bad of [undefined, {}, { choice: 'x' }, { choice: '5' }, { choice: '-1' }, { choice: '1.5' }]) {
      setAnswer(bad as never);
      expect(await alerts.show(req())).toBeUndefined();
    }
  });

  it('a notification: its click shows the window; without choices it only informs', async () => {
    const { alerts, notes, windows, setAnswer, dismissed } = make();
    setAnswer({ choice: '0' });
    const p = alerts.show(req({ style: 'notification', text: 'Arrived' }));
    expect(notes[0]).toMatchObject({ title: 'T', body: 'Arrived\nClick to choose: A · B' });
    expect(windows).toEqual([]);
    notes[0]!.onClick();
    expect(await p).toBe(0);
    notes[0]!.onClick(); // a second click: nothing more
    expect(windows).toHaveLength(1);
    expect(await alerts.show(req({ style: 'notification', choices: [], text: 'Info' }))).toBeUndefined();
    expect(notes[1]!.body).toBe('Info');
    notes[1]!.onClick();
    expect(windows).toHaveLength(1);
    // closed by the engine (timeout): the notification goes, a later click does nothing
    const q = alerts.show(req({ id: 9, style: 'notification' }));
    alerts.close(9);
    expect(notes[2]!.closed).toBe(true);
    expect(dismissed).toEqual([9]);
    notes[2]!.onClick();
    expect(windows).toHaveLength(1);
    void q;
  });

  it('no notifications on this system: the window directly', async () => {
    const { alerts, windows, setAnswer } = make({ notification: () => undefined });
    setAnswer({ choice: '1' });
    expect(await alerts.show(req({ style: 'notification' }))).toBe(1);
    expect(windows).toHaveLength(1);
  });
});

describe('editor logic', () => {
  it('the check fields', () => {
    expect(conditionFields(undefined)).toEqual({ check: '', on: '', off: '' });
    expect(conditionFields('x')).toEqual({ check: 'x', on: '', off: '' });
    expect(conditionFields({ check: 'x', on: 'a' })).toEqual({ check: 'x', on: 'a', off: '' });
    expect(conditionFields({ check: 'x', off: 'b' })).toEqual({ check: 'x', on: '', off: 'b' });
    expect(withCondition({ every: '1m', if: 'x' }, undefined).if).toBeUndefined();
    expect(withCondition({ every: '1m' }, { check: 'c', on: '', off: '' }).if).toBe('c');
    expect(withCondition({ every: '1m' }, { check: 'c', on: 'a', off: 'b' }).if).toEqual({ check: 'c', on: 'a', off: 'b' });
    // shell and timeout written by hand are kept
    expect(withCondition({ every: '1m', if: { check: 'c', shell: 'bash', timeout: 5 } }, { check: 'd', on: '', off: '' }).if).toEqual({ check: 'd', shell: 'bash', timeout: 5 });
  });

  it('the alert fields', () => {
    expect(withAlert({ every: '1m' }, true).alert).toEqual({ text: '', choices: [{ label: 'Run', run: 'self' }] });
    expect(withAlert({ every: '1m', alert: { text: 'x' } }, false).alert).toBeUndefined();
    const a = { text: 'x', choices: [{ label: 'A', run: 'self' }, { label: 'B', action: 'b' }], default: 'A', timeout: '1m' };
    expect(patchAlert(a, { style: 'window', title: '', timeout: '' })).toEqual({ text: 'x', choices: a.choices, default: 'A' });
    expect(patchAlert(a, { style: 'notification' }).style).toBe('notification');
    expect(patchAlert(a, { choices: [] })).toEqual({ text: 'x', timeout: '1m' }); // the default went with its choice
    expect(renameChoice(a, 0, 'A2')).toMatchObject({ default: 'A2', choices: [{ label: 'A2' }, { label: 'B' }] });
    expect(renameChoice(a, 1, 'B2')).toMatchObject({ default: 'A' });
    expect(renameChoice({ text: 'x' }, 0, 'Z')).toEqual({ text: 'x' });
    expect(choiceKind({ label: 'x', run: 'self' })).toBe('self');
    expect(choiceKind({ label: 'x' })).toBe('self');
    expect(choiceKind({ label: 'x', run: 'b' })).toBe('entry');
    expect(choiceKind({ label: 'x', action: 'y' })).toBe('command');
    expect(withChoiceKind({ label: 'x', action: 'y' }, 'self', 'b')).toEqual({ label: 'x', run: 'self' });
    expect(withChoiceKind({ label: 'x' }, 'entry', 'b')).toEqual({ label: 'x', run: 'b' });
    expect(withChoiceKind({ label: 'x' }, 'entry', undefined)).toEqual({ label: 'x', run: '' });
    expect(withChoiceKind({ label: 'x' }, 'command', 'b')).toEqual({ label: 'x', action: '' });
    expect(newChoice([])).toEqual({ label: 'Choice 1', run: 'self' });
    expect(newChoice([{ label: 'Choice 2', run: 'self' }])).toEqual({ label: 'Choice 3', run: 'self' });
    expect(timeoutParts('2m')).toEqual({ n: 2, unit: 'm' });
    expect(timeoutParts('90s')).toEqual({ n: 90, unit: 's' });
    expect(timeoutParts('1h30m')).toEqual({ n: 90, unit: 'm' });
    expect(timeoutParts('1d')).toEqual({ n: 24, unit: 'h' });
    expect(timeoutParts('2h')).toEqual({ n: 2, unit: 'h' });
    expect(timeoutParts('bad')).toBeUndefined();
    expect(timeoutParts(undefined)).toBeUndefined();
    expect(choiceTarget('b:off')).toEqual({ id: 'b', how: 'off' });
    expect(choiceTarget('b')).toEqual({ id: 'b', how: '' });
    expect(choiceTarget(undefined)).toEqual({ id: '', how: '' });
    expect(choiceRun('b', 'right')).toBe('b:right');
    expect(choiceRun('b', '')).toBe('b');
    // removing buttons: the default goes with its button, or stays on its button
    const three = { text: 'x', timeout: '1m', default: 'B', choices: [{ label: 'A', run: 'self' }, { label: 'B', run: 'self' }, { label: 'C', run: 'self' }] };
    expect(removeChoice(three, 0)).toMatchObject({ default: 'B', choices: [{ label: 'B' }, { label: 'C' }] });
    expect(removeChoice(three, 1).default).toBeUndefined();
    expect(removeChoice({ text: 'x' }, 0)).toEqual({ text: 'x' });
    expect(defaultIndex({ text: 'x' })).toBe(-1);
    // the default survives an empty label while it is being retyped
    expect(renameChoice(three, 1, '')).toMatchObject({ default: '' });
  });

  it('countdown and keys of the alert window', () => {
    expect(formatCountdown(41_200)).toBe('0:42');
    expect(formatCountdown(725_000)).toBe('12:05');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(alertKey('Enter', 3, 1, 0, false)).toEqual({ type: 'block' });
    expect(alertKey('Escape', 3, 1, 0, false)).toEqual({ type: 'block' });
    expect(alertKey('Tab', 3, 1, 0, false)).toEqual({ type: 'none' });
    expect(alertKey('Escape', 3, 1, 0, true)).toEqual({ type: 'dismiss' });
    expect(alertKey('ArrowRight', 3, 2, 0, true)).toEqual({ type: 'focus', index: 0 });
    expect(alertKey('ArrowDown', 3, -1, 1, true)).toEqual({ type: 'focus', index: 2 });
    expect(alertKey('ArrowLeft', 3, 0, 0, true)).toEqual({ type: 'focus', index: 2 });
    expect(alertKey('ArrowUp', 3, 2, 0, true)).toEqual({ type: 'focus', index: 1 });
    expect(alertKey('Home', 3, 2, 0, true)).toEqual({ type: 'focus', index: 0 });
    expect(alertKey('End', 3, 0, 0, true)).toEqual({ type: 'focus', index: 2 });
    expect(alertKey('Enter', 3, -1, 2, true)).toEqual({ type: 'choose', index: 2 });
    expect(alertKey(' ', 3, 1, 2, true)).toEqual({ type: 'choose', index: 1 });
    expect(alertKey('2', 3, 0, 0, true)).toEqual({ type: 'choose', index: 1 });
    expect(alertKey('4', 3, 0, 0, true)).toEqual({ type: 'none' });
    expect(alertKey('a', 3, 0, 0, true)).toEqual({ type: 'none' });
  });
});
