import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, parseConfig, type ConfigInput } from '../../src/shared/config';
import type { RunResult } from '../../src/main/runner';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '', durationMs: 1, timedOut: false, killed: false });
const fail = (): RunResult => ({ code: 1, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false, killed: false });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A toggle whose check prints `world.value`; the actions change it only if `world.apply` is true. */
function setup(state: Record<string, unknown>, extra: Partial<Omit<ConfigInput, 'version'>> = {}, deps: Partial<EngineDeps> = {}) {
  const world = { value: '0', apply: true, actionFails: false, checkMs: 5 };
  const calls: { script: string; at: number }[] = [];
  const notify = vi.fn();
  const started = Date.now();
  const engine = new Engine({
    run: async (script) => {
      calls.push({ script, at: Date.now() - started });
      if (script === 'check') {
        const value = world.value; // read when the check starts, like a real script
        await wait(world.checkMs);
        return ok(value);
      }
      await wait(5);
      if (world.actionFails) return fail();
      if (world.apply && script === 'on') world.value = '1';
      if (world.apply && script === 'off') world.value = '0';
      return ok();
    },
    runAdmin: async () => ok(),
    notify,
    confirm: async () => true,
    log: () => {},
    env: {},
    platform: 'win32',
    ...deps,
  });
  engine.load(
    ConfigSchema.parse({
      version: 2,
      trays: [{ id: 't', label: 'T', state: { check: 'check', on: '^1$', interval: 3600, notify: { on: 'is on', off: 'is off' }, ...state }, action: 'on', offAction: 'off', rightAction: 'right' }],
      ...extra,
    }),
    'C:\\cfg',
  );
  engine.start();
  const checks = () => calls.filter((c) => c.script === 'check');
  const ready = async () => {
    for (let i = 0; i < 200 && engine.get('t')!.on === undefined; i++) await wait(5);
  };
  return { engine, world, calls, checks, notify, ready, t: () => engine.get('t')! };
}

let current: Engine | undefined;
afterEach(() => current?.stop());

describe('state.optimistic', () => {
  it('shows the new state as soon as the action succeeds, then the check confirms it', async () => {
    const s = setup({ optimistic: true, recheckDelay: 300 });
    current = s.engine;
    await s.ready();
    expect(s.t().on).toBe(false);
    await s.engine.click('t');
    expect(s.t().on).toBe(true); // before the re-check, which comes after 300 ms
    expect(s.checks()).toHaveLength(1);
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenLastCalledWith('T', 'is on', 'info');
    await wait(400);
    expect(s.checks()).toHaveLength(2);
    expect(s.t().on).toBe(true);
    expect(s.notify).toHaveBeenCalledTimes(1); // confirmed: no second notification

    await s.engine.click('t');
    expect(s.calls.at(-1)!.script).toBe('off');
    expect(s.t().on).toBe(false);
    expect(s.notify).toHaveBeenLastCalledWith('T', 'is off', 'info');
  });

  it('is corrected by the check when the action did not change the state', async () => {
    const s = setup({ optimistic: true, recheckDelay: 50 });
    current = s.engine;
    await s.ready();
    s.world.apply = false;
    await s.engine.click('t');
    expect(s.t().on).toBe(true);
    await wait(150);
    expect(s.t().on).toBe(false);
    expect(s.notify.mock.calls.map((c) => c[1])).toEqual(['is on', 'is off']);
  });

  it('does not change the state when the action fails', async () => {
    const s = setup({ optimistic: true, recheckDelay: 300 });
    current = s.engine;
    await s.ready();
    s.world.actionFails = true;
    await s.engine.click('t');
    expect(s.t().on).toBe(false);
  });

  it('ignores rightAction and entries without an offAction', async () => {
    const s = setup({ optimistic: true, recheckDelay: 300 });
    current = s.engine;
    await s.ready();
    await s.engine.rightClick('t');
    expect(s.calls.at(-1)!.script).toBe('right');
    expect(s.t().on).toBe(false);

    const single = new Engine({ run: async (script) => ok(script === 'check' ? '0' : ''), runAdmin: async () => ok(), notify: () => {}, confirm: async () => true, log: () => {}, env: {}, platform: 'win32' });
    single.load(ConfigSchema.parse({ version: 2, trays: [{ id: 'x', label: 'X', state: { check: 'check', on: '^1$', optimistic: true, recheckDelay: 300 }, action: 'flip' }] }), 'C:\\cfg');
    single.start();
    for (let i = 0; i < 200 && single.get('x')!.on === undefined; i++) await wait(5);
    await single.click('x');
    expect(single.get('x')!.on).toBe(false);
    single.stop();
  });

  it('discards a check that started before the action and checks again', async () => {
    const s = setup({ optimistic: true, recheckDelay: 10000 });
    current = s.engine;
    await s.ready();
    s.world.checkMs = 120;
    const slow = s.engine.checkNow('t'); // reads "0" now, answers after the action
    await wait(10);
    await s.engine.click('t');
    expect(s.t().on).toBe(true);
    await slow;
    expect(s.t().on).toBe(true); // the old "0" is not shown
    await wait(200);
    expect(s.checks().length).toBeGreaterThanOrEqual(3); // the fresh check ran without waiting 10 s
    expect(s.t().on).toBe(true);
    expect(s.notify.mock.calls.map((c) => c[1])).toEqual(['is on']);
  });

  it('is off by default: the state follows the check only', async () => {
    const s = setup({ recheckDelay: 100 });
    current = s.engine;
    await s.ready();
    await s.engine.click('t');
    expect(s.t().on).toBe(false);
    await wait(200);
    expect(s.t().on).toBe(true);
  });
});

