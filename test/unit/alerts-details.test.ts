/* The remaining paths of checks and alerts: reloads during checks, toggles changed meanwhile, warnings. */
import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { Alerts } from '../../src/main/alerts';
import { ConfigSchema, parseConfig, type ConfigInput, type Schedule } from '../../src/shared/config';
import type { RunResult } from '../../src/main/runner';
import type { AlertRequest } from '../../src/shared/api';
import { defaultIndex } from '../../src/shared/scheduleForm';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(trays: ConfigInput['trays'], responder: (script: string) => RunResult | Promise<RunResult> = () => res(), extra: Partial<EngineDeps> = {}) {
  const calls: string[] = [];
  const alerts: AlertRequest[] = [];
  const notify = vi.fn();
  let answer: (r: AlertRequest) => Promise<number | undefined> = () => new Promise(() => undefined);
  const engine = new Engine({
    run: async (script) => {
      calls.push(script);
      return responder(script);
    },
    runAdmin: async () => res(),
    notify,
    confirm: async () => true,
    log: () => undefined,
    env: {},
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    alert: (r) => {
      alerts.push(r);
      return answer(r);
    },
    closeAlert: () => undefined,
    ...extra,
  });
  engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
  engine.start();
  return { engine, calls, alerts, notify, answerWith: (fn: typeof answer) => (answer = fn), fire: (id: string, s: Schedule, v?: Record<string, string>) => engine.fireSchedule(engine.get(id)!, s, v) };
}

