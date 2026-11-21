/*
 * The remaining paths of the engine: input rules, clicks that cannot run, failures and their
 * messages, the editor's test runs, state checks and the edges of scheduled runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, evaluateState, inputDefault, inputProblem, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, type ConfigInput } from '../../src/shared/config';
import type { RunOptions, RunResult } from '../../src/main/runner';
import type { ExecutionLog, PromptRequest } from '../../src/shared/api';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], responder: (script: string, o: RunOptions) => RunResult | Promise<RunResult> = () => res(), extra: Partial<EngineDeps> = {}, settings: ConfigInput['settings'] = {}) {
  const calls: { script: string; o: RunOptions }[] = [];
  const logs: ExecutionLog[] = [];
  const notify = vi.fn();
  const deps: EngineDeps = {
    run: async (script, o) => {
      calls.push({ script, o });
      return responder(script, o);
    },
    runAdmin: async (script) => {
      calls.push({ script: `ADMIN:${script}`, o: {} as RunOptions });
      return res();
    },
    notify,
    confirm: async () => true,
    log: (l) => logs.push(l),
    env: { HOME_X: 'h' },
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, settings, trays }), 'C:\\cfg');
  return { engine, calls, logs, notify, deps };
}

afterEach(() => vi.useRealTimers());

describe('input rules', () => {
  it('defaults and problems', () => {
    expect(inputDefault({ name: 'A', type: 'checkbox', default: 'true' } as never)).toBe('true');
    expect(inputDefault({ name: 'A', type: 'checkbox', default: true } as never)).toBe('true');
    expect(inputDefault({ name: 'A', type: 'checkbox' } as never)).toBe('false');
    expect(inputDefault({ name: 'A', type: 'number', default: 3 } as never)).toBe('3');
    expect(inputDefault({ name: 'A' } as never)).toBe('');
    expect(inputProblem({ type: 'checkbox' }, '')).toBeUndefined();
    expect(inputProblem({ type: 'text' }, '')).toBe('Required');
    expect(inputProblem({ type: 'text', optional: true }, '')).toBeUndefined();
    expect(inputProblem({ type: 'number' }, 'x')).toBe('Not a number');
    expect(inputProblem({ type: 'number' }, '4')).toBeUndefined();
    expect(inputProblem({ type: 'text', pattern: '\\d+' }, 'a')).toBe('Not in the expected format');
    expect(inputProblem({ type: 'text', pattern: '\\d+' }, '12')).toBeUndefined();
    expect(inputProblem({ type: 'text', pattern: '(' }, 'a')).toBeUndefined();
  });

  it('unattended runs report what is missing or wrong', async () => {
    const { engine, logs, notify } = setup([
      { id: 'a', label: 'A', action: { run: 'a', inputs: [{ name: 'N', label: 'Count', type: 'number', default: 'x' }] } },
      { id: 'b', label: 'B', action: { run: 'b', inputs: [{ name: 'R' }] } },
    ]);
    await engine.trigger(engine.get('a')!, 'on', { source: 'schedule' });
    await engine.trigger(engine.get('b')!, 'on', { source: 'schedule' });
    expect(logs.map((l) => l.error)).toEqual(['Count: Not a number', 'R: no value (scheduled runs do not ask: set it in the schedule values or as default)']);
    expect(notify).toHaveBeenCalledWith('A', 'Failed: Count: Not a number', 'error');
    // interactive but without a form available
    await engine.trigger(engine.get('b')!, 'on', { source: 'click' });
    expect(logs.at(-1)!.error).toBe('R: no value');
  });

  it('options from a command: errors, and asking for a form that is closed', async () => {
    let req!: PromptRequest;
    const responses = [res({ code: 1, stderr: 'line1\nline2\nfatal: no repo' }), res({ code: null, timedOut: true }), res({ code: null, error: 'spawn failed' }), res({ code: 2 }), res({ stdout: ' a \r\n\r\nb\n' })];
    const { engine } = setup(
      [{ id: 'a', label: 'A', action: { run: 'a ${B}', inputs: [{ name: 'B', type: 'select', optionsCommand: 'list' }] } }],
      (s) => (s === 'list' ? responses.shift()! : res()),
      {
        prompt: async (r) => {
          req = r;
          expect(await engine.inputOptions(r.id, 'B')).toEqual({ error: 'line2 fatal: no repo' });
          expect(await engine.inputOptions(r.id, 'B')).toEqual({ error: 'Timed out' });
          expect(await engine.inputOptions(r.id, 'B')).toEqual({ error: 'spawn failed' });
          expect(await engine.inputOptions(r.id, 'B')).toEqual({ error: 'Exit code 2' });
          expect(await engine.inputOptions(r.id, 'B')).toEqual({ options: ['a', 'b'] });
          return { B: 'b' };
        },
      },
    );
    await engine.click('a');
    expect(req.fields[0]!.dynamic).toBe(true);
    expect(await engine.inputOptions(req.id, 'B')).toEqual({ error: 'The form is no longer open' });
  });

  it('a form that fails to open is an error, not a crash', async () => {
    const { engine, notify } = setup([{ id: 'a', label: 'A', action: { run: 'a', inputs: [{ name: 'B' }] } }], () => res(), {
      prompt: async () => {
        throw new Error('window gone');
      },
    });
    await engine.click('a');
    expect(notify).toHaveBeenCalledWith('A', 'Failed: The form could not be shown: window gone', 'error');
    const odd = setup([{ id: 'a', label: 'A', action: { run: 'a', inputs: [{ name: 'B' }] } }], () => res(), {
      prompt: async () => {
        throw 'plain';
      },
    });
    await odd.engine.click('a');
    expect(odd.notify).toHaveBeenCalledWith('A', 'Failed: The form could not be shown: plain', 'error');
  });
});

describe('clicks, chains and failures', () => {
  it('what cannot run', async () => {
    const { engine, calls, notify } = setup([
      { id: 'menu', label: 'Menu', menu: [{ id: 'x', label: 'X', action: 'x' }, { separator: true }] },
      { id: 'off', label: 'Off', disabled: true, action: 'off' },
    ]);
    expect(await engine.click('nope')).toBe(false);
    expect(await engine.click('menu')).toBe(false);
    expect(await engine.rightClick('menu')).toBe(false);
    expect(await engine.rightClick('nope')).toBe(false);
    expect(await engine.click('off')).toBe(true);
    expect(calls).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(engine.trays.map((t) => t.key)).toEqual(['trays[0]', 'trays[1]']);
    expect(engine.all).toHaveLength(3);
    expect(engine.settings?.shell).toBeUndefined();
    expect(engine.allStatus().map((s) => s.enabled)).toEqual([true, true, false]);
    expect(engine.pathLabel(engine.get('x')!)).toBe('Menu');
  });

  it('enabledWhen follows another toggle, also negated; unknown ids are never on', async () => {
    const { engine } = setup([
      { id: 'vpn', label: 'VPN', state: { check: 'c' }, action: 'up' },
      { id: 'a', label: 'A', enabledWhen: 'vpn', action: 'a' },
      { id: 'b', label: 'B', enabledWhen: '!vpn', action: 'b' },
      { id: 'c', label: 'C', enabledWhen: 'ghost', action: 'c' },
    ]);
    const enabled = () => ['a', 'b', 'c'].map((k) => engine.isEnabled(engine.get(k)!));
    expect(enabled()).toEqual([false, true, false]);
    await engine.checkNow('vpn');
    expect(enabled()).toEqual([true, false, false]);
  });

  it('chains skip unknown ids and loops; a declined confirmation stops', async () => {
    const { engine, calls, deps } = setup([
      { id: 'a', label: 'A', action: { run: 'a', before: ['ghost', 'b'], after: ['a'] } },
      { id: 'b', label: 'B', action: { run: 'b', after: ['a'] } },
      { id: 'c', label: 'C', action: { run: 'c', confirm: 'Sure ${X}?' } },
      { id: 'r', label: 'R', action: 'r', rightAction: { run: 'right', parallel: ['b'] } },
    ]);
    await engine.click('a');
    expect(calls.map((c) => c.script)).toEqual(['b', 'a']);
    deps.confirm = async () => false;
    await engine.click('c');
    expect(calls).toHaveLength(2);
    await engine.rightClick('r');
    expect(calls.map((c) => c.script).slice(2).sort()).toEqual(['a', 'b', 'right']);
  });

  it('failure messages, notifications and admin actions', async () => {
    const results: Record<string, RunResult> = {
      t: res({ code: null, timedOut: true }),
      k: res({ code: null, killed: true }),
      e: res({ code: null, error: 'boom' }),
      x: res({ code: 3, stdout: 'only stdout' }),
    };
    const { engine, logs, notify, calls } = setup(
      [
        { id: 't', label: 'T', action: { run: 't', timeout: 5 } },
        { id: 'k', label: 'K', action: 'k' },
        { id: 'e', label: 'E', action: 'e' },
        { id: 'x', label: 'X', action: 'x' },
        { id: 'n', label: 'N', action: { run: 'n', notify: true } },
        { id: 's', label: 'S', action: { run: 's', notify: 'Done ${HOME_X}' } },
        { id: 'adm', label: 'Adm', action: { run: 'adm', admin: true } },
      ],
      (s) => results[s] ?? res(),
    );
    for (const id of ['t', 'k', 'e', 'x', 'n', 's', 'adm']) await engine.click(id);
    expect(logs.map((l) => l.error)).toEqual(['Timed out', 'Stopped', 'boom', undefined, undefined, undefined, expect.stringMatching(/Admin commands are disabled/)]);
    expect(notify.mock.calls.map((c) => c[1])).toEqual([
      'Failed: Timed out after 5s',
      'Failed: Stopped',
      'Failed: boom',
      'Failed: Exit code 3\nonly stdout',
      'Done',
      'Done ${HOME_X}',
      expect.stringMatching(/^Failed: Admin commands are disabled/),
    ]);
    expect(calls.map((c) => c.script)).not.toContain('ADMIN:adm');
  });

  it('admin actions run when allowed', async () => {
    const { engine, calls } = setup([{ id: 'adm', label: 'Adm', action: { run: 'adm', admin: true } }], () => res(), {}, { allowAdminCommands: true });
    await engine.click('adm');
    expect(calls.map((c) => c.script)).toEqual(['ADMIN:adm']);
  });

  it('the editor test runs: admin, checks with a timeout, run options without an entry', async () => {
    const plain = setup([]);
    expect((await plain.engine.test({ run: 'x', admin: true })).error).toMatch(/Admin commands are disabled/);
    await plain.engine.test({ run: 'chk' }, true);
    expect(plain.calls[0]!.o.timeout).toBe(60);
    await plain.engine.test({ run: 'adm', admin: true }, true);
    expect(plain.calls[1]!.script).toBe('adm'); // a check is never elevated
    expect(plain.engine.runOptions(undefined, { cwd: 'sub', env: { A: '${HOME_X}' }, shell: 'bash' })).toMatchObject({ shell: 'bash', cwd: 'C:\\cfg\\sub', env: { A: '${HOME_X}' } });
    expect(plain.engine.runOptions(undefined, {}).shell).toBe('powershell');
    const allowed = setup([], () => res(), {}, { allowAdminCommands: true, shell: 'cmd' });
    await allowed.engine.test({ run: 'adm', admin: true });
    expect(allowed.calls[0]!.script).toBe('ADMIN:adm');
    expect(allowed.engine.runOptions(undefined, {}).shell).toBe('cmd');
    // a test whose form is cancelled or invalid
    const form = setup([], () => res(), { prompt: async () => undefined });
    expect((await form.engine.test({ run: 'x', inputs: [{ name: 'A' }] })).error).toBe('Cancelled');
    const filled = setup([], () => res(), { prompt: async () => ({ A: '7' }) });
    await filled.engine.test({ run: 'x ${A}', inputs: [{ name: 'A', type: 'number' }] });
    expect(filled.calls[0]!.script).toBe('x 7');
    const broken = setup([], () => res(), { prompt: async () => Promise.reject(new Error('no window')) });
    expect((await broken.engine.test({ run: 'x', inputs: [{ name: 'A' }] })).error).toBe('The form could not be shown: no window');
  });
});

describe('state checks', () => {
  it('icons, notifications, checks while hidden and checks already running', async () => {
    vi.useFakeTimers();
    let on = false;
    let release: (() => void) | undefined;
    const { engine, notify, calls } = setup(
      [
        { id: 't', label: 'T', icon: 'on.png', state: { check: 'c', interval: 10, iconOff: 'off.png', notify: { on: true, off: 'Gone ${env:HOME_X}' } }, action: 'up', offAction: 'down' },
        { id: 'h', label: 'H', hidden: true, state: { check: 'h', interval: 10 }, action: 'x' },
        { id: 'plain', label: 'P', action: 'p' },
      ],
      (s) => (s === 'slow' ? new Promise((r) => (release = () => r(res()))) : res({ code: s === 'c' && !on ? 1 : 0 })),
    );
    await engine.checkNow('plain'); // not a toggle: nothing
    engine.start();
    await vi.advanceTimersByTimeAsync(5);
    expect(engine.status(engine.get('t')!).on).toBe(false);
    expect(engine.iconFor(engine.get('t')!)).toBe('C:\\cfg\\off.png');
    expect(engine.status(engine.get('plain')!).on).toBeUndefined();
    on = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notify).toHaveBeenLastCalledWith('T', 'Now ON', 'info');
    on = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notify).toHaveBeenLastCalledWith('T', 'Gone h', 'info');
    // the hidden toggle is not checked on its own
    expect(calls.filter((c) => c.script === 'h')).toHaveLength(0);
    await engine.checkNow('h');
    expect(calls.filter((c) => c.script === 'h')).toHaveLength(1);
    engine.stop();
    // a check still running when the configuration is reloaded is ignored
    const slow = setup([{ id: 's', label: 'S', state: { check: 'slow', interval: 10 }, action: 'x' }], (sc) => (sc === 'slow' ? new Promise((r) => (release = () => r(res()))) : res()));
    slow.engine.start();
    await vi.advanceTimersByTimeAsync(1);
    slow.engine.stop();
    release!();
    await vi.advanceTimersByTimeAsync(1);
    expect(slow.engine.status(slow.engine.get('s')!).on).toBeUndefined();
    // checkNow while a check is running: waits for it, then checks again with fresh data
    slow.engine.start();
    await vi.advanceTimersByTimeAsync(1);
    const first = release!;
    const again = slow.engine.checkNow('s');
    first();
    await vi.advanceTimersByTimeAsync(1);
    release!();
    await again;
    expect(slow.calls.filter((c) => c.script === 'slow')).toHaveLength(3);
    expect(slow.engine.status(slow.engine.get('s')!).on).toBe(true);
    slow.engine.stop();
  });

  it('evaluates outputs', () => {
    expect(evaluateState(res({ code: 1 }))).toBe(false);
    expect(evaluateState(res({ stdout: 'Disconnected' }), 'Connected', 'Disconnected')).toBe(false);
    expect(evaluateState(res({ stdout: 'Connected' }), 'Connected', 'Disconnected')).toBe(true);
    expect(evaluateState(res({ stdout: 'other' }), 'Connected')).toBe(false);
    expect(evaluateState(res())).toBe(true);
  });
});

describe('scheduled runs: edges', () => {
  it('"on" when already on, "off" when already off, toggles checked first, values merged', async () => {
    let on = true;
    const { engine, calls } = setup([{ id: 't', label: 'T', state: { check: 'c' }, action: { run: 'up ${A} ${B}', inputs: [{ name: 'A', default: 'a' }, { name: 'B', default: 'b' }] }, offAction: 'down' }], (s) => res({ code: s === 'c' && !on ? 1 : 0 }));
    engine.start();
    const t = engine.get('t')!;
    await engine.fireSchedule(t, { every: '1m', run: 'on' });
    expect(calls.filter((c) => c.script !== 'c')).toEqual([]);
    on = false;
    await engine.checkNow('t');
    await engine.fireSchedule(t, { every: '1m', run: 'off' });
    expect(calls.filter((c) => c.script !== 'c')).toEqual([]);
    await engine.fireSchedule(t, { every: '1m', run: 'on', values: { A: 'x' } }, { B: 'y' }, 'watch');
    expect(calls.filter((c) => c.script !== 'c').map((c) => c.script)).toEqual(['up x y']);
    engine.stop();
    // a toggle never checked yet is checked before deciding
    const fresh = setup([{ id: 't', label: 'T', state: { check: 'c' }, action: 'up', offAction: 'down' }]);
    fresh.engine.start();
    await fresh.engine.fireSchedule(fresh.engine.get('t')!, { every: '1m' });
    expect(fresh.calls[0]!.script).toBe('c');
    expect(fresh.calls.map((c) => c.script)).toContain('down');
    fresh.engine.stop();
    // nothing to run for this kind
    const none = setup([{ id: 'm', label: 'M', menu: [] }]);
    await none.engine.fireSchedule(none.engine.get('m')!, { every: '1m', run: 'right' });
    expect(none.calls).toEqual([]);
  });
});