describe('state.recheckDelay', () => {
  it('0 checks right after the action', async () => {
    const s = setup({ recheckDelay: 0 }, {}, { recheckDelay: 5000 });
    current = s.engine;
    await s.ready();
    await s.engine.click('t');
    await wait(150);
    expect(s.checks()).toHaveLength(2);
    expect(s.t().on).toBe(true);
  });

  it('waits the given time before the check', async () => {
    const s = setup({ recheckDelay: 250 });
    current = s.engine;
    await s.ready();
    await s.engine.click('t');
    const clicked = s.calls.at(-1)!.at;
    await wait(150);
    expect(s.checks()).toHaveLength(1);
    await wait(250);
    expect(s.checks()).toHaveLength(2);
    expect(s.checks()[1]!.at - clicked).toBeGreaterThanOrEqual(240);
  });

  it('defaults to 700 ms', async () => {
    const s = setup({});
    current = s.engine;
    await s.ready();
    await s.engine.click('t');
    await wait(500);
    expect(s.checks()).toHaveLength(1);
    await wait(400);
    expect(s.checks()).toHaveLength(2);
  });
});

describe('state options in the file', () => {
  const trays = (state: Record<string, unknown>, offAction?: string) => [{ id: 't', label: 'T', state: { check: 'c', ...state }, action: 'on', ...(offAction ? { offAction } : {}) }];

  it('accepts them and keeps them optional', () => {
    const r = parseConfig({ version: 2, trays: trays({ optimistic: true, recheckDelay: 0 }, 'off') });
    expect(r.ok && r.warnings).toEqual([]);
    const plain = parseConfig({ version: 2, trays: trays({}) });
    expect(plain.ok && plain.config.trays[0]!.state).toEqual({ check: 'c', interval: 60 });
  });

  it('rejects a negative or fractional delay', () => {
    expect(parseConfig({ version: 2, trays: trays({ recheckDelay: -1 }) }).ok).toBe(false);
    expect(parseConfig({ version: 2, trays: trays({ recheckDelay: 1.5 }) }).ok).toBe(false);
  });

  it('warns when optimistic has no offAction', () => {
    const r = parseConfig({ version: 2, trays: trays({ optimistic: true }) });
    expect(r.ok && r.warnings.map((w) => w.path)).toEqual(['trays[0].state.optimistic']);
  });
});
