/*
 * An exit code taken over by `after` ({ run, exitCodes }) is a way on, not an error; state.labelOff is the
 * text of a toggle while it is OFF.
 */
import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, parseConfig, type ConfigInput } from '../../src/shared/config';
import { renameVariable, textFields } from '../../src/shared/varRefs';
import type { RunResult } from '../../src/main/runner';
import type { ExecutionLog, PromptRequest } from '../../src/shared/api';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], results: Record<string, Partial<RunResult>> = {}) {
  const calls: string[] = [];
  const logs: ExecutionLog[] = [];
  const prompts: PromptRequest[] = [];
  const notify = vi.fn();
  const deps: EngineDeps = {
    run: async (script) => (calls.push(script), res(results[script])),
    runAdmin: async () => res(),
    notify,
    log: (l) => logs.push(l),
    env: {},
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    prompt: async (r) => (prompts.push(r), { choice: '0' }),
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, variables: { VDI: 'VDI' }, trays }), 'C:\\cfg');
  return { engine, calls, logs, prompts, notify };
}

const vdi = (after: unknown[], extra: object = {}) =>
  [
    { id: 'vdi', label: 'VDI', action: { run: 'show', after, notify: 'Shown', notifyError: { text: 'Could not show it' }, ...extra } },
    { id: 'portal', label: 'Open from the portal', action: { run: 'portal', confirm: { text: 'Download a new .ica?', button: 'Open' } } },
    { id: 'other', label: 'Other', action: 'other' },
  ] as ConfigInput['trays'];

describe('after with exitCodes: the exit codes it takes over are not errors', () => {
  it('exit 3 taken over: no error notification, no success one; the activity says where it went; the entry asks its confirmation', async () => {
    const { engine, calls, logs, prompts, notify } = setup(vdi([{ run: 'portal', exitCodes: [3] }]), { show: { code: 3 } });
    await engine.click('vdi');
    expect(calls).toEqual(['show', 'portal']);
    expect(notify).not.toHaveBeenCalledWith('VDI', expect.anything(), 'error');
    expect(notify).not.toHaveBeenCalledWith('VDI', 'Shown', 'info');
    expect(logs[0]).toMatchObject({ label: 'VDI', code: 3, ok: true, routed: 'Exit code 3: goes on with “Open from the portal”' });
    // started by a click: the confirmation of the entry run after it is asked too
    expect(prompts.map((p) => p.alert?.text)).toEqual(['Download a new .ica?']);
  });

  it('started by a schedule, the entry run after it does not ask', async () => {
    const { engine, calls, prompts } = setup(vdi([{ run: 'portal', exitCodes: [3] }]), { show: { code: 3 } });
    engine.start();
    await engine.fireSchedule(engine.get('vdi')!, { every: '1h' } as never);
    expect(calls).toEqual(['show', 'portal']);
    expect(prompts).toEqual([]);
    engine.stop();
  });

  it('every entry that takes the code over is named', async () => {
    const { engine, logs } = setup(vdi([{ run: 'portal', exitCodes: [3] }, { run: 'other', exitCodes: [3, 4] }, { run: 'ghost', exitCodes: [3] }]), { show: { code: 3 } });
    await engine.click('vdi');
    expect(logs[0]!.routed).toBe('Exit code 3: goes on with “Open from the portal”, “Other”');
  });

  it('another exit code, an entry that does not exist, a time-out or a run that could not start stay errors', async () => {
    for (const [after, result] of [
      [[{ run: 'portal', exitCodes: [3] }], { code: 4 }],
      [[{ run: 'ghost', exitCodes: [3] }], { code: 3 }],
      [[{ run: 'portal', exitCodes: [3] }], { code: 3, timedOut: true }],
      [[{ run: 'portal', exitCodes: [3] }], { code: 3, killed: true }],
      [[{ run: 'portal', exitCodes: [3] }], { code: null, error: 'spawn failed' }],
    ] as [unknown[], Partial<RunResult>][]) {
      const { engine, logs, notify } = setup(vdi(after), { show: result });
      await engine.click('vdi');
      expect(logs[0]).toMatchObject({ ok: false, routed: undefined });
      expect(notify).toHaveBeenCalledWith('VDI', expect.stringContaining('Could not show it'), 'error');
    }
  });

  it('"when": "failed" leaves a failure an error; exit 0 is a success as before', async () => {
    const failed = setup(vdi([{ run: 'portal', when: 'failed' }]), { show: { code: 3 } });
    await failed.engine.click('vdi');
    expect(failed.calls).toEqual(['show', 'portal']);
    expect(failed.logs[0]).toMatchObject({ ok: false, routed: undefined });
    expect(failed.notify).toHaveBeenCalledWith('VDI', expect.stringContaining('Could not show it'), 'error');

    const zero = setup(vdi([{ run: 'portal', exitCodes: [0, 3] }]));
    await zero.engine.click('vdi');
    expect(zero.logs[0]).toMatchObject({ ok: true, routed: undefined });
    expect(zero.notify).toHaveBeenCalledWith('VDI', 'Shown', 'info');
  });
});

describe('state.labelOff: the text of a toggle while OFF', () => {
  const status = (labelOff?: string) =>
    [{ id: 'st', label: 'VDI running (${VDI})', state: { check: 'check', interval: 60, ...(labelOff !== undefined ? { labelOff } : {}) } }] as ConfigInput['trays'];

  it('the label while ON or not checked yet, labelOff while OFF, with variables', async () => {
    const { engine } = setup(status('${VDI} not started'), { check: { code: 1 } });
    const st = engine.get('st')!;
    expect(engine.label(st)).toBe('VDI running (VDI)');
    await engine.checkNow('st');
    expect(st.on).toBe(false);
    expect(engine.label(st)).toBe('VDI not started');
    const on = setup(status('${VDI} not started'));
    await on.engine.checkNow('st');
    expect(on.engine.label(on.engine.get('st')!)).toBe('VDI running (VDI)');
  });

  it('without labelOff the label stays the same', async () => {
    const { engine } = setup(status(), { check: { code: 1 } });
    await engine.checkNow('st');
    expect(engine.label(engine.get('st')!)).toBe('VDI running (VDI)');
  });

  it('is valid only inside state; listed and renamed with the other texts', () => {
    expect(parseConfig({ version: 2, trays: status('Off') }).ok).toBe(true);
    expect(parseConfig({ version: 2, trays: [{ id: 'x', label: 'X', labelOff: 'Off', state: { check: 'c' } }] } as never).ok).toBe(false);
    const config = ConfigSchema.parse({ version: 2, variables: { VDI: 'v' }, trays: [...status('${VDI} off')!, { id: 'b', label: 'B', state: { check: 'c' } }] });
    expect(textFields(config).filter((f) => f.path.includes('labelOff')).map((f) => [f.path, f.where])).toEqual([['trays[0].state.labelOff', 'State › Name when OFF']]);
    expect(renameVariable(config, 'VDI', 'PC').trays[0]!.state!.labelOff).toBe('${PC} off');
  });
});
