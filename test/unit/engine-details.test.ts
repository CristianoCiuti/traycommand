/*
 * The last details of the engine: listeners, entries without id, defaults, a second start,
 * concurrent state checks, mixed watch batches and runs that throw.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, type ConfigInput } from '../../src/shared/config';
import type { RunOptions, RunResult } from '../../src/main/runner';
import type { ExecutionLog } from '../../src/shared/api';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], responder: (script: string, o: RunOptions) => RunResult | Promise<RunResult> = () => res(), extra: Partial<EngineDeps> = {}, dir = 'C:\\cfg') {
  const calls: { script: string; o: RunOptions }[] = [];
  const logs: ExecutionLog[] = [];
  const notify = vi.fn();
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
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, trays }), dir);
  return { engine, calls, logs, notify };
}

const noWatch: EngineDeps['watchFn'] = () => ({ on: () => undefined as never, close: () => undefined });

afterEach(() => vi.useRealTimers());

describe('engine details', () => {
  it('listeners, busy entries, entries without id, options without label, nothing typed', async () => {
    let release!: () => void;
    const { engine, notify, calls } = setup(
      [
        { id: 'm', label: 'M', menu: [{ label: 'NoId', action: { run: 'n ${A}', inputs: [{ name: 'A', type: 'select', options: [{ value: 'v' }] }] } }] },
        { id: 'slow', label: 'Slow', action: 'slow' },
        { id: 'ref', label: 'Ref', action: { run: 'ref', before: ['slow:off'] } },
      ],
      (s) => (s === 'slow' ? new Promise((r) => (release = () => r(res()))) : res()),
      {
        prompt: async (r) => {
          expect(r.fields[0]!.options).toEqual([{ value: 'v', label: 'v' }]);
          return {}; // nothing typed: the default
        },
      },
    );
    const seen: (string | undefined)[] = [];
    const off = engine.onChange((k) => seen.push(k));
    expect(engine.needsInput(engine.get('trays[0].menu[0]')!, 'on')).toBe(true);
    expect(engine.needsInput(engine.get('slow')!, 'off')).toBe(false);
    await engine.trigger(engine.get('trays[0].menu[0]')!, 'on');
    expect(calls.at(-1)!.script).toBe('n ');
    const running = engine.click('slow');
    await new Promise((r) => setTimeout(r, 5));
    await engine.click('slow');
    expect(notify).toHaveBeenCalledWith('Slow', 'Still running, try again when it finishes', 'warning');
    release();
    await running;
    await engine.click('ref'); // "slow:off" has no off action: skipped
    expect(calls.at(-1)!.script).toBe('ref');
    off();
    const before = seen.length;
    await engine.click('ref');
    expect(seen.length).toBe(before);
    expect(engine.schedulesPaused).toBe(false);
  });

  it('an empty secret, no configuration folder, the default recheck delay', async () => {
    vi.useFakeTimers();
    const { engine, calls, logs } = setup(
      [{ id: 't', label: 'T', state: { check: 'c', interval: 600 }, action: { run: 'up ${P}', inputs: [{ name: 'P', type: 'password', optional: true }] } }],
      () => res({ stdout: 'out' }),
      { recheckDelay: undefined, prompt: async () => ({ P: '' }) },
      '',
    );
    engine.start();
    await vi.advanceTimersByTimeAsync(1);
    await engine.click('t');
    expect(calls.at(-1)!.o.cwd).toBeUndefined();
    expect(logs.at(-1)!.stdout).toBe('out');
    const checks = () => calls.filter((c) => c.script === 'c').length;
    const n = checks();
    await vi.advanceTimersByTimeAsync(690);
    expect(checks()).toBe(n);
    await vi.advanceTimersByTimeAsync(20);
    expect(checks()).toBe(n + 1);
    engine.stop();
  });

  it('schedules without id, default delays, platform and quiet time, a second start, rearm', async () => {
    vi.useFakeTimers();
    const { engine, calls } = setup([{ id: 'm', label: 'M', menu: [{ label: 'E', action: 'e', schedules: [{ every: '10s' }, {} as never, { startup: true }, { watch: { path: os.tmpdir(), settle: 'soon' } }] }] }], () => res(), {
      startupDelay: undefined,
      platform: undefined,
      watchFn: noWatch,
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(2990);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls.map((c) => c.script)).toEqual(['e']); // startup after 3 s
    engine.start(); // started again without stop: the old timers are ignored
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2); // one "every" run, not two
    engine.rearmSchedules();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(3);
    engine.stop();
  });

  it('checks: a scheduled one while a forced one runs is skipped; "Now OFF" by default; hidden after stop', async () => {
    vi.useFakeTimers();
    let on = true;
    let release: (() => void) | undefined;
    let slowNext = false;
    const { engine, notify, calls } = setup([{ id: 't', label: 'T', state: { check: 'c', interval: 5, notify: { off: true } }, action: 'x' }], () => {
      if (slowNext) {
        slowNext = false;
        return new Promise((r) => (release = () => r(res({ code: on ? 0 : 1 }))));
      }
      return res({ code: on ? 0 : 1 });
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.status(engine.get('t')!).on).toBe(true);
    on = false;
    slowNext = true;
    const forced = engine.checkNow('t');
    await vi.advanceTimersByTimeAsync(5000); // the scheduled check comes while the forced one runs
    expect(calls.filter((c) => c.script === 'c')).toHaveLength(2);
    release!();
    await forced;
    expect(notify).toHaveBeenCalledWith('T', 'Now OFF', 'info');
    engine.stop();
    const hidden = setup([{ id: 'h', label: 'H', hidden: true, state: { check: 'c', interval: 5 }, action: 'x' }]);
    hidden.engine.start();
    await vi.advanceTimersByTimeAsync(1);
    hidden.engine.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(hidden.calls).toEqual([]);
  });

  it('a watch batch with different events is "mixed"; a run that throws does not stop the queue', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mixed-'));
    try {
      fs.writeFileSync(path.join(dir, 'old.txt'), 'x');
      const listeners: ((t: string, n: string | null) => void)[] = [];
      let first = true;
      const { engine, calls } = setup(
        [
          { id: 'b', label: 'B', action: 'batch', schedules: [{ watch: { path: dir, events: ['add', 'remove'], batch: true, settle: '1s' } }] },
          { id: 'q', label: 'Q', action: 'each', schedules: [{ watch: { path: dir, settle: '1s' } }] },
        ],
        (s) => {
          if (s === 'each' && first) {
            first = false;
            return Promise.reject(new Error('runner broke'));
          }
          return res();
        },
        {
          watchFn: (_d, _o, listener) => {
            listeners.push(listener as (t: string, n: string | null) => void);
            return { on: () => undefined as never, close: () => undefined };
          },
        },
      );
      engine.start();
      fs.unlinkSync(path.join(dir, 'old.txt'));
      fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
      fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
      for (const name of ['old.txt', 'a.txt', 'b.txt']) for (const l of listeners) l('rename', name);
      await vi.waitFor(() => expect(calls.map((c) => c.script).sort()).toEqual(['batch', 'each', 'each']), { timeout: 5000 });
      const batch = calls.find((c) => c.script === 'batch')!;
      expect(batch.o.env!.TC_EVENT).toBe('mixed');
      expect(batch.o.env!.TC_FILES!.split('\n')).toHaveLength(3);
      engine.stop();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a check whose runner fails is OFF; the process environment by default', async () => {
    const { engine } = setup([{ id: 't', label: 'T', state: { check: 'c' }, action: 'x' }], () => Promise.reject(new Error('cannot start')), { env: undefined });
    await engine.checkNow('t');
    expect(engine.status(engine.get('t')!).on).toBe(false);
    expect(engine.expandText('${env:PATH}')).toBe(process.env.PATH);
    const odd = setup([{ id: 't', label: 'T', state: { check: 'c' }, action: 'x' }], () => Promise.reject('plain'));
    await odd.engine.checkNow('t');
    expect(odd.engine.status(odd.engine.get('t')!).on).toBe(false);
    // before any configuration is loaded
    const bare = new Engine({ run: async () => res(), runAdmin: async () => res(), notify: () => undefined, confirm: async () => true, log: () => undefined });
    expect(bare.expandText('a ${X}')).toBe('a ${X}');
  });
});
