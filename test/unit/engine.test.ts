import { describe, expect, it, vi } from 'vitest';
import { Engine, evaluateState, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, type ConfigInput } from '../../src/shared/config';
import type { RunResult, RunOptions } from '../../src/main/runner';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '', durationMs: 1, timedOut: false, killed: false });
const fail = (code = 1): RunResult => ({ code, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false, killed: false });

function setup(input: Omit<ConfigInput, 'version'>, responder: (script: string, o: RunOptions) => RunResult = () => ok()) {
  const calls: string[] = [];
  const notify = vi.fn();
  const deps: EngineDeps = {
    run: async (script, o) => {
      calls.push(script);
      await new Promise((r) => setTimeout(r, 5));
      return responder(script, o);
    },
    runAdmin: async (script) => {
      calls.push(`ADMIN:${script}`);
      return ok();
    },
    notify,
    confirm: async () => true,
    log: () => {},
    env: { USERPROFILE: 'C:\\Users\\me' },
    platform: 'win32',
    recheckDelay: 1,
  };
  const engine = new Engine(deps);
  engine.load(ConfigSchema.parse({ version: 2, ...input }), 'C:\\cfg');
  return { engine, calls, notify };
}

describe('evaluateState', () => {
  it('exit code decides when there are no patterns', () => {
    expect(evaluateState(ok())).toBe(true);
    expect(evaluateState(fail())).toBe(false);
  });
  it('off pattern wins over on', () => {
    expect(evaluateState(ok('Current proxy: none'), undefined, 'Current proxy: none')).toBe(false);
    expect(evaluateState(ok('Current proxy: http://x'), undefined, 'Current proxy: none')).toBe(true);
    expect(evaluateState(ok('null'), '.', '^null$')).toBe(false);
  });
  it('on pattern must match', () => {
    expect(evaluateState(ok('1'), '1')).toBe(true);
    expect(evaluateState(ok('0'), '1')).toBe(false);
  });
});

describe('Engine', () => {
  it('runs the action on click, expanding variables', async () => {
    const { engine, calls } = setup({ variables: { X: 'hello' }, trays: [{ id: 't', label: 'T', action: 'echo ${X} ${env:USERPROFILE}' }] });
    expect(await engine.click('t')).toBe(true);
    expect(calls).toEqual(['echo hello C:\\Users\\me']);
  });

  it('returns false (open menu) when there is no action', async () => {
    const { engine } = setup({ trays: [{ id: 't', label: 'T', menu: [{ label: 'a', action: 'a' }] }] });
    expect(await engine.click('t')).toBe(false);
  });

  it('toggles: click runs offAction while ON and re-checks the state', async () => {
    let state = '1';
    const { engine, calls } = setup(
      { trays: [{ id: 'p', label: 'P', state: { check: 'check', on: '1' }, action: 'on', offAction: 'off' }] },
      (script) => {
        if (script === 'off') state = '0';
        if (script === 'on') state = '1';
        return ok(script === 'check' ? state : '');
      },
    );
    await engine.checkNow('p');
    expect(engine.get('p')!.on).toBe(true);
    await engine.click('p');
    expect(calls).toContain('off');
    await engine.checkNow('p');
    expect(engine.get('p')!.on).toBe(false);
    await engine.click('p');
    expect(calls.at(-2) === 'on' || calls.includes('on')).toBe(true);
  });

  it('propagates on/off to referenced entries in parallel, before and after', async () => {
    const { engine, calls } = setup({
      trays: [
        {
          id: 'proxy',
          label: 'Proxy',
          state: { check: 'c' },
          action: { run: 'main-on', before: ['b'], parallel: ['a1', 'a2'], after: ['z:off'] },
          offAction: { run: 'main-off', parallel: ['a1'] },
          menu: [
            { id: 'a1', label: 'A1', action: 'a1-on', offAction: 'a1-off', state: { check: 'c' } },
            { id: 'a2', label: 'A2', action: 'a2-on' },
            { id: 'b', label: 'B', action: 'b-on' },
            { id: 'z', label: 'Z', action: 'z-on', offAction: 'z-off', state: { check: 'c' } },
          ],
        },
      ],
    }, (s) => (s === 'c' ? fail() : ok()));
    await engine.click('proxy');
    expect(calls[0]).toBe('b-on');
    expect(calls.slice(1, 4).sort()).toEqual(['a1-on', 'a2-on', 'main-on']);
    expect(calls[4]).toBe('z-off');
  });

  it('does not loop on circular references', async () => {
    const { engine, calls } = setup({
      trays: [
        { id: 'a', label: 'A', action: { run: 'a', parallel: ['b'] } },
        { id: 'b', label: 'B', action: { run: 'b', parallel: ['a'] } },
      ],
    });
    await engine.click('a');
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('notifies failures with the exit code and ignores stderr on success', async () => {
    const { engine, notify } = setup({ trays: [{ id: 'a', label: 'A', action: 'x' }, { id: 'b', label: 'B', action: { run: 'y', notify: 'All good' } }] }, (s) =>
      s === 'x' ? fail(3) : { ...ok(), stderr: 'warning only' },
    );
    await engine.click('a');
    expect(notify).toHaveBeenLastCalledWith('A', expect.stringContaining('Exit code 3'), 'error');
    await engine.click('b');
    expect(notify).toHaveBeenLastCalledWith('B', 'All good', 'info');
  });

  it('enabledWhen follows the state of another entry', async () => {
    let running = false;
    const { engine } = setup(
      { trays: [{ id: 'nginx', label: 'N', state: { check: 'c', on: 'nginx' }, menu: [{ id: 'stop', label: 'Stop', enabledWhen: 'nginx', action: 's' }] }] },
      () => ok(running ? 'nginx' : ''),
    );
    await engine.checkNow('nginx');
    expect(engine.isEnabled(engine.get('stop')!)).toBe(false);
    running = true;
    await engine.checkNow('nginx');
    expect(engine.isEnabled(engine.get('stop')!)).toBe(true);
  });

  it('admin actions are refused unless allowed', async () => {
    const { engine, calls, notify } = setup({ trays: [{ id: 'a', label: 'A', action: { run: 'x', admin: true } }] });
    await engine.click('a');
    expect(calls).toEqual([]);
    expect(notify).toHaveBeenCalledWith('A', expect.stringContaining('Admin commands are disabled'), 'error');

    const second = setup({ settings: { allowAdminCommands: true }, trays: [{ id: 'a', label: 'A', action: { run: 'x', admin: true } }] });
    await second.engine.click('a');
    expect(second.calls).toEqual(['ADMIN:x']);
  });

  it('does not check hidden or disabled entries', async () => {
    const { engine, calls } = setup({ trays: [{ id: 'h', label: 'H', hidden: true, state: { check: 'hidden-check' } }] });
    engine.start();
    await new Promise((r) => setTimeout(r, 30));
    engine.stop();
    expect(calls).not.toContain('hidden-check');
  });

  it('resolves icons relative to the config folder and switches to iconOff', async () => {
    const { engine } = setup({ trays: [{ id: 't', label: 'T', icon: 'icon/on.png', state: { check: 'c', iconOff: 'icon/off.png' } }] }, () => fail());
    await engine.checkNow('t');
    expect(engine.iconFor(engine.get('t')!)).toMatch(/cfg[\\/]icon[\\/]off\.png$/);
  });
});