describe('alerts: details', () => {
  it('a toggle checked for the first time while the configuration is saved: nothing runs', async () => {
    const pending: (() => void)[] = [];
    const trays: ConfigInput['trays'] = [{ id: 't', label: 'T', state: { check: 'state' }, action: 'up' }];
    const { engine, fire, calls } = setup(trays, (s) => (s === 'state' ? new Promise((r) => pending.push(() => r(res({ code: 1 })))) : res()));
    engine.stop(); // the scheduled first check is not waited for
    engine.start();
    const p = fire('t', { every: '1m' });
    await tick();
    engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
    engine.start();
    pending.forEach((r) => r());
    await p;
    expect(calls.filter((c) => c === 'up')).toEqual([]);
  });

  it('a "self" button of a toggle turned on meanwhile says there is nothing to run', async () => {
    let on = false;
    const { engine, fire, notify, answerWith } = setup([{ id: 't', label: 'T', state: { check: 'state' }, action: 'up' }], (s) => (s === 'state' ? res({ code: on ? 0 : 1 }) : res()));
    await engine.checkNow('t');
    let answer!: (i: number) => void;
    answerWith(() => new Promise((r) => (answer = r)));
    const p = fire('t', { every: '1m', run: 'on', alert: { choices: [{ label: 'Yes', run: 'self' }] } });
    await tick();
    on = true;
    await engine.checkNow('t');
    answer(0);
    await p;
    expect(notify).toHaveBeenCalledWith('T', 'Nothing to run now (it is ON)', 'info');
    // and "off" for a toggle turned off meanwhile
    const off = setup([{ id: 't', label: 'T', state: { check: 'state' }, action: 'up', offAction: 'down' }], (s) => (s === 'state' ? res({ code: on ? 0 : 1 }) : res()));
    await off.engine.checkNow('t');
    let answerOff!: (i: number) => void;
    off.answerWith(() => new Promise((r) => (answerOff = r)));
    const r = off.fire('t', { every: '1m', run: 'off', alert: { choices: [{ label: 'Yes', run: 'self' }] } });
    await tick();
    on = false;
    await off.engine.checkNow('t');
    answerOff(0);
    await r;
    expect(off.notify).toHaveBeenCalledWith('T', 'Nothing to run now (it is OFF)', 'info');
    // an entry with no state and no action left (a menu): no state in the message
    const menu = setup([{ id: 'm', label: 'M', menu: [{ id: 'x', label: 'X', action: 'x' }] }]);
    menu.answerWith(async () => 0);
    const entry = menu.engine.get('m')!;
    // offered while the entry had an action, answered after it lost it
    (entry.entry as { action?: string }).action = 'tmp';
    const q = menu.fire('m', { every: '1m', alert: { choices: [{ label: 'Me', run: 'self' }] } });
    delete (entry.entry as { action?: string }).action;
    await q;
    expect(menu.notify).toHaveBeenCalledWith('M', 'Nothing to run now', 'info');
  });

  it('the configuration saved while a choice waits for the entry: nothing runs', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const trays: ConfigInput['trays'] = [{ id: 'a', label: 'A', action: 'slow' }];
      const { engine, fire, calls, answerWith } = setup(trays, (s) => (s === 'slow' ? new Promise((r) => (release = () => r(res()))) : res()));
      let answer!: (i: number) => void;
      answerWith(() => new Promise((r) => (answer = r)));
      const open = fire('a', { every: '1m', alert: { choices: [{ label: 'Cmd', action: 'cmd' }] } });
      await vi.advanceTimersByTimeAsync(0);
      const click = engine.click('a');
      await vi.advanceTimersByTimeAsync(0);
      answer(0); // waits for the click
      await vi.advanceTimersByTimeAsync(500);
      engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
      engine.start();
      release();
      await click;
      await vi.advanceTimersByTimeAsync(500);
      await open;
      expect(calls).toEqual(['slow']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a notification being answered is not replaced; the next run of the schedule is skipped', async () => {
    const answering = new Set<number>();
    const { fire, alerts } = setup([{ id: 'a', label: 'A', action: 'go' }], () => res(), { answeringAlert: (id) => answering.has(id) });
    const s: Schedule = { every: '1m', alert: { style: 'notification', text: 'x', choices: [{ label: 'Go', run: 'self' }] } };
    void fire('a', s);
    await tick();
    answering.add(alerts[0]!.id);
    await fire('a', s);
    expect(alerts).toHaveLength(1);
  });

  it('Alerts knows which notification is being answered', async () => {
    let click!: () => void;
    let answer!: (v: Record<string, string> | undefined) => void;
    const a = new Alerts({
      window: () => new Promise((r) => (answer = r)),
      dismissWindow: () => undefined,
      notification: (n) => {
        click = n.onClick;
        return { close: () => undefined };
      },
      icon: () => undefined,
    });
    const p = a.show({ id: 3, style: 'notification', title: 'T', choices: ['A'] });
    expect(a.isAnswering(3)).toBe(false);
    click();
    expect(a.isAnswering(3)).toBe(true);
    answer({ choice: '0' });
    expect(await p).toBe(0);
    await tick();
    expect(a.isAnswering(3)).toBe(false);
  });

  it('warns about buttons that run an action the entry does not have', () => {
    const r = parseConfig({
      version: 2,
      trays: [
        {
          id: 'a',
          label: 'A',
          action: 'x',
          schedules: [{ every: '1m', alert: { choices: [{ label: '1', run: 'b:off' }, { label: '2', run: 'b:right' }, { label: '3', run: 'm' }, { label: '4', run: 'b' }] } }],
        },
        { id: 'b', label: 'B', action: 'b' },
        { id: 'm', label: 'M', menu: [] },
      ],
    });
    expect(r.ok && r.warnings.map((w) => `${w.path}: ${w.message}`)).toEqual([
      'trays[0].schedules[0].alert.choices[0].run: "b" has no offAction: this button does nothing',
      'trays[0].schedules[0].alert.choices[1].run: "b" has no rightAction: this button does nothing',
      'trays[0].schedules[0].alert.choices[2].run: "m" has no action: this button does nothing',
    ]);
  });

  it('a choice that throws (the confirmation fails) does not escape, and the next choice still runs', async () => {
    let fail = true;
    const { fire, calls, answerWith, engine } = setup([{ id: 'a', label: 'A', action: { run: 'go', confirm: 'Sure?' } }], () => res(), {
      confirm: async () => {
        if (fail) throw new Error('dialog gone');
        return true;
      },
    });
    answerWith(async () => 0);
    const s: Schedule = { watch: { path: 'in' }, alert: { text: 'x', choices: [{ label: 'Go', run: 'self' }] } };
    await engine.fireSchedule(engine.get('a')!, s, undefined, 'watch'); // returns at once: the error is caught behind
    await tick();
    await tick();
    // a timed schedule awaits the alert: the error reaches its caller (the timer ignores it)
    await expect(fire('a', { every: '1m', alert: { text: 'y', choices: [{ label: 'Go', run: 'self' }] } })).rejects.toThrow('dialog gone');
    fail = false;
    // the queue of choices is not stuck
    await fire('a', { every: '1m', alert: { text: 'z', choices: [{ label: 'Go', run: 'self' }] } });
    expect(calls).toEqual(['go']);
  });

  it('the default button is the first with its label', () => {
    expect(defaultIndex({ default: 'A', choices: [{ label: 'B', run: 'self' }, { label: 'A', run: 'self' }] })).toBe(1);
    expect(defaultIndex({ default: 'A' })).toBe(-1);
  });
});
