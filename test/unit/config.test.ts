import { describe, expect, it } from 'vitest';
import { parseConfig, normalizeAction } from '../../src/shared/config';
import { expand } from '../../src/shared/variables';

const base = { version: 2 };

describe('parseConfig', () => {
  it('accepts a minimal config and fills defaults', () => {
    const result = parseConfig(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.trays).toEqual([]);
    expect(result.config.settings.theme).toBe('system');
    expect(result.config.settings.autostart).toBe(false);
    expect(result.config.settings.allowAdminCommands).toBe(false);
  });

  it('rejects unknown properties and wrong version', () => {
    expect(parseConfig({ version: 1 }).ok).toBe(false);
    const r = parseConfig({ ...base, trays: [{ id: 'a', label: 'A', commandd: 'x' }] });
    expect(r.ok).toBe(false);
  });

  it('accepts string shorthand for actions', () => {
    const r = parseConfig({ ...base, trays: [{ id: 'a', label: 'A', action: 'notepad' }] });
    expect(r.ok).toBe(true);
    expect(normalizeAction('notepad')).toEqual({ run: 'notepad' });
  });

  it('detects duplicate ids and unknown references', () => {
    const r = parseConfig({
      ...base,
      trays: [
        { id: 'a', label: 'A', action: { run: 'x', parallel: ['missing'] } },
        { id: 'a', label: 'B', enabledWhen: '!nope' },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const messages = r.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('Duplicate id "a"');
    expect(messages).toContain('Unknown id "missing"');
    expect(messages).toContain('Unknown id "nope"');
  });

  it('validates regular expressions of states', () => {
    const r = parseConfig({ ...base, trays: [{ id: 'a', label: 'A', state: { check: 'x', on: '([' } }] });
    expect(r.ok).toBe(false);
  });

  it('validates nested menus and separators', () => {
    const r = parseConfig({
      ...base,
      trays: [{ id: 't', label: 'T', menu: [{ label: 'x', action: 'a' }, { separator: true }, { label: 'sub', menu: [{ id: 'deep', label: 'd' }] }] }],
    });
    expect(r.ok).toBe(true);
  });

  it('requires appMenu to point to an existing tray', () => {
    expect(parseConfig({ ...base, settings: { appMenu: 'nope' } }).ok).toBe(false);
    expect(parseConfig({ ...base, settings: { appMenu: 't' }, trays: [{ id: 't', label: 'T' }] }).ok).toBe(true);
  });
});

describe('expand', () => {
  const ctx = { variables: { WS: '${HOME_DIR}\\ws', HOME_DIR: 'C:\\Users\\me' }, env: { USERNAME: 'me' }, configDir: 'C:\\cfg' };
  it('replaces variables, env and configDir', () => {
    expect(expand('${WS}\\a ${env:USERNAME} ${configDir}', ctx)).toBe('C:\\Users\\me\\ws\\a me C:\\cfg');
  });
  it('leaves unknown names untouched', () => {
    expect(expand('echo ${foo} $HOME', ctx)).toBe('echo ${foo} $HOME');
  });
});
