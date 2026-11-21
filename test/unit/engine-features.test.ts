import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, parseConfig, type ConfigInput } from '../../src/shared/config';
import type { RunResult, RunOptions } from '../../src/main/runner';
import type { ExecutionLog, PromptRequest } from '../../src/shared/api';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '', durationMs: 1, timedOut: false, killed: false });
const fail = (code = 1): RunResult => ({ code, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false, killed: false });

function setup(input: Omit<ConfigInput, 'version'>, responder: (script: string, o: RunOptions) => RunResult = () => ok(), extra: Partial<EngineDeps> = {}) {
  const calls: string[] = [];
  const options: RunOptions[] = [];
  const logs: ExecutionLog[] = [];
  const notify = vi.fn();
  const deps: EngineDeps = {
    run: async (script, o) => {
      calls.push(script);
      options.push(o);
      return responder(script, o);
    },
    runAdmin: async (script) => {
      calls.push(`ADMIN:${script}`);
      return ok();
    },
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
  engine.load(ConfigSchema.parse({ version: 2, ...input }), 'C:\\cfg');
  return { engine, calls, notify, options, logs };
}

const memoryStore = () => {
  const data = new Map<string, Record<string, string>>();
  return { data, memory: { get: (k: string) => data.get(k), set: (k: string, v: Record<string, string>) => void data.set(k, v) } };
};

describe('inputs', () => {
  it('asks the inputs of the whole chain once, then runs with the values in the script and the environment', async () => {
    const prompts: PromptRequest[] = [];
    const { data, memory } = memoryStore();
    const { engine, calls, options, logs } = setup(
      {
        trays: [
          {
            id: 'deploy',
            label: 'Deploy',
            action: {
              run: 'deploy ${BRANCH} ${ENV}',
              inputs: [{ name: 'BRANCH', default: 'main' }, { name: 'ENV', type: 'select', options: ['dev', 'prod'] }],
              after: ['notify'],
            },
            menu: [{ id: 'notify', label: 'Notify', action: { run: 'notify ${BRANCH} ${TOKEN}', inputs: [{ name: 'TOKEN', type: 'password' }, { name: 'BRANCH' }] } }],
          },
        ],
      },
      (s) => ok(s.startsWith('notify') ? 'token is s3cret' : ''),
      {
        memory,
        prompt: async (r) => {
          prompts.push(r);
          return { BRANCH: 'feature/x', ENV: 'prod', TOKEN: 's3cret' };
        },
      },
    );
    await engine.click('deploy', 'hotkey');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.submitLabel).toBe('Run');
    expect(prompts[0]!.fields.map((f) => [f.name, f.type, f.value])).toEqual([
      ['BRANCH', 'text', 'main'],
      ['ENV', 'select', ''],
      ['TOKEN', 'password', ''],
    ]);
    expect(prompts[0]!.fields[1]!.options).toEqual([
      { value: 'dev', label: 'dev' },
      { value: 'prod', label: 'prod' },
    ]);
    expect(calls).toEqual(['deploy feature/x prod', 'notify feature/x s3cret']);
    expect(options[0]!.env).toMatchObject({ BRANCH: 'feature/x', ENV: 'prod' });
    // passwords are hidden in the log and never remembered
    expect(logs[1]!.stdout).toBe('token is ••••');
    expect(logs[1]!.inputs).toEqual({ BRANCH: 'feature/x', TOKEN: '••••' });
    expect(logs[0]!.source).toBe('hotkey');
    expect(data.get('deploy:on')).toEqual({ BRANCH: 'feature/x', ENV: 'prod' });
  });

  it('proposes the last values used, except when remember is false', async () => {
    const prompts: PromptRequest[] = [];
    const { memory } = memoryStore();
    memory.set('t:on', { NAME: 'last', FIXED: 'old' });
    const { engine } = setup(
      { trays: [{ id: 't', label: 'T', action: { run: 'x ${NAME} ${FIXED}', inputs: [{ name: 'NAME', default: 'd' }, { name: 'FIXED', default: 'f', remember: false }] } }] },
      undefined,
      { memory, prompt: async (r) => (prompts.push(r), undefined) },
    );
    await engine.click('t');
    expect(prompts[0]!.fields.map((f) => f.value)).toEqual(['last', 'f']);
  });

  it('cancelling the form runs nothing', async () => {
    const { engine, calls } = setup(
      { trays: [{ id: 't', label: 'T', action: { run: 'x', inputs: [{ name: 'A' }], before: ['b'] }, menu: [{ id: 'b', label: 'B', action: 'b' }] }] },
      undefined,
      { prompt: async () => undefined },
    );
    await engine.click('t');
    expect(calls).toEqual([]);
  });

  it('options from a command are loaded while the form is open', async () => {
    let loaded: { options?: string[]; error?: string } | undefined;
    let id = 0;
    const holder: { engine?: Engine } = {};
    const { engine, calls } = setup(
      { trays: [{ id: 't', label: 'T', action: { run: 'checkout ${B}', inputs: [{ name: 'B', type: 'select', optionsCommand: 'git branch' }] } }] },
      (s) => ok(s === 'git branch' ? 'main\n  develop\n\n' : ''),
      {
        prompt: async (r) => {
          expect(r.fields[0]!.dynamic).toBe(true);
          id = r.id;
          loaded = await holder.engine!.inputOptions(r.id, 'B');
          return { B: 'develop' };
        },
      },
    );
    holder.engine = engine;
    await engine.click('t');
    expect(loaded).toEqual({ options: ['main', 'develop'] });
    expect(calls).toEqual(['git branch', 'checkout develop']);
    expect(await engine.inputOptions(id, 'B')).toEqual({ error: 'The form is no longer open' });
  });

  it('a confirmation shows the typed values', async () => {
    const confirm = vi.fn(async () => true);
    const { engine } = setup({ trays: [{ id: 't', label: 'T', action: { run: 'rm', confirm: 'Delete ${WHAT}?', inputs: [{ name: 'WHAT' }] } }] }, undefined, {
      confirm,
      prompt: async () => ({ WHAT: 'logs' }),
    });
    await engine.click('t');
    expect(confirm).toHaveBeenCalledWith('T', 'Delete logs?');
  });

  it('the editor test asks the values too', async () => {
    const { engine, calls } = setup({ trays: [] }, undefined, { prompt: async (r) => (r.submitLabel === 'Run test' ? { X: '42' } : undefined) });
    const r = await engine.test({ run: 'echo ${X}', inputs: [{ name: 'X' }] });
    expect(r.code).toBe(0);
    expect(calls).toEqual(['echo 42']);
  });
});

