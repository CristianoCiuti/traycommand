/* after: entries run only on some results of the script ({ run, when } / { run, exitCodes }); the entry stays busy for the whole chain. */
import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, afterParts, parseConfig, refOf, type ConfigInput } from '../../src/shared/config';
import { buildExport, cliExportSelection, defaultExportSelection, flatten, importSummary, noChoices, planImport, referencedIds } from '../../src/shared/transfer';
import type { RunResult } from '../../src/main/runner';
import type { ExecutionLog } from '../../src/shared/api';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], results: Record<string, Partial<RunResult>> = {}, extra: Partial<EngineDeps> = {}) {
  const calls: string[] = [];
  const logs: ExecutionLog[] = [];
  const deps: EngineDeps = {
    run: async (script) => {
      calls.push(script);
      return res(results[script]);
    },
    runAdmin: async () => res(),
    notify: vi.fn(),
    log: (l) => logs.push(l),
    env: {},
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, trays }), 'C:\\cfg');
  return { engine, calls, logs, deps };
}

const chain = (after: unknown[]) => [
  { id: 'open', label: 'Open VDI', action: { run: 'open', after } },
  { id: 'ok', label: 'Ok', action: 'ok-step' },
  { id: 'ko', label: 'Ko', action: 'ko-step' },
  { id: 'three', label: 'Three', action: 'three-step' },
  { id: 'vpn', label: 'VPN', state: { check: 'check' }, action: 'vpn-on', offAction: 'vpn-off' },
] as ConfigInput['trays'];

describe('after: configuration', () => {
  it('accepts a reference, { run, when } or { run, exitCodes }; checks the ids and refuses both conditions', () => {
    const check = (after: unknown[]) => parseConfig({ version: 2, trays: chain(after) });
    expect(check(['ok', { run: 'ok' }, { run: 'ok', when: 'success' }, { run: 'ko', when: 'failed' }, { run: 'three', when: 'always' }, { run: 'three', exitCodes: [3, -1] }]).ok).toBe(true);
    const both = check([{ run: 'ok', when: 'success', exitCodes: [0] }]);
    expect(!both.ok && both.issues).toEqual([{ path: 'trays[0].action.after[0]', message: 'Use either when or exitCodes, not both' }]);
    const unknown = check([{ run: 'ghost', when: 'success' }, 'nobody']);
    expect(!unknown.ok && unknown.issues.map((i) => i.path)).toEqual(['trays[0].action.after[0].run', 'trays[0].action.after[1]']);
    for (const bad of [{ run: 'ok', when: 'maybe' }, { run: 'ok', exitCodes: [] }, { run: 'ok', exitCodes: [1.5] }, { when: 'success' }, { run: 'ok', extra: 1 }]) {
      expect(check([bad]).ok, JSON.stringify(bad)).toBe(false);
    }
    const empty = check([{ run: 'ok', exitCodes: [] }]);
    expect(!empty.ok && empty.issues[0]!.message).toBe('Write at least one exit code');
  });

  it('afterParts and refOf read both forms', () => {
    expect(afterParts('ok:on')).toEqual({ run: 'ok:on', when: 'always' });
    expect(afterParts({ run: 'ok' })).toEqual({ run: 'ok', when: 'always', exitCodes: undefined });
    expect(afterParts({ run: 'ok', when: 'failed' })).toEqual({ run: 'ok', when: 'failed', exitCodes: undefined });
    expect(afterParts({ run: 'ok', exitCodes: [3] })).toEqual({ run: 'ok', when: 'always', exitCodes: [3] });
    expect(refOf('a:off')).toBe('a:off');
    expect(refOf({ run: 'b', when: 'success' })).toBe('b');
  });

  it('import and export: the references of the object form follow a new id', () => {
    expect(referencedIds({ label: 'x', action: { run: 'r', after: [{ run: 'a:on', when: 'success' }, 'b'] } } as never)).toEqual(['a', 'b']);
    const current = ConfigSchema.parse({ version: 2, trays: [{ id: 'net', label: 'Network', action: 'n' }] });
    const incoming = ConfigSchema.parse({
      version: 2,
      trays: [
        { id: 'net', label: 'Wi-Fi', action: 'netsh' },
        { id: 'use', label: 'Use', action: { run: 'u', after: [{ run: 'net:on', when: 'success' }, { run: 'net', exitCodes: [2] }, 'net'] } },
      ],
    });
    const pack = buildExport(incoming, defaultExportSelection(incoming)).pack;
    const plan = planImport(current, pack, { entries: {}, schedules: {}, variables: {}, settings: {} } as never);
    const use = flatten(plan.config.trays).find((f) => f.node.id === 'use')!.node;
    expect(use.action).toEqual({ run: 'u', after: [{ run: 'net_2:on', when: 'success' }, { run: 'net_2', exitCodes: [2] }, 'net_2'] });
  });
});

