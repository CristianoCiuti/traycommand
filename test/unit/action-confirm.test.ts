/* action.confirm: a string or { text, button }, asked in the TrayCommand window like hotkeyConfirm. */
import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, confirmTexts, parseConfig, type ConfigInput } from '../../src/shared/config';
import { renameVariable, textFields } from '../../src/shared/varRefs';
import type { RunResult } from '../../src/main/runner';
import type { PromptRequest } from '../../src/shared/api';

const res = (): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false });

function setup(trays: ConfigInput['trays'], extra: Partial<EngineDeps> = {}) {
  const calls: string[] = [];
  const prompts: PromptRequest[] = [];
  let answer: Record<string, string> | undefined = { choice: '0' };
  const deps: EngineDeps = {
    run: async (script) => (calls.push(script), res()),
    runAdmin: async () => res(),
    notify: vi.fn(),
    log: () => undefined,
    env: {},
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    prompt: async (r) => (prompts.push(r), r.alert ? answer : { WHAT: 'logs' }),
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, variables: { VDI: 'VDI' }, trays }), 'C:\\cfg');
  return { engine, calls, prompts, deps, answerWith: (a: Record<string, string> | undefined) => (answer = a) };
}

describe('action.confirm: configuration', () => {
  it('accepts a string or { text, button? }; nothing else', () => {
    const check = (confirm: unknown) => parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: { run: 'x', confirm } }] } as never).ok;
    expect(check('Sure?')).toBe(true);
    expect(check({ text: 'Riavviare la VDI?' })).toBe(true);
    expect(check({ text: 'Riavviare la VDI?', button: 'Riavvia' })).toBe(true);
    expect(check({ button: 'Riavvia' })).toBe(false); // the question is required
    expect(check({ text: 'x', title: 'y' })).toBe(false);
    expect(check(true)).toBe(false);
  });

  it('confirmTexts gives the same shape for both forms', () => {
    expect(confirmTexts(undefined)).toBeUndefined();
    expect(confirmTexts('Sure?')).toEqual({ text: 'Sure?' });
    expect(confirmTexts({ text: 'Sure?', button: 'Go' })).toEqual({ text: 'Sure?', button: 'Go' });
  });

  it('the texts of the object form are listed and renamed like the others', () => {
    const config = ConfigSchema.parse({
      version: 2,
      variables: { VDI: 'v' },
      trays: [
        { id: 'a', label: 'A', action: { run: 'x', confirm: { text: 'Restart ${VDI}?', button: 'Restart ${VDI}' } } },
        { id: 'b', label: 'B', action: { run: 'x', confirm: { text: 'Plain' } } },
      ],
    });
    const fields = textFields(config).filter((f) => f.path.includes('confirm'));
    expect(fields.map((f) => [f.path, f.where])).toEqual([
      ['trays[0].action.confirm.text', 'Click › Confirmation'],
      ['trays[0].action.confirm.button', 'Click › Confirm button'],
      ['trays[1].action.confirm.text', 'Click › Confirmation'],
    ]);
    const renamed = renameVariable(config, 'VDI', 'PC');
    expect(renamed.trays[0]!.action).toMatchObject({ confirm: { text: 'Restart ${PC}?', button: 'Restart ${PC}' } });
  });
});

describe('action.confirm: engine', () => {
  it('the string form asks in the TrayCommand window with the "Run" button', async () => {
    const { engine, calls, prompts } = setup([{ id: 'a', label: 'Reset', icon: 'r.png', action: { run: 'reset', confirm: 'Reset ${VDI}?' } }]);
    await engine.click('a');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ title: 'Reset', fields: [], submitLabel: 'Run', alert: { text: 'Reset VDI?', choices: ['Run'] } });
    expect(calls).toEqual(['reset']);
  });

  it('the object form uses its own button, with variables and typed values', async () => {
    const { engine, calls, prompts } = setup([
      { id: 'a', label: 'VDI', action: { run: 'restart ${WHAT}', inputs: [{ name: 'WHAT' }], confirm: { text: 'Riavviare la ${VDI} (${WHAT})?', button: 'Riavvia ${WHAT}' } } },
    ]);
    await engine.click('a');
    expect(prompts[1]!.alert).toEqual({ text: 'Riavviare la VDI (logs)?', choices: ['Riavvia logs'] });
    expect(prompts[1]!.submitLabel).toBe('Riavvia logs');
    expect(calls).toEqual(['restart logs']);
  });

  it('an empty button text means "Run"; an empty question asks nothing', async () => {
    const { engine, calls, prompts } = setup([
      { id: 'a', label: 'A', action: { run: 'a', confirm: { text: 'Sure?', button: ' ' } } },
      { id: 'b', label: 'B', action: { run: 'b', confirm: { text: '', button: 'Go' } } },
    ]);
    await engine.click('a');
    await engine.click('b');
    expect(prompts.map((p) => p.alert!.choices[0])).toEqual(['Run']);
    expect(calls).toEqual(['a', 'b']);
  });

  it('Esc / Cancel (no choice) runs nothing, nor the composed actions', async () => {
    const { engine, calls, answerWith } = setup([
      { id: 'a', label: 'A', action: { run: 'a', before: ['b'], confirm: { text: 'Sure?', button: 'Riavvia' } } },
      { id: 'b', label: 'B', action: 'b' },
    ]);
    answerWith(undefined);
    await engine.click('a');
    expect(calls).toEqual([]);
  });

  it('every trigger started by a person asks: click, launcher, shortcut, alert choice, notification click, command line', async () => {
    const { engine, prompts, answerWith } = setup([{ id: 'a', label: 'A', action: { run: 'a', confirm: 'Sure?' } }]);
    answerWith(undefined);
    const entry = engine.get('a')!;
    for (const source of ['click', 'launcher', 'hotkey', 'alert', 'notification', 'cli'] as const) await engine.trigger(entry, 'on', { source });
    expect(prompts).toHaveLength(6);
  });

  it('without the window, the fallback confirm is used (and without it, the run goes ahead)', async () => {
    const confirm = vi.fn(async () => false);
    const asked = setup([{ id: 'a', label: 'A', action: { run: 'a', confirm: { text: 'Sure?', button: 'Go' } } }], { prompt: undefined, confirm });
    await asked.engine.click('a');
    expect(confirm).toHaveBeenCalledWith('A', 'Sure?', 'Go');
    expect(asked.calls).toEqual([]);
    const bare = setup([{ id: 'a', label: 'A', action: { run: 'a', confirm: 'Sure?' } }], { prompt: undefined });
    await bare.engine.click('a');
    expect(bare.calls).toEqual(['a']);
  });
});
