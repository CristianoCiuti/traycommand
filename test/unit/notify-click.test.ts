import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/main/engine';
import { ConfigSchema, parseConfig, type ConfigInput } from '../../src/shared/config';
import { renameVariable, textFields } from '../../src/shared/varRefs';
import type { RunResult } from '../../src/main/runner';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '', durationMs: 1, timedOut: false, killed: false });
const fail = (stdout: string): RunResult => ({ code: 1, stdout, stderr: '', durationMs: 1, timedOut: false, killed: false });

type Shown = { title: string; body: string; kind: string; onClick?: () => void };

function setup(input: Omit<ConfigInput, 'version'>, results: Record<string, RunResult> = {}) {
  const calls: { script: string; source?: string }[] = [];
  const shown: Shown[] = [];
  const log = vi.fn();
  const engine = new Engine({
    run: async (script) => {
      calls.push({ script });
      return results[script] ?? ok();
    },
    runAdmin: async () => ok(),
    notify: (title, body, kind, onClick) => shown.push({ title, body, kind, onClick }),
    confirm: async () => true,
    log: (e) => {
      log(e);
      calls[calls.length - 1]!.source = e.source;
    },
    env: {},
    platform: 'win32',
    recheckDelay: 1,
  });
  engine.load(ConfigSchema.parse({ version: 2, ...input }), 'C:\\cfg');
  return { engine, calls, shown, scripts: () => calls.map((c) => c.script) };
}

describe('clickable notifications', () => {
  it('keeps true and plain text working, without a click', async () => {
    const { engine, shown } = setup({
      variables: { WHO: 'VDI' },
      trays: [
        { id: 'a', label: 'A', action: { run: 'a', notify: true } },
        { id: 'b', label: 'B', action: { run: 'b', notify: '${WHO} ready' } },
      ],
    });
    await engine.click('a');
    await engine.click('b');
    expect(shown.map((s) => [s.body, s.kind, s.onClick])).toEqual([
      ['Done', 'info', undefined],
      ['VDI ready', 'info', undefined],
    ]);
  });

  it('runs the referenced entry when the success notification is clicked', async () => {
    const { engine, shown, calls, scripts } = setup({
      variables: { WHO: 'VDI' },
      trays: [
        { id: 'logon', label: 'Logon', action: { run: 'logon', notify: { text: '${WHO} ready: click to show it', click: 'vdi:on' } } },
        { id: 'vdi', label: 'VDI', state: { check: 'c' }, action: 'show', offAction: 'hide' },
      ],
    });
    await engine.click('logon');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.body).toBe('VDI ready: click to show it');
    expect(scripts()).toEqual(['logon']);
    shown[0]!.onClick!();
    await vi.waitFor(() => expect(scripts()).toContain('show'));
    expect(calls.find((c) => c.script === 'show')!.source).toBe('notification');
  });

  it('{ click } alone shows the default text', async () => {
    const { engine, shown } = setup({ trays: [{ id: 'a', label: 'A', action: { run: 'a', notify: { click: 'b' } } }, { id: 'b', label: 'B', action: 'b' }] });
    await engine.click('a');
    expect(shown[0]!.body).toBe('Done');
    expect(shown[0]!.onClick).toBeTypeOf('function');
  });

  it('"id" runs what a click on that entry does (offAction of a toggle that is ON)', async () => {
    const { engine, shown, scripts } = setup(
      {
        trays: [
          { id: 'a', label: 'A', action: { run: 'a', notify: { click: 't' } } },
          { id: 't', label: 'T', state: { check: 'c' }, action: 't-on', offAction: 't-off' },
        ],
      },
      { c: ok() },
    );
    await engine.checkNow('t');
    expect(engine.get('t')!.on).toBe(true);
    await engine.click('a');
    shown[0]!.onClick!();
    await vi.waitFor(() => expect(scripts()).toContain('t-off'));
  });

  it('failures: custom first line, the last lines of the output, and their own click', async () => {
    const { engine, shown, scripts } = setup(
      {
        trays: [
          { id: 'a', label: 'A', action: { run: 'a', notify: { text: 'ready', click: 'show' }, notifyError: { text: 'Logon failed', click: 'logs' } } },
          { id: 'show', label: 'Show', action: 'show' },
          { id: 'logs', label: 'Logs', action: 'open-logs' },
        ],
      },
      { a: fail('step 1\nwrong password') },
    );
    await engine.click('a');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ body: 'Logon failed\nstep 1\nwrong password', kind: 'error' });
    shown[0]!.onClick!();
    await vi.waitFor(() => expect(scripts()).toContain('open-logs'));
    expect(scripts()).not.toContain('show');
  });

  it('failures without notifyError keep the default text and no click (the app opens the activity log)', async () => {
    const { engine, shown } = setup({ trays: [{ id: 'a', label: 'A', action: { run: 'a', notify: { click: 'a' } } }] }, { a: fail('boom') });
    await engine.click('a');
    expect(shown[0]).toMatchObject({ body: 'Failed: Exit code 1\nboom', kind: 'error', onClick: undefined });
  });

  it('a click that asks for an action the entry does not have does nothing', async () => {
    const { engine, shown, scripts } = setup({ trays: [{ id: 'a', label: 'A', action: { run: 'a', notify: { click: 'b:off' } } }, { id: 'b', label: 'B', action: 'b' }] });
    await engine.click('a');
    shown[0]!.onClick!();
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts()).toEqual(['a']);
  });

  it('a click on a notification of an entry that no longer exists does nothing', async () => {
    const { engine, shown, scripts } = setup({ trays: [{ id: 'a', label: 'A', action: { run: 'a', notify: { click: 'b' } } }, { id: 'b', label: 'B', action: 'b' }] });
    await engine.click('a');
    engine.load(ConfigSchema.parse({ version: 2, trays: [{ id: 'a', label: 'A', action: 'a' }] }), 'C:\\cfg');
    shown[0]!.onClick!();
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts()).toEqual(['a']);
  });
});

