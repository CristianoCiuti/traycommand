/* Confirmation before a keyboard shortcut runs, and notifications whose click runs a choice directly. */
import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { Alerts, type AlertDeps } from '../../src/main/alerts';
import { ConfigSchema, parseConfig, type ConfigInput, type Schedule } from '../../src/shared/config';
import type { RunResult } from '../../src/main/runner';
import type { AlertRequest, PromptRequest } from '../../src/shared/api';
import { clickIndex, patchAlert, removeChoice, renameChoice } from '../../src/shared/scheduleForm';

const res = (o: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false, ...o });

function setup(trays: ConfigInput['trays'], extra: Partial<EngineDeps> = {}) {
  const calls: string[] = [];
  const prompts: PromptRequest[] = [];
  const alerts: AlertRequest[] = [];
  let answer: Record<string, string> | undefined;
  const deps: EngineDeps = {
    run: async (script) => {
      calls.push(script);
      return res();
    },
    runAdmin: async () => res(),
    notify: vi.fn(),
    confirm: async () => true,
    log: () => undefined,
    env: { NAME: 'db' },
    platform: 'win32',
    recheckDelay: 1,
    startupDelay: 1,
    prompt: async (r) => (prompts.push(r), answer),
    alert: async (r) => (alerts.push(r), r.clickChoice),
    ...extra,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, variables: { NAME: 'db' }, trays }), 'C:\\cfg');
  engine.start();
  return { engine, calls, prompts, alerts, deps, answerWith: (a: Record<string, string> | undefined) => (answer = a) };
}