describe('configuration checks', () => {
  it('reports wrong shortcuts, inputs and schedules', () => {
    const bad = parseConfig({
      version: 2,
      settings: { launcherHotkey: 'Ctrl+Alt+Space' },
      trays: [
        { id: 'a', label: 'A', hotkey: 'ctrl+alt+space', action: { run: 'x', inputs: [{ name: 'X' }, { name: 'X' }, { name: 'S', type: 'select' }, { name: 'P', pattern: '(' }] } },
        { id: 'b', label: 'B', hotkey: 'K', action: 'b', schedules: [{ cron: '61 * * * *' }, { every: '2s' }, {}, { cron: '* * * * *', every: '1m' }, { every: '1m', run: 'off' }] },
      ],
    });
    expect(bad.ok).toBe(false);
    const messages = bad.ok ? [] : bad.issues.map((i) => `${i.path}: ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        'trays[0].hotkey: Shortcut ctrl+alt+space is already used by the launcher',
        'trays[0].action.inputs[1].name: Duplicate input "X"',
        'trays[0].action.inputs[2]: A "select" needs options or optionsCommand',
        expect.stringMatching(/^trays\[0\]\.action\.inputs\[3\]\.pattern: Invalid regular expression/),
        expect.stringMatching(/^trays\[1\]\.hotkey: Use at least Ctrl/),
        'trays[1].schedules[0].cron: minute must be between 0 and 59 (found 61)',
        'trays[1].schedules[1].every: The minimum interval is 5 seconds',
        'trays[1].schedules[2]: Set exactly one of cron, every or startup',
        'trays[1].schedules[3]: Set exactly one of cron, every or startup',
        'trays[1].schedules[4].run: Nothing to run: the entry has no offAction',
      ]),
    );
  });

  it('accepts a valid configuration and warns about unknown values', () => {
    const good = parseConfig({
      version: 2,
      trays: [{ id: 'a', label: 'A', hotkey: 'Ctrl+Alt+A', action: { run: 'x ${N}', inputs: [{ name: 'N' }] }, schedules: [{ cron: '0 9 * * 1-5', values: { N: '1', OTHER: '2' } }] }],
    });
    expect(good.ok).toBe(true);
    expect(good.ok && good.warnings.map((w) => w.path)).toEqual(['trays[0].schedules[0].values.OTHER']);
    expect(good.ok && good.config.settings.launcherHotkey).toBe('Ctrl+Alt+Space');
  });
});

describe('schedules', () => {
  it('runs "every" schedules and pauses', async () => {
    vi.useFakeTimers();
    try {
      const { engine, calls, logs } = setup({ trays: [{ id: 't', label: 'T', action: 'tick', schedules: [{ every: '10s' }] }] });
      engine.start();
      expect(engine.status(engine.get('t')!).nextRun).toBe(Date.now() + 10_000);
      await vi.advanceTimersByTimeAsync(10_010);
      expect(calls).toEqual(['tick']);
      expect(logs[0]!.source).toBe('schedule');
      engine.setSchedulesPaused(true);
      expect(engine.status(engine.get('t')!).nextRun).toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls).toEqual(['tick']);
      engine.setSchedulesPaused(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toEqual(['tick', 'tick']);
      // saving the configuration keeps the rhythm
      const before = engine.status(engine.get('t')!).nextRun;
      engine.load(ConfigSchema.parse({ version: 2, trays: [{ id: 't', label: 'T', action: 'tick', schedules: [{ every: '10s' }] }] }), 'C:\\cfg');
      engine.start();
      expect(engine.status(engine.get('t')!).nextRun).toBe(before);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a run while the previous one is still going', async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | undefined;
      const logs: ExecutionLog[] = [];
      const engine = new Engine({
        run: () => new Promise((r) => (release = () => r(ok()))),
        runAdmin: async () => ok(),
        notify: () => {},
        confirm: async () => true,
        log: (l) => logs.push(l),
      });
      engine.load(ConfigSchema.parse({ version: 2, trays: [{ id: 't', label: 'T', action: 'slow', schedules: [{ every: '5s' }] }] }), 'C:\\cfg');
      engine.start();
      await vi.advanceTimersByTimeAsync(10_010);
      expect(logs.map((l) => l.error)).toEqual(['Skipped: the previous run is still going']);
      release!();
      await vi.advanceTimersByTimeAsync(1);
      expect(logs).toHaveLength(2);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cron schedules fire at the right minute and keep going', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-20T08:58:30'));
      const { engine, calls } = setup({ trays: [{ id: 't', label: 'T', action: 'morning', schedules: [{ cron: '0 9 * * *' }] }] });
      engine.start();
      expect(engine.status(engine.get('t')!).nextRun).toBe(new Date('2026-11-20T09:00:00').getTime());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toEqual([]);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(calls).toEqual(['morning']);
      expect(engine.status(engine.get('t')!).nextRun).toBe(new Date('2026-11-21T09:00:00').getTime());
      // a day later, through many split waits
      await vi.advanceTimersByTimeAsync(24 * 3600_000);
      expect(calls).toEqual(['morning', 'morning']);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('startup schedules run once; "on" respects the state; scheduled runs never ask', async () => {
    let on = true;
    const prompt = vi.fn();
    const { engine, calls, notify } = setup(
      {
        trays: [
          { id: 'vpn', label: 'VPN', state: { check: 'check' }, action: 'connect', offAction: 'disconnect', schedules: [{ startup: true, run: 'on' }] },
          { id: 'job', label: 'Job', action: { run: 'job ${N} ${M}', confirm: 'Sure?', inputs: [{ name: 'N' }, { name: 'M', default: 'm' }] }, schedules: [{ startup: true, values: { N: 'n' } }] },
          { id: 'bad', label: 'Bad', action: { run: 'bad ${N}', inputs: [{ name: 'N' }] }, schedules: [{ startup: true }] },
          { id: 'off', label: 'Off', disabled: true, action: 'never', schedules: [{ startup: true }] },
        ],
      },
      (s) => (s === 'check' ? (on ? ok() : fail()) : ok()),
      { prompt, confirm: async () => false },
    );
    engine.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).not.toContain('connect'); // already ON
    expect(calls).toContain('job n m'); // no confirmation for scheduled runs
    expect(calls.some((c) => c.startsWith('bad'))).toBe(false);
    expect(calls).not.toContain('never');
    expect(prompt).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Bad', expect.stringContaining('scheduled runs do not ask'), 'error');
    // a reload does not run startup schedules again
    engine.stop();
    on = false;
    engine.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.filter((c) => c === 'job n m')).toHaveLength(1);
    engine.stop();
  });
});
