/* "Enabled when" made of several toggles: all of them (and), any of them (or), and groups of both. */
import { describe, expect, it } from 'vitest';
import { describeEnabled, enabledGroup, enabledHolds, enabledIds, mapEnabledIds, parseConfig, ConfigSchema, type EnabledWhen } from '../../src/shared/config';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { referencedIds } from '../../src/shared/transfer';

const nested: EnabledWhen = { all: ['vpn', { any: ['proxy', '!server'] }] };

describe('enabledWhen helpers', () => {
  it('groups, ids, mapping and words', () => {
    expect(enabledGroup('vpn')).toBeUndefined();
    expect(enabledGroup({ any: ['a'] })).toEqual({ kind: 'any', items: ['a'] });
    expect(enabledIds(nested)).toEqual(['vpn', 'proxy', 'server']);
    expect(mapEnabledIds(nested, (id) => id.toUpperCase())).toEqual({ all: ['VPN', { any: ['PROXY', '!SERVER'] }] });
    const label = (id: string) => id[0]!.toUpperCase() + id.slice(1);
    expect(describeEnabled(nested, label)).toBe('Vpn is ON and (Proxy is ON or Server is OFF)');
    expect(describeEnabled({ any: [{ all: ['a'] }] }, label)).toBe('A is ON');
    expect(describeEnabled({ all: ['a', { any: [] }] }, label)).toBe('A is ON and (nothing yet)');
  });

  it('holds: and, or, negation and nesting', () => {
    const on = (ids: string[]) => (id: string) => ids.includes(id);
    expect(enabledHolds('vpn', on(['vpn']))).toBe(true);
    expect(enabledHolds('!vpn', on(['vpn']))).toBe(false);
    expect(enabledHolds(nested, on(['vpn', 'proxy', 'server']))).toBe(true);
    expect(enabledHolds(nested, on(['vpn', 'server']))).toBe(false);
    expect(enabledHolds(nested, on(['vpn']))).toBe(true);
    expect(enabledHolds(nested, on(['proxy']))).toBe(false);
  });

  it('validation: every id of every group must exist, groups cannot be empty, ids are toggles references', () => {
    const cfg = (enabledWhen: unknown) => ({ version: 2, trays: [{ id: 'vpn', label: 'V', state: { check: 'c' }, menu: [{ id: 'x', label: 'X', enabledWhen, action: 'x' }] }] });
    expect(parseConfig(cfg({ any: ['vpn', { all: ['!vpn'] }] })).ok).toBe(true);
    const unknown = parseConfig(cfg({ all: ['vpn', { any: ['ghost'] }] }));
    expect(unknown.ok ? [] : unknown.issues).toEqual([{ path: 'trays[0].menu[0].enabledWhen', message: 'Unknown id "ghost"' }]);
    const empty = parseConfig(cfg({ all: [] }));
    expect(empty.ok ? [] : empty.issues.map((i) => i.message)).toContain('Add at least one condition');
    expect(parseConfig(cfg({ all: ['vpn'], any: ['vpn'] })).ok).toBe(false);
    expect(parseConfig(cfg('bad id!')).ok).toBe(false);
  });

  it('export follows every id of the condition', () => {
    expect(referencedIds({ label: 'x', enabledWhen: nested })).toEqual(['vpn', 'proxy', 'server']);
  });

  it('the engine enables the entry only while the whole condition holds', async () => {
    const results = new Map<string, number>();
    const deps: EngineDeps = {
      run: async (script) => ({ code: results.get(script) ?? 1, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false }),
      runAdmin: async () => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false }),
      notify: () => undefined,
      log: () => undefined,
      env: {},
      platform: 'win32',
      recheckDelay: 1,
      startupDelay: 1,
    };
    const engine = new Engine(deps);
    const toggle = (id: string) => ({ id, label: id, state: { check: id }, action: 'on' });
    engine.load(ConfigSchema.parse({ version: 2, trays: [toggle('vpn'), toggle('proxy'), toggle('server'), { id: 'go', label: 'Go', enabledWhen: nested, action: 'go' }] }), 'C:\cfg');
    const enabled = () => engine.isEnabled(engine.get('go')!);
    const check = async (on: string[]) => {
      for (const id of ['vpn', 'proxy', 'server']) {
        results.set(id, on.includes(id) ? 0 : 1);
        await engine.checkNow(id);
      }
    };
    await check(['vpn']);
    expect(enabled()).toBe(true); // VPN and (server OFF)
    await check(['vpn', 'server']);
    expect(enabled()).toBe(false);
    await check(['vpn', 'server', 'proxy']);
    expect(enabled()).toBe(true);
    await check(['proxy']);
    expect(enabled()).toBe(false);
  });
});