describe('after: engine', () => {
  const after = [
    'ok', // always
    { run: 'ok', when: 'success' },
    { run: 'ko', when: 'failed' },
    { run: 'three', exitCodes: [3] },
    { run: 'ghost', when: 'success' }, // unknown: ignored
  ];

  it('a script that succeeds runs "always" and "success" entries; the others are logged as skipped', async () => {
    const { engine, calls, logs } = setup(chain(after));
    await engine.click('open');
    expect(calls).toEqual(['open', 'ok-step']); // "ok" once: an entry runs once per chain
    const skipped = logs.filter((l) => l.skipped);
    expect(skipped.map((l) => [l.label, l.skipped, l.ok, l.script])).toEqual([
      ['Ko', 'Not run: “Open VDI” ended with exit code 0', true, 'ko-step'],
      ['Three', 'Not run: “Open VDI” ended with exit code 0', true, 'three-step'],
    ]);
    expect(skipped[0]).toMatchObject({ key: engine.get('ko')!.key, kind: 'on', code: null, durationMs: 0, source: 'click' });
  });

  it('a script that fails runs "always" and "failed" entries', async () => {
    const { engine, calls } = setup(chain(['ok', { run: 'ok', when: 'success' }, { run: 'ko', when: 'failed' }]), { open: { code: 1 } });
    await engine.click('open');
    expect(calls).toEqual(['open', 'ok-step', 'ko-step']);
    const only = setup(chain([{ run: 'ok', when: 'success' }, { run: 'ko', when: 'failed' }]), { open: { code: 1 } });
    await only.engine.click('open');
    expect(only.calls).toEqual(['open', 'ko-step']);
    expect(only.logs.find((l) => l.skipped)!.skipped).toBe('Not run: “Open VDI” ended with exit code 1');
  });

  it('exit codes: only those codes; never after a timeout, a stop or an error', async () => {
    const codes = chain([{ run: 'three', exitCodes: [3, 4] }]);
    const three = setup(codes, { open: { code: 3 } });
    await three.engine.click('open');
    expect(three.calls).toEqual(['open', 'three-step']);
    const zero = setup(codes);
    await zero.engine.click('open');
    expect(zero.calls).toEqual(['open']);
    for (const [result, why] of [
      [{ code: 3, timedOut: true }, 'timed out'],
      [{ code: 3, killed: true }, 'was stopped'],
      [{ code: null, error: 'spawn failed' }, 'spawn failed'],
    ] as const) {
      const s = setup(codes, { open: result });
      await s.engine.click('open');
      expect(s.calls).toEqual(['open']);
      expect(s.logs.find((l) => l.skipped)!.skipped).toBe(`Not run: “Open VDI” ${why}`);
    }
    // a timeout is a failure for "failed"
    const failed = setup(chain([{ run: 'ko', when: 'failed' }]), { open: { code: 0, timedOut: true } });
    await failed.engine.click('open');
    expect(failed.calls).toEqual(['open', 'ko-step']);
  });

  it('a skipped entry without that action logs an empty script; the forced action of a reference is kept', async () => {
    const { engine, calls, logs } = setup(chain([{ run: 'vpn:off', when: 'success' }, { run: 'ok:right', when: 'failed' }]));
    await engine.click('open');
    expect(calls).toEqual(['open', 'vpn-off']);
    expect(logs.find((l) => l.skipped)).toMatchObject({ label: 'Ok', kind: 'right', script: '' });
  });

  it('the entry stays busy until the last entry of after ends; a second click is refused meanwhile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const busy: boolean[] = [];
    const s = setup(chain([{ run: 'ok', when: 'success' }]), {}, {
      run: async (script) => {
        s.calls.push(script);
        if (script === 'ok-step') {
          busy.push(s.engine.get('open')!.busy, s.engine.status(s.engine.get('open')!).busy);
          await gate;
        }
        return res();
      },
    });
    const first = s.engine.click('open');
    await vi.waitFor(() => expect(s.calls).toEqual(['open', 'ok-step']));
    expect(busy).toEqual([true, true]); // the script of "open" has ended, its chain has not
    await s.engine.click('open'); // refused: still running
    expect(s.deps.notify).toHaveBeenCalledWith('Open VDI', 'Still running, try again when it finishes', 'warning');
    release();
    await first;
    expect(s.engine.get('open')!.busy).toBe(false);
    expect(s.engine.get('open')!.holds).toBe(0);
    expect(s.calls).toEqual(['open', 'ok-step']);
  });

  it('the entry is busy also while its before and parallel entries run, and those are busy too', async () => {
    const seen: Record<string, [boolean, boolean]> = {};
    const trays = [
      { id: 'main', label: 'Main', action: { run: 'main', before: ['pre'], parallel: ['side'] } },
      { id: 'pre', label: 'Pre', action: 'pre' },
      { id: 'side', label: 'Side', action: 'side' },
    ] as ConfigInput['trays'];
    const s = setup(trays, {}, {
      run: async (script) => {
        seen[script] = [s.engine.get('main')!.busy, s.engine.get(script)!.busy];
        return res();
      },
    });
    await s.engine.click('main');
    expect(seen).toEqual({ pre: [true, true], main: [true, true], side: [true, true] });
    expect(['main', 'pre', 'side'].map((id) => s.engine.get(id)!.busy)).toEqual([false, false, false]);
  });

  it('an after that runs the same entry (another action) does not free it before the chain ends', async () => {
    const states: boolean[] = [];
    const s = setup([{ id: 'vpn', label: 'VPN', state: { check: 'check' }, action: { run: 'vpn-on', after: ['vpn:off', 'other'] }, offAction: 'vpn-off' }, { id: 'other', label: 'Other', action: 'other' }], {}, {
      run: async (script) => {
        s.calls.push(script);
        if (script === 'other') states.push(s.engine.get('vpn')!.busy);
        return res(script === 'check' ? { code: 1 } : {});
      },
    });
    await s.engine.trigger(s.engine.get('vpn')!, 'on');
    expect(s.calls.filter((c) => c !== 'check')).toEqual(['vpn-on', 'vpn-off', 'other']);
    expect(states).toEqual([true]);
    expect(s.engine.get('vpn')!.busy).toBe(false);
  });

  it('a script that throws frees the entry', async () => {
    const s = setup(chain(['ok']), {}, {
      run: async (script) => {
        if (script === 'open') throw new Error('runner gone');
        return res();
      },
    });
    await expect(s.engine.click('open')).rejects.toThrow('runner gone');
    expect(s.engine.get('open')!.busy).toBe(false);
    expect(s.engine.get('open')!.holds).toBe(0);
  });
});

