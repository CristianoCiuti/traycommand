/* Adversarial checks of schedule checks and alerts. */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, type ConfigInput, type Schedule } from '../../src/shared/config';
import type { RunOptions, RunResult } from '../../src/main/runner';
import type { AlertRequest } from '../../src/shared/api';
import { renameChoice } from '../../src/shared/scheduleForm';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(trays: ConfigInput['trays'], responder: (script: string, o: RunOptions) => RunResult | Promise<RunResult> = () => res()) {
  const calls: string[] = [];
  const alerts: AlertRequest[] = [];
  const closed: number[] = [];
  let answer: (r: AlertRequest) => Promise<number | undefined> = () => new Promise(() => undefined);
  const deps: EngineDeps = {
    run: async (script, o) => {
      calls.push(script);
      return responder(script, o);
    },
    runAdmin: async () => res(),
    notify: () => undefined,
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
    closeAlert: (id) => closed.push(id),
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
  engine.start();
  return { engine, calls, alerts, closed, answerWith: (fn: typeof answer) => (answer = fn), fire: (id: string, s: Schedule, v?: Record<string, string>) => engine.fireSchedule(engine.get(id)!, s, v) };
}

describe('challenge: alerts', () => {
  it('a window alert is not shown twice even when its check is slow', async () => {
    const pending: (() => void)[] = [];
    const { fire, alerts } = setup([{ id: 'a', label: 'A', action: 'go' }], (s) => (s === 'slow-check' ? new Promise((r) => pending.push(() => r(res()))) : res()));
    const schedule: Schedule = { every: '5s', if: 'slow-check', alert: { text: 'x', choices: [{ label: 'Go', run: 'self' }] } };
    void fire('a', schedule);
    await tick();
    void fire('a', schedule); // the next tick of the schedule, while the first check still runs
    await tick();
    pending.forEach((p) => p());
    await tick();
    await tick();
    expect(alerts).toHaveLength(1);
  });

  it('a newer notification whose check fails does not remove the older one', async () => {
    let pass = true;
    const { fire, alerts, closed } = setup([{ id: 'a', label: 'A', action: 'go' }], (s) => (s === 'chk' ? res({ code: pass ? 0 : 1 }) : res()));
    const schedule: Schedule = { every: '1m', if: 'chk', alert: { style: 'notification', text: 'x', choices: [{ label: 'Go', run: 'self' }] } };
    void fire('a', schedule);
    await tick();
    expect(alerts).toHaveLength(1);
    pass = false;
    await fire('a', schedule);
    expect(alerts).toHaveLength(1); // nothing replaces it
    expect(closed).toEqual([]); // so it must stay
  });

  it('an alert is not shown for the old configuration when the check ends after a reload', async () => {
    const pending: (() => void)[] = [];
    const trays: ConfigInput['trays'] = [{ id: 'a', label: 'A', action: 'go' }];
    const { engine, fire, alerts } = setup(trays, (s) => (s === 'slow-check' ? new Promise((r) => pending.push(() => r(res()))) : res()));
    void fire('a', { every: '1m', if: 'slow-check', alert: { text: 'x', choices: [{ label: 'Go', run: 'self' }] } });
    await tick();
    engine.stop();
    engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
    engine.start();
    pending.forEach((p) => p());
    await tick();
    await tick();
    expect(alerts).toEqual([]); // its answer would run nothing anyway (generation changed)
  });

  it('"run: on" answered later does not turn on a toggle that is already on', async () => {
    let on = false;
    const { engine, fire, calls, answerWith } = setup([{ id: 't', label: 'T', state: { check: 'state' }, action: 'up', offAction: 'down' }], (s) => (s === 'state' ? res({ code: on ? 0 : 1 }) : res()));
    await engine.checkNow('t');
    let answer!: (i: number) => void;
    answerWith(() => new Promise((r) => (answer = r)));
    const p = fire('t', { every: '1m', run: 'on', alert: { text: 'Turn on?', choices: [{ label: 'Yes', run: 'self' }] } });
    await tick();
    on = true; // turned on meanwhile (by hand, elsewhere)
    await engine.checkNow('t');
    answer(0);
    await p;
    expect(calls.filter((c) => c === 'up')).toEqual([]);
  });

  it('a notification alert of a folder watch does not hold back the next files forever', async () => {
    const { engine, alerts } = setup([{ id: 'a', label: 'A', action: 'go' }]);
    const entry = engine.get('a')!;
    const schedule: Schedule = { watch: { path: 'C:\\in' }, alert: { style: 'notification', text: '${TC_FILE_NAME}', choices: [{ label: 'Go', run: 'self' }] } };
    const onFileChanges = (engine as unknown as { onFileChanges: (...a: unknown[]) => void }).onFileChanges.bind(engine);
    onFileChanges(entry, schedule, undefined, [{ file: 'C:\\in\\1.txt', event: 'add' }]);
    await tick();
    onFileChanges(entry, schedule, undefined, [{ file: 'C:\\in\\2.txt', event: 'add' }]);
    await tick();
    await tick();
    // the toast of 1.txt was swiped away (no answer ever comes): 2.txt must still be announced
    expect(alerts.map((a) => a.text)).toEqual(['1.txt', '2.txt']);
  });
});

describe('challenge: editor', () => {
  it('clearing the label of the default button while retyping it keeps it the default', () => {
    const a = { text: 'x', timeout: '1m', default: 'Run', choices: [{ label: 'Run', run: 'self' }, { label: 'Skip', action: 'skip' }] };
    const cleared = renameChoice(a, 0, '');
    const retyped = renameChoice(cleared, 0, 'Go');
    expect(retyped.default).toBe('Go');
  });

  it('typing a label that passes through the default label does not move the default', () => {
    const a = { text: 'x', timeout: '1m', default: 'Run', choices: [{ label: 'Run', run: 'self' }, { label: 'R', action: 'later' }] };
    let next = renameChoice(a, 1, 'Ru');
    next = renameChoice(next, 1, 'Run');
    next = renameChoice(next, 1, 'Run ');
    next = renameChoice(next, 1, 'Run later');
    expect(next.default).toBe('Run'); // still the first button
  });
});