describe('hotkeyConfirm: configuration', () => {
  it('accepts true or custom texts; warns without a shortcut', () => {
    const ok = parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', hotkey: 'Ctrl+Alt+K', hotkeyConfirm: { text: 'Sure?', button: 'Go' } }] });
    expect(ok.ok && ok.warnings).toEqual([]);
    const lone = parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', hotkeyConfirm: true }] });
    expect(lone.ok && lone.warnings.map((w) => w.path)).toEqual(['trays[0].hotkeyConfirm']);
    expect(parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', hotkey: 'Ctrl+Alt+K', hotkeyConfirm: { title: 'x' } }] as never }).ok).toBe(false);
  });
});

describe('hotkeyConfirm: engine', () => {
  it('no confirmation by default', async () => {
    const { engine, prompts } = setup([{ id: 'a', label: 'A', action: 'x' }]);
    expect(await engine.confirmHotkey(engine.get('a')!, 'on')).toBe(true);
    expect(prompts).toEqual([]);
  });

  it('default texts: "Run" for an action, "Turn on/off" for a toggle', async () => {
    const { engine, prompts, answerWith } = setup([
      { id: 'a', label: 'Deploy', action: 'x', hotkeyConfirm: true },
      { id: 't', label: 'VPN', action: 'on', offAction: 'off', state: { check: 'c' }, hotkeyConfirm: true },
    ]);
    answerWith({ choice: '0' });
    expect(await engine.confirmHotkey(engine.get('a')!, 'on')).toBe(true);
    expect(prompts[0]).toMatchObject({ title: 'Deploy', fields: [], submitLabel: 'Run', alert: { text: 'Run “Deploy”?', choices: ['Run'] } });
    await engine.confirmHotkey(engine.get('t')!, 'on');
    await engine.confirmHotkey(engine.get('t')!, 'off');
    expect(prompts.slice(1).map((p) => [p.alert!.text, p.alert!.choices[0]])).toEqual([
      ['Turn on “VPN”?', 'Turn on'],
      ['Turn off “VPN”?', 'Turn off'],
    ]);
  });

  it('custom texts with variables; dismissed = no run', async () => {
    const { engine, prompts, answerWith } = setup([{ id: 'a', label: 'Reset', action: 'x', hotkeyConfirm: { text: 'Reset ${NAME}?', button: 'Reset now' } }]);
    answerWith(undefined);
    expect(await engine.confirmHotkey(engine.get('a')!, 'on')).toBe(false);
    expect(prompts[0]!.alert).toEqual({ text: 'Reset db?', choices: ['Reset now'] });
    answerWith({ choice: '0' });
    expect(await engine.confirmHotkey(engine.get('a')!, 'on')).toBe(true);
  });

  it('a confirmation that cannot be shown: nothing runs, it is notified', async () => {
    const { engine, deps } = setup([{ id: 'a', label: 'A', action: 'x', hotkeyConfirm: true }], { prompt: async () => Promise.reject(new Error('boom')) });
    expect(await engine.confirmHotkey(engine.get('a')!, 'on')).toBe(false);
    expect(deps.notify).toHaveBeenCalledWith('A', expect.stringContaining('boom'), 'error');
    // something thrown that is not an Error
    const other = setup([{ id: 'a', label: 'A', action: 'x', hotkeyConfirm: true }], { prompt: async () => Promise.reject('plain') });
    expect(await other.engine.confirmHotkey(other.engine.get('a')!, 'on')).toBe(false);
    expect(other.deps.notify).toHaveBeenCalledWith('A', expect.stringContaining('plain'), 'error');
  });
});

describe('alert.click', () => {
  const schedule = (o: object = {}): Schedule => ({
    every: '1m',
    alert: { style: 'notification', text: 'Ready', choices: [{ label: 'Skip', action: 'skip' }, { label: 'Open', action: 'open' }], click: 'Open', ...o },
  });

  it('configuration: must name a choice; meant for notifications', () => {
    const check = (s: Schedule) => parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', schedules: [s] }] });
    const ok = check(schedule());
    expect(ok.ok && ok.warnings).toEqual([]);
    const bad = check(schedule({ click: 'Nope' }));
    expect(!bad.ok && bad.issues.map((i) => i.path)).toEqual(['trays[0].schedules[0].alert.click']);
    const win = check(schedule({ style: 'window' }));
    expect(win.ok && win.warnings.map((w) => w.path)).toEqual(['trays[0].schedules[0].alert.click']);
  });

  it('engine: the request carries the click choice, which runs', async () => {
    const { engine, alerts, calls } = setup([{ id: 'a', label: 'A', action: 'x' }]);
    await engine.fireSchedule(engine.get('a')!, schedule());
    expect(alerts[0]!.clickChoice).toBe(1);
    expect(calls).toEqual(['open']);
    // not for a window
    await engine.fireSchedule(engine.get('a')!, schedule({ style: 'window' }));
    expect(alerts[1]!.clickChoice).toBeUndefined();
  });

  it('on screen: a click runs the choice directly, without the window', async () => {
    const notes: { body: string; onClick: () => void }[] = [];
    const windows: PromptRequest[] = [];
    const deps: AlertDeps = {
      window: async (r) => (windows.push(r), { choice: '0' }),
      dismissWindow: () => undefined,
      notification: (o) => (notes.push(o), { close: () => undefined }),
      icon: () => undefined,
    };
    const alerts = new Alerts(deps);
    const p = alerts.show({ id: 1, style: 'notification', title: 'T', text: 'Ready', choices: ['Skip', 'Open'], clickChoice: 1 });
    expect(notes[0]!.body).toBe('Ready\nClick: Open');
    notes[0]!.onClick();
    expect(await p).toBe(1);
    expect(windows).toEqual([]);
    expect(alerts.isAnswering(1)).toBe(false);
    notes[0]!.onClick(); // a second click: nothing
    // an index out of range: the click shows the choices as before
    const q = alerts.show({ id: 2, style: 'notification', title: 'T', choices: ['A'], clickChoice: 3 });
    expect(notes[1]!.body).toBe('Click to choose: A');
    notes[1]!.onClick();
    expect(await q).toBe(0);
    expect(windows).toHaveLength(1);
  });

  it('editor: the click choice follows its button and goes away for windows', () => {
    const a = { style: 'notification' as const, text: 'x', click: 'B', choices: [{ label: 'A', run: 'self' }, { label: 'B', run: 'self' }] };
    expect(clickIndex(a)).toBe(1);
    expect(clickIndex({ text: 'x' })).toBe(-1);
    expect(clickIndex({ text: 'x', click: 'A' })).toBe(-1);
    expect(patchAlert({ style: 'notification', text: 'x', click: 'A' }, {}).click).toBeUndefined();
    expect(renameChoice(a, 1, 'B2').click).toBe('B2');
    expect(renameChoice(a, 0, 'A2').click).toBe('B');
    expect(removeChoice(a, 0)).toMatchObject({ click: 'B' });
    expect(removeChoice(a, 1).click).toBeUndefined();
    expect(patchAlert(a, { style: 'window' }).click).toBeUndefined();
    expect(patchAlert(a, { click: 'Z' }).click).toBeUndefined();
  });
});