describe('command line export and import helpers', () => {
  const config = ConfigSchema.parse({
    version: 2,
    variables: { HOST: 'h', OTHER: 'o', DEEP: 'd', NEAR: '${DEEP}' },
    settings: { shell: 'cmd', theme: 'dark' },
    trays: [
      { id: 'a', label: 'A', action: { run: 'a ${NEAR}', after: [{ run: 'b', when: 'success' }] }, schedules: [{ every: '1h' }] },
      { id: 'b', label: 'B', action: { run: 'b ${HOST}', before: ['c'] } },
      { id: 'c', label: 'C', action: 'c', menu: [{ id: 'c1', label: 'C1', action: 'c1' }] },
      { id: 'd', label: 'D', action: 'd ${OTHER}' },
    ],
  });

  it('without ids: everything, as the export dialog proposes', () => {
    const { sel, unknown } = cliExportSelection(config);
    expect(unknown).toEqual([]);
    expect(sel).toEqual(defaultExportSelection(config));
  });

  it('with ids: those entries with their menus and schedules, and everything they need, at any depth', () => {
    const { sel, unknown } = cliExportSelection(config, ['a', 'ghost']);
    expect(unknown).toEqual(['ghost']);
    expect([...sel.entries].sort()).toEqual(['trays[0]', 'trays[1]', 'trays[2]', 'trays[2].menu[0]']);
    expect([...sel.schedules]).toEqual(['trays[0]#0']);
    expect([...sel.variables].sort()).toEqual(['DEEP', 'HOST', 'NEAR']);
    expect([...sel.settings]).toEqual([]);
  });

  it('the summary of an import: what is new, replaced or kept apart, and what comes with it', () => {
    const pack = buildExport(config, defaultExportSelection(config)).pack;
    const here = ConfigSchema.parse({ version: 2, trays: [{ id: 'c', label: 'Other C', action: 'x' }, { id: 'd', label: 'Other D', action: 'y' }] });
    const s = importSummary(planImport(here, pack, noChoices()));
    expect(s.entries.map((e) => [e.id, e.status, e.decision, e.newId])).toEqual([
      ['a', 'new', 'add', undefined],
      ['b', 'new', 'add', undefined],
      ['c', 'conflict', 'merge', undefined],
      ['c1', 'new', 'add', undefined],
      ['d', 'conflict', 'rename', 'd_2'],
    ]);
    expect(s.schedules).toEqual([]); // attached to their entries, not listed apart
    expect(s.variables.sort()).toEqual(['DEEP', 'HOST', 'NEAR', 'OTHER']);
    expect(s.settings).toEqual(['theme']); // shell needs a look first: not ticked
    expect(s.counts.add).toBeGreaterThan(0);
    expect(s.issues).toEqual([]);
    // a schedule of an entry that stays out travels alone
    const only = buildExport(config, { entries: new Set(), schedules: new Set(['trays[0]#0']), variables: new Set(), settings: new Set(['shell', 'theme']), icons: false }).pack;
    const alone = importSummary(planImport(ConfigSchema.parse({ version: 2, trays: [{ id: 'a', label: 'A', action: 'a' }] }), only, noChoices()));
    expect(alone.schedules).toEqual(['a: Every hour']);
    expect(alone.settings).toContain('theme');
  });
});