describe('notify and notifyError in the file', () => {
  const file = (action: Record<string, unknown>, more: Record<string, unknown>[] = []) => ({ version: 2, trays: [{ id: 'a', label: 'A', action: { run: 'a', ...action } }, ...more] });

  it('accepts the object forms and checks the ids', () => {
    expect(parseConfig(file({ notify: { text: 'x', click: 'b:on' }, notifyError: { click: 'b' } }, [{ id: 'b', label: 'B', action: 'b' }])).ok).toBe(true);
    const bad = parseConfig(file({ notify: { click: 'nope' }, notifyError: { click: 'gone:off' } }));
    expect(!bad.ok && bad.issues.map((i) => [i.path, i.message])).toEqual([
      ['trays[0].action.notify.click', 'Unknown id "nope"'],
      ['trays[0].action.notifyError.click', 'Unknown id "gone"'],
    ]);
  });

  it('rejects unknown fields and bad refs', () => {
    expect(parseConfig(file({ notify: { text: 'x', clik: 'b' } })).ok).toBe(false);
    expect(parseConfig(file({ notifyError: { click: 'b:up' } })).ok).toBe(false);
  });

  it('warns when the clicked entry has no such action', () => {
    const r = parseConfig(file({ notify: { click: 'b:off' } }, [{ id: 'b', label: 'B', action: 'b' }]));
    expect(r.ok && r.warnings.map((w) => w.message)).toEqual(['"b" has no offAction: clicking the notification does nothing']);
  });

  it('the texts are listed where variables are used', () => {
    const r = parseConfig(file({ notify: { text: '${X} ok', click: 'a' }, notifyError: { text: '${X} failed' } }));
    if (!r.ok) throw new Error('invalid');
    const paths = textFields(r.config).map((f) => f.path);
    expect(paths).toContain('trays[0].action.notify.text');
    expect(paths).toContain('trays[0].action.notifyError.text');
  });

  it('renaming a variable changes the texts too', () => {
    const r = parseConfig(file({ notify: { text: '${X} ok', click: 'a' }, notifyError: { text: '${X} failed' } }));
    if (!r.ok) throw new Error('invalid');
    const renamed = renameVariable(r.config, 'X', 'Y');
    expect(renamed.trays[0]!.action).toMatchObject({ notify: { text: '${Y} ok', click: 'a' }, notifyError: { text: '${Y} failed' } });
  });
});
