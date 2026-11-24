import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config, type ConfigInput } from '../../src/shared/config';
import {
  PACK_FORMAT,
  buildExport,
  changedSettings,
  checkedDecision,
  defaultExportSelection,
  describeSchedule,
  entryCheck,
  exportDependencies,
  exportKind,
  flatten,
  iconFileName,
  includeDependencies,
  isEmptySelection,
  noChoices,
  packCount,
  packIcons,
  planChanges,
  planImport,
  readPack,
  referencedIds,
  referencedVariables,
  scheduleExportable,
  scheduleRows,
  sectionCheck,
  setCheck,
  stableJson,
  tidySeparators,
  toggleEntry,
  toggleKey,
  toggleSection,
  type ExportSelection,
  type ImportChoices,
  type Pack,
} from '../../src/shared/transfer';

const config = (input: Partial<ConfigInput> = {}): Config => ConfigSchema.parse({ version: 2, ...input });

const base = () =>
  config({
    variables: { DIR: 'C:\\x', OTHER: '${DIR}\\y', UNUSED: 'z' },
    settings: { theme: 'dark' },
    trays: [
      {
        id: 'docker',
        label: 'Docker',
        icon: 'icons/docker.png',
        state: { check: 'docker ps', iconOff: 'C:\\art\\docker-off.png' },
        action: { run: 'start', before: ['net'] },
        hotkey: 'Ctrl+Alt+D',
        schedules: [{ every: '1h' }],
        menu: [{ id: 'up', label: 'Up', action: 'compose up ${DIR}', schedules: [{ cron: '0 9 * * *' }] }, { separator: true }, { id: 'down', label: 'Down', action: 'compose down' }],
      },
      { id: 'net', label: 'Network', action: 'ipconfig ${OTHER}', enabledWhen: '!docker' },
      {
        id: 'tools',
        label: 'Tools',
        menu: [
          { label: 'No id', action: 'x', schedules: [{ startup: true }] },
          { id: 'ask', label: 'Ask', action: 'y', schedules: [{ every: '5m', alert: { choices: [{ label: 'Go', run: 'down:off' }, { label: 'Me', run: 'self' }] } }] },
        ],
      },
    ],
  });

const none = (c: Config): ExportSelection => toggleSection(c, { ...defaultExportSelection(c), variables: new Set(), settings: new Set() }, 'entries', false);
const choices = (o: Partial<ImportChoices> = {}): ImportChoices => ({ ...noChoices(), ...o });

describe('export: selection', () => {
  it('starts with everything but the settings left at their default', () => {
    const c = base();
    const sel = defaultExportSelection(c);
    expect([...sel.entries]).toEqual(['trays[0]', 'trays[0].menu[0]', 'trays[0].menu[2]', 'trays[1]', 'trays[2]', 'trays[2].menu[0]', 'trays[2].menu[1]']);
    expect([...sel.schedules]).toEqual(['trays[0]#0', 'trays[0].menu[0]#0', 'trays[2].menu[0]#0', 'trays[2].menu[1]#0']);
    expect([...sel.variables]).toEqual(['DIR', 'OTHER', 'UNUSED']);
    expect([...sel.settings]).toEqual(['theme']);
    expect(sel.icons).toBe(true);
    expect(changedSettings(c.settings)).toEqual(['theme']);
  });

  it('an entry goes with everything inside it, and brings its parents', () => {
    const c = base();
    let sel = toggleEntry(c, defaultExportSelection(c), 'trays[0]', false);
    expect([...sel.entries].filter((k) => k.startsWith('trays[0]'))).toEqual([]);
    expect([...sel.schedules].filter((k) => k.startsWith('trays[0]'))).toEqual([]);
    expect(entryCheck(c, sel, 'trays[0]')).toBe('none');
    sel = toggleEntry(c, sel, 'trays[0].menu[2]', true);
    expect(sel.entries.has('trays[0]')).toBe(true);
    expect(sel.entries.has('trays[0].menu[0]')).toBe(false);
    expect(entryCheck(c, sel, 'trays[0]')).toBe('some');
    expect(entryCheck(c, sel, 'trays[0].menu[2]')).toBe('all');
    // a parent brought along keeps its own schedules as they were (unchecked)
    expect(sel.schedules.has('trays[0]#0')).toBe(false);
    expect(sectionCheck(c, sel, 'entries')).toBe('some');
  });

  it('sections are checked and unchecked as a whole', () => {
    const c = base();
    let sel = toggleSection(c, defaultExportSelection(c), 'entries', false);
    expect(sel.entries.size).toBe(0);
    expect(sel.schedules.size).toBe(0);
    expect(sectionCheck(c, sel, 'entries')).toBe('none');
    sel = toggleSection(c, sel, 'settings', true);
    expect(sectionCheck(c, sel, 'settings')).toBe('all');
    sel = toggleKey(sel, 'settings', 'theme', false);
    expect(sectionCheck(c, sel, 'settings')).toBe('some');
    sel = toggleKey(sel, 'variables', 'NEW', true);
    expect(sel.variables.has('NEW')).toBe(true);
    expect(sectionCheck(c, sel, 'schedules')).toBe('none');
    expect(sectionCheck(c, sel, 'variables')).toBe('all');
    sel = toggleSection(c, sel, 'variables', false);
    expect(sectionCheck(c, sel, 'variables')).toBe('none');
    expect(setCheck(0, 0)).toBe('none');
    expect(setCheck(2, 2)).toBe('all');
  });

  it('a schedule of an entry left out travels alone only when the entry has an id', () => {
    const c = base();
    const sel = toggleEntry(c, defaultExportSelection(c), 'trays[2]', false);
    const rows = scheduleRows(c);
    const noId = rows.find((r) => r.entryKey === 'trays[2].menu[0]')!;
    const ask = rows.find((r) => r.entryKey === 'trays[2].menu[1]')!;
    expect(scheduleExportable(sel, noId)).toBe(false);
    expect(scheduleExportable(sel, ask)).toBe(true);
    const withSchedules = toggleKey(toggleKey(sel, 'schedules', noId.key, true), 'schedules', ask.key, true);
    const { pack } = buildExport(c, withSchedules);
    expect(pack.schedules).toEqual([{ entry: 'ask', label: 'Tools › Ask', schedule: (c.trays[2]!.menu![1] as { schedules: unknown[] }).schedules[0] }]);
    expect(pack.trays.map((t) => t.id)).toEqual(['docker', 'net']);
  });

  it('nothing selected is an empty export', () => {
    const c = base();
    expect(isEmptySelection(c, none(c))).toBe(true);
    expect(isEmptySelection(c, defaultExportSelection(c))).toBe(false);
  });
});

describe('export: content', () => {
  it('copies the entries chosen, with icons renamed into icons/', () => {
    const c = base();
    const { pack, icons } = buildExport(c, defaultExportSelection(c), { app: '2.5.0', created: 'now' });
    expect(pack.traycommandExport).toBe(PACK_FORMAT);
    expect(pack.app).toBe('2.5.0');
    expect(icons).toEqual([
      { raw: 'icons/docker.png', name: 'docker.png' },
      { raw: 'C:\\art\\docker-off.png', name: 'docker-off.png' },
    ]);
    const docker = pack.trays[0]!;
    expect(docker.icon).toBe('icons/docker.png');
    expect(docker.state?.iconOff).toBe('icons/docker-off.png');
    expect(docker.menu).toHaveLength(3);
    expect(pack.variables).toEqual(c.variables);
    expect(pack.settings).toEqual({ theme: 'dark' });
    expect(pack.schedules).toEqual([]);
    // the configuration itself is untouched
    expect(c.trays[0]!.icon).toBe('icons/docker.png');
    expect(packCount(pack)).toBe(3 + 3 + 1);
  });

  it('without icons the icon fields are left out', () => {
    const c = base();
    const { pack, icons } = buildExport(c, { ...defaultExportSelection(c), icons: false });
    expect(icons).toEqual([]);
    expect(pack.trays[0]!.icon).toBeUndefined();
    expect(pack.trays[0]!.state?.iconOff).toBeUndefined();
  });

  it('menus keep only what is chosen, without stray separators', () => {
    const c = base();
    let sel = none(c);
    sel = toggleEntry(c, sel, 'trays[0].menu[2]', true);
    const { pack } = buildExport(c, sel);
    expect(pack.trays).toHaveLength(1);
    expect(pack.trays[0]!.menu).toEqual([{ id: 'down', label: 'Down', action: 'compose down' }]);
    expect(pack.trays[0]!.schedules).toBeUndefined();
    // a tray whose whole menu is left out has no menu
    sel = toggleEntry(c, toggleEntry(c, none(c), 'trays[2]', true), 'trays[2].menu[0]', false);
    sel = toggleEntry(c, sel, 'trays[2].menu[1]', false);
    expect(buildExport(c, sel).pack.trays[0]!.menu).toBeUndefined();
  });

  it('two icons with the same file name get different names', () => {
    const c = config({ trays: [{ id: 'a', label: 'A', icon: 'one/x.png', menu: [{ id: 'b', label: 'B', icon: 'two/X.png' }, { id: 'c', label: 'C', icon: 'one/x.png' }] }] });
    const { icons, pack } = buildExport(c, defaultExportSelection(c));
    expect(icons).toEqual([
      { raw: 'one/x.png', name: 'x.png' },
      { raw: 'two/X.png', name: 'X-2.png' },
    ]);
    expect((pack.trays[0]!.menu![1] as { icon: string }).icon).toBe('icons/x.png');
    const bare = config({ trays: [{ id: 'a', label: 'A', icon: 'one/icon', menu: [{ id: 'b', label: 'B', icon: 'two/icon' }] }] });
    expect(buildExport(bare, defaultExportSelection(bare)).icons.map((i) => i.name)).toEqual(['icon', 'icon-2']);
  });

  it('a single thing without icons is a JSON file, anything more a zip', () => {
    const c = base();
    const one = buildExport(c, { ...toggleEntry(c, none(c), 'trays[1]', true), icons: false });
    expect(exportKind(one.pack, one.icons.length)).toBe('json');
    expect(exportKind(one.pack, 1)).toBe('zip');
    const two = buildExport(c, toggleKey(toggleEntry(c, none(c), 'trays[1]', true), 'variables', 'DIR', true));
    expect(exportKind(two.pack, 0)).toBe('zip');
  });

  it('file names of icons', () => {
    expect(iconFileName('C:\\icons\\My Icon.png')).toBe('My_Icon.png');
    expect(iconFileName('${configDir}/a.ico')).toBe('a.ico');
    expect(iconFileName('${ICON}')).toBe('icon.png');
    expect(iconFileName('icons/${APP}.png')).toBe('icon.png');
    expect(iconFileName('icons/${APP}.')).toBe('icon.png');
    expect(iconFileName('/x/.hidden')).toBe('icon.hidden');
    expect(iconFileName('/x/..png')).toBe('icon.png');
    expect(iconFileName('CON.png')).toBe('icon-CON.png');
    expect(iconFileName('nul')).toBe('icon-nul');
    expect(iconFileName('console.png')).toBe('console.png');
  });

  it('separators are tidied', () => {
    const s = { separator: true as const };
    const e = { label: 'E' };
    expect(tidySeparators([s, e, s, s, e, s])).toEqual([e, s, e]);
    expect(tidySeparators([s])).toEqual([]);
  });
});

describe('export: what the selection needs', () => {
  it('entries run before, enabledWhen, alert buttons and variables', () => {
    const c = base();
    const docker = toggleEntry(c, none(c), 'trays[0]', true);
    const deps = exportDependencies(c, docker);
    expect(deps.entries.map((d) => d.id)).toEqual(['net']);
    expect(deps.entries[0]).toMatchObject({ key: 'trays[1]', label: 'Network', by: 'Docker' });
    expect(deps.variables).toEqual([{ name: 'DIR', by: 'Docker › Up' }]);
    const more = includeDependencies(c, docker, deps);
    expect(more.entries.has('trays[1]')).toBe(true);
    expect(more.variables.has('DIR')).toBe(true);
    // Network uses ${OTHER}, which uses ${DIR}: one step at a time
    expect(exportDependencies(c, more).variables).toEqual([{ name: 'OTHER', by: 'Network' }]);
    const withOther = toggleKey(more, 'variables', 'OTHER', true);
    expect(exportDependencies(c, withOther)).toEqual({ entries: [], variables: [] });
    expect(exportDependencies(c, toggleKey(toggleKey(none(c), 'variables', 'OTHER', true), 'variables', 'DIR', false)).variables).toEqual([{ name: 'DIR', by: '${OTHER}' }]);
  });

  it('a schedule exported alone needs the entries its buttons run', () => {
    const c = base();
    const sel = toggleKey(none(c), 'schedules', 'trays[2].menu[1]#0', true);
    expect(exportDependencies(c, sel).entries.map((d) => d.id)).toEqual(['down']);
  });

  it('references', () => {
    expect(referencedIds({ label: 'x', action: 'run', offAction: { run: 'y', after: ['a', 'b:on'], parallel: ['c'] }, rightAction: { run: 'z', before: ['a:off'] }, enabledWhen: 'd' } as never)).toEqual(['c', 'a', 'b', 'd']);
    expect(referencedIds({ label: 'x', action: { run: 'r', notify: { click: 'e:on' }, notifyError: { click: 'f' } } } as never)).toEqual(['e', 'f']);
    expect(referencedVariables({ a: '${A} ${env:B} ${configDir} ${A}' })).toEqual(['A']);
  });

  it('describes schedules', () => {
    expect(describeSchedule({ cron: '0 9 * * 1-5' })).toBe('At 09:00 on weekdays');
    expect(describeSchedule({ every: '15m', between: '08:00-18:00' })).toBe('Every 15 minutes from 08:00 to 18:00');
    expect(describeSchedule({ every: 'bad' })).toBe('Every 0 seconds');
    expect(describeSchedule({ watch: { path: 'C:\\in', files: ['*.txt', '*.csv'] } })).toBe('When files change in C:\\in (*.txt, *.csv)');
    expect(describeSchedule({ watch: { path: 'C:\\in' }, disabled: true })).toBe('When files change in C:\\in (off)');
    expect(describeSchedule({ startup: true })).toBe('When TrayCommand starts');
  });

  it('stable JSON ignores key order', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('import: reading files', () => {
  it('an export', () => {
    const r = readPack({ traycommandExport: 1, trays: [{ id: 'a', label: 'A' }], settings: { theme: 'light' } });
    expect(r).toEqual({ ok: true, kind: 'export', pack: { traycommandExport: 1, trays: [{ id: 'a', label: 'A' }], schedules: [], variables: {}, settings: { theme: 'light' } } });
  });

  it('a whole configuration file: only the settings written in it', () => {
    const r = readPack({ version: 2, settings: { theme: 'dark' }, variables: { A: '1' }, trays: [{ id: 'a', label: 'A' }] });
    expect(r.ok && r.kind).toBe('config');
    expect(r.ok && r.pack.settings).toEqual({ theme: 'dark' });
    expect(r.ok && r.pack.variables).toEqual({ A: '1' });
    expect(readPack({ version: 2, trays: [] }).ok).toBe(true);
    // without trays (only variables)
    expect(readPack({ version: 2, variables: { A: '1' } })).toMatchObject({ ok: true, pack: { trays: [], variables: { A: '1' } } });
  });

  it('explains what is wrong', () => {
    expect(readPack(null)).toEqual({ ok: false, error: 'This file is not a TrayCommand export or configuration' });
    expect(readPack([1])).toMatchObject({ ok: false });
    expect(readPack({ hello: 1 })).toEqual({ ok: false, error: 'This file is not a TrayCommand export or configuration' });
    expect(readPack({ traycommandExport: 9 })).toEqual({ ok: false, error: 'This export was made by a newer TrayCommand: update TrayCommand to import it' });
    expect(readPack({ traycommandExport: 1, trays: [{ label: 'no id' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/^trays\[0\]\.id: /) });
    expect(readPack({ traycommandExport: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/^traycommandExport: /) });
    expect(readPack({ traycommandExport: 1, settings: { theme: 'pink' } })).toMatchObject({ ok: false, error: expect.stringMatching(/^settings\.theme: /) });
    expect(readPack({ version: 2, trays: [], settings: { theme: 'pink' } })).toMatchObject({ ok: false, error: expect.stringMatching(/^settings\.theme: /) });
    expect(readPack({ version: 1, trays: [] })).toEqual({ ok: false, error: 'Configuration format 1 is not supported (open it once with TrayCommand 2 to convert it)' });
    expect(readPack({ version: 2, trays: [], other: 1 })).toMatchObject({ ok: false, error: expect.not.stringMatching(/^\S+: /) });
    expect(readPack({ version: 2, trays: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/^trays: /) });
    expect(readPack({ traycommandExport: 1, trays: [{ id: 'a', label: 'A', menu: [{ label: 'no id' }, { id: 'a', label: 'B' }] }] })).toEqual({ ok: false, error: 'The id "a" is used twice in the file' });
    // an error without a path
    expect(readPack({ traycommandExport: 1, schedules: 5 })).toMatchObject({ ok: false });
  });

  it('lists the icons used', () => {
    const c = base();
    expect(packIcons(buildExport(c, defaultExportSelection(c)).pack)).toEqual(['icons/docker.png', 'icons/docker-off.png']);
  });
});

const exportOf = (c: Config, sel = defaultExportSelection(c)): Pack => buildExport(c, sel).pack;

describe('import: plan', () => {
  it('into an empty configuration everything is new', () => {
    const c = base();
    const plan = planImport(config(), exportOf(c), noChoices());
    expect(plan.entries.map((r) => [r.key, r.status, r.decision])).toEqual([
      ['trays[0]', 'new', 'add'],
      ['trays[0].menu[0]', 'new', 'add'],
      ['trays[0].menu[2]', 'new', 'add'],
      ['trays[1]', 'new', 'add'],
      ['trays[2]', 'new', 'add'],
      ['trays[2].menu[0]', 'new', 'add'],
      ['trays[2].menu[1]', 'new', 'add'],
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.config.trays.map((t) => t.id)).toEqual(['docker', 'net', 'tools']);
    expect(plan.config.trays[0]!.menu).toHaveLength(3);
    expect(plan.config.variables).toEqual(c.variables);
    expect(plan.config.settings.theme).toBe('dark');
    expect(plan.counts).toEqual({ add: 7, replace: 0, merge: 0, rename: 0, schedules: 0, variables: 3, settings: 1 });
    expect(plan.icons).toEqual(['icons/docker.png', 'icons/docker-off.png']);
    expect(planChanges(plan)).toBe(11);
  });

  it('its own export changes nothing', () => {
    const c = base();
    const plan = planImport(c, exportOf(c, { ...defaultExportSelection(c), icons: false }), noChoices());
    // the icons are left out of this export: the entries with icons differ
    expect(plan.entries.filter((r) => r.status === 'identical').map((r) => r.key)).toEqual(['trays[0].menu[0]', 'trays[0].menu[2]', 'trays[1]', 'trays[2]']);
    // what is inside an identical tray is not imported either
    expect(plan.entries.filter((r) => r.status === 'inside').map((r) => r.key)).toEqual(['trays[2].menu[0]', 'trays[2].menu[1]']);
    const same = planImport(c, exportOf(c), noChoices());
    expect(same.entries.every((r) => r.status === 'identical' || r.status === 'inside')).toBe(true);
    expect(planChanges(same)).toBe(0);
    expect(same.variables.every((v) => v.status === 'same' && !v.checked)).toBe(true);
    expect(same.settings).toEqual([{ name: 'theme', value: 'dark', current: 'dark', status: 'same', checked: false, caution: undefined }]);
    expect(stableJson(same.config)).toBe(stableJson(c));
  });

  it('a tray with the same id: its menu is merged, keeping its own settings', () => {
    const c = base();
    const other = config({ trays: [{ id: 'docker', label: 'Docker', action: 'different', menu: [{ id: 'up', label: 'Up', action: 'compose up ${DIR}', schedules: [{ cron: '0 9 * * *' }] }, { separator: true }, { id: 'logs', label: 'Logs', action: 'compose logs' }] }] });
    const plan = planImport(c, exportOf(other), noChoices());
    expect(plan.entries.map((r) => [r.key, r.status, r.decision])).toEqual([
      ['trays[0]', 'conflict', 'merge'],
      ['trays[0].menu[0]', 'identical', 'skip'],
      ['trays[0].menu[2]', 'new', 'add'],
    ]);
    expect(plan.entries[0]!.options).toEqual(['merge', 'replace', 'rename']);
    expect(plan.entries[0]!.existing).toEqual({ label: 'Docker', where: '', differs: true });
    const docker = plan.config.trays[0]!;
    expect(docker.action).toEqual({ run: 'start', before: ['net'] });
    expect(docker.menu!.map((m) => ('label' in m ? m.label : '---'))).toEqual(['Up', '---', 'Down', '---', 'Logs']);
    expect(plan.counts.merge).toBe(1);
    expect(plan.issues).toEqual([]);
  });

  it('replace puts the imported one in place of the old one', () => {
    const c = base();
    const other = config({ trays: [{ id: 'x', label: 'X' }, { id: 'docker', label: 'Docker 2', action: 'different', menu: [{ id: 'logs', label: 'Logs', action: 'l' }] }] });
    const plan = planImport(c, exportOf(other), choices({ entries: { 'trays[1]': 'replace' } }));
    expect(plan.config.trays.map((t) => t.label)).toEqual(['Docker 2', 'Network', 'Tools', 'X']);
    expect(plan.config.trays[0]!.menu).toEqual([{ id: 'logs', label: 'Logs', action: 'l' }]);
    // "net" ran before "docker": still valid; the old menu (up, down) is gone: the alert of "ask" now points nowhere
    expect(plan.issues.map((i) => i.message)).toEqual(['Unknown id "down"']);
    // replaced by a tray without menu
    const flat = planImport(c, exportOf(config({ trays: [{ id: 'docker', label: 'Docker', action: 'a' }] })), choices({ entries: { 'trays[0]': 'replace' } }));
    expect(flat.config.trays[0]!.menu).toBeUndefined();
    // replaced by a tray whose entries are all skipped
    const skipped = planImport(c, exportOf(config({ trays: [{ id: 'docker', label: 'D', menu: [{ id: 'z', label: 'Z' }] }] })), choices({ entries: { 'trays[0]': 'replace', 'trays[0].menu[0]': 'skip' } }));
    expect(skipped.config.trays[0]!.menu).toBeUndefined();
  });

  it('an entry with the same id and another label is kept apart, with a new id; references follow it', () => {
    const c = base();
    const other = config({
      trays: [
        { id: 'net', label: 'Wi-Fi', action: 'netsh' },
        { id: 'menu', label: 'Menu', menu: [{ id: 'use', label: 'Use', enabledWhen: '!net', action: { run: 'u', after: ['net'] }, schedules: [{ every: '1m', alert: { choices: [{ label: 'N', run: 'net:right' }, { label: 'S', run: 'self' }, { label: 'O', run: 'other' }] } }] }, { id: 'other', label: 'O', action: 'o' }] },
      ],
    });
    const plan = planImport(c, exportOf(other), noChoices());
    expect(plan.entries[0]).toMatchObject({ status: 'conflict', decision: 'rename', newId: 'net_2', options: ['replace', 'rename'] });
    const use = flatten(plan.config.trays).find((f) => f.node.id === 'use')!.node;
    expect(use.enabledWhen).toBe('!net_2');
    expect(use.action).toEqual({ run: 'u', after: ['net_2'] });
    expect(use.schedules![0]!.alert!.choices!.map((ch) => ch.run)).toEqual(['net_2:right', 'self', 'other']);
    expect(plan.issues).toEqual([]);
    // clicks on the notifications follow the new id too
    const clicks = planImport(
      c,
      exportOf(config({ trays: [{ id: 'net', label: 'Wi-Fi', action: 'netsh' }, { id: 'n', label: 'N', action: { run: 'x', notify: { text: 'ok', click: 'net' }, notifyError: { click: 'net:right' } } }] })),
      noChoices(),
    );
    expect(flatten(clicks.config.trays).find((f) => f.node.id === 'n')!.node.action).toEqual({ run: 'x', notify: { text: 'ok', click: 'net_2' }, notifyError: { click: 'net_2:right' } });
    // same label: replaced
    const same = planImport(c, exportOf(config({ trays: [{ id: 'net', label: 'Network', action: 'new' }] })), noChoices());
    expect(same.entries[0]!.decision).toBe('replace');
    expect(same.config.trays[1]!.action).toBe('new');
    // a choice that is not possible here falls back to the proposed one
    const wrong = planImport(c, exportOf(config({ trays: [{ id: 'net', label: 'Network', action: 'new' }] })), choices({ entries: { 'trays[0]': 'merge' } }));
    expect(wrong.entries[0]!.decision).toBe('replace');
  });

  it('a new id is free in the configuration and in the file', () => {
    const c = config({ trays: [{ id: 'a', label: 'A' }, { id: 'a_2', label: 'A2' }] });
    const plan = planImport(c, exportOf(config({ trays: [{ id: 'a', label: 'Other' }, { id: 'a_3', label: 'Three' }] })), noChoices());
    expect(plan.entries[0]!.newId).toBe('a_4');
  });

  it('a tray and a menu entry with the same id can only be kept apart', () => {
    const c = base();
    const plan = planImport(c, exportOf(config({ trays: [{ id: 'up', label: 'Up', action: 'compose up ${DIR}', schedules: [{ cron: '0 9 * * *' }] }] })), noChoices());
    expect(plan.entries[0]).toMatchObject({ status: 'conflict', options: ['rename'], decision: 'rename', existing: { where: 'Docker', differs: false } });
  });

  it('identical entries are skipped; ticked, they are kept apart', () => {
    const c = base();
    const pack = exportOf(c, toggleEntry(c, none(c), 'trays[1]', true));
    const plan = planImport(c, pack, noChoices());
    expect(plan.entries[0]).toMatchObject({ status: 'identical', decision: 'skip', options: ['rename'] });
    expect(checkedDecision(plan.entries[0]!)).toBe('rename');
    const ticked = planImport(c, pack, choices({ entries: { 'trays[0]': 'rename' } }));
    expect(ticked.config.trays.map((t) => t.id)).toEqual(['docker', 'net', 'tools', 'net_2']);
  });

  it('entries inside one that is not imported are not imported', () => {
    const c = base();
    const plan = planImport(config(), exportOf(c), choices({ entries: { 'trays[0]': 'skip' } }));
    expect(plan.entries.slice(0, 3).map((r) => [r.status, r.decision, r.options])).toEqual([
      ['new', 'skip', ['add']],
      ['inside', 'skip', []],
      ['inside', 'skip', []],
    ]);
    expect(checkedDecision(plan.entries[1]!)).toBe('add');
    expect(plan.config.trays.map((t) => t.id)).toEqual(['net', 'tools']);
    // "net" runs before "docker", which is not imported: the result is not valid
    expect(plan.issues.map((i) => i.message)).toEqual(['Unknown id "docker"', 'Unknown id "down"']);
  });

  it('merging into an entry without a menu', () => {
    const c = config({ trays: [{ id: 'a', label: 'A', action: 'x' }] });
    const plan = planImport(c, exportOf(config({ trays: [{ id: 'a', label: 'A', menu: [{ separator: true }, { id: 'b', label: 'B' }] }] })), noChoices());
    expect(plan.config.trays[0]!.menu).toEqual([{ id: 'b', label: 'B' }]);
    const nothing = planImport(c, exportOf(config({ trays: [{ id: 'a', label: 'A', menu: [{ id: 'b', label: 'B' }] }] })), choices({ entries: { 'trays[0].menu[0]': 'skip' } }));
    expect(nothing.config.trays[0]!.menu).toBeUndefined();
  });

  it('separators: kept between what is added and the entries already there', () => {
    const c = config({ trays: [{ id: 'a', label: 'A', menu: [{ id: 'x', label: 'X' }, { separator: true }] }] });
    const pack = exportOf(config({ trays: [{ id: 'a', label: 'A', menu: [{ separator: true }, { id: 'b', label: 'B' }, { separator: true }] }] }));
    // the export already drops the leading separator: put it back by hand
    pack.trays[0]!.menu = [{ separator: true }, { id: 'b', label: 'B' }, { separator: true }];
    expect(planImport(c, pack, noChoices()).config.trays[0]!.menu).toEqual([{ id: 'x', label: 'X' }, { separator: true }, { id: 'b', label: 'B' }]);
    const empty = config({ trays: [{ id: 'a', label: 'A', menu: [{ id: 'x', label: 'X' }] }] });
    expect(planImport(empty, pack, noChoices()).config.trays[0]!.menu).toEqual([{ id: 'x', label: 'X' }, { separator: true }, { id: 'b', label: 'B' }]);
  });

  it('an added entry whose whole menu is left out has no menu', () => {
    const plan = planImport(config(), exportOf(config({ trays: [{ id: 'a', label: 'A', menu: [{ id: 'b', label: 'B' }] }] })), choices({ entries: { 'trays[0].menu[0]': 'skip' } }));
    expect(plan.config.trays[0]).toEqual({ id: 'a', label: 'A' });
  });

  it('entries without id are always new', () => {
    const c = base();
    const plan = planImport(c, exportOf(config({ trays: [{ id: 't', label: 'T', menu: [{ label: 'No id', action: 'x' }] }] })), noChoices());
    expect(plan.entries[1]!.status).toBe('new');
  });

  it('entries that run as administrator are pointed out', () => {
    const plan = planImport(config(), exportOf(config({ trays: [{ id: 'a', label: 'A', action: { run: 'x', admin: true } }, { id: 'b', label: 'B', action: 'y' }] })), noChoices());
    expect(plan.entries.map((r) => r.admin)).toEqual([true, false]);
  });
});

describe('import: shortcuts', () => {
  const incoming = () => exportOf(config({ trays: [{ id: 'k', label: 'K', action: 'k', hotkey: 'ctrl+alt+d' }, { id: 'l', label: 'L', action: 'l', hotkey: 'Ctrl+Alt+Space' }, { id: 'm', label: 'M', action: 'm', hotkey: 'Ctrl+Alt+M' }] }));

  it('a shortcut used here stays here unless the imported entry is chosen', () => {
    const c = base();
    const plan = planImport(c, incoming(), noChoices());
    expect(plan.hotkeys).toEqual([
      { key: 'trays[0]', label: 'K', hotkey: 'ctrl+alt+d', holder: 'Docker', holderImported: false, launcher: false, winner: 'existing' },
      { key: 'trays[1]', label: 'L', hotkey: 'Ctrl+Alt+Space', holder: 'the launcher', launcher: true, winner: 'existing' },
    ]);
    expect(plan.config.trays.find((t) => t.id === 'k')!.hotkey).toBeUndefined();
    expect(plan.config.trays.find((t) => t.id === 'l')!.hotkey).toBeUndefined();
    expect(plan.config.trays.find((t) => t.id === 'm')!.hotkey).toBe('Ctrl+Alt+M');
    expect(plan.issues).toEqual([]);
    const taken = planImport(c, incoming(), choices({ hotkeys: { 'trays[0]': 'imported' } }));
    expect(taken.config.trays.find((t) => t.id === 'k')!.hotkey).toBe('ctrl+alt+d');
    expect(taken.config.trays[0]!.hotkey).toBeUndefined();
    expect(taken.issues).toEqual([]);
  });

  it('a replaced entry does not hold its old shortcut; an invalid shortcut is left to the validation', () => {
    const c = base();
    const plan = planImport(c, exportOf(config({ trays: [{ id: 'docker', label: 'Docker', action: 'x', hotkey: 'Ctrl+Alt+D' }] })), choices({ entries: { 'trays[0]': 'replace' } }));
    expect(plan.hotkeys).toEqual([]);
    expect(plan.config.trays[0]!.hotkey).toBe('Ctrl+Alt+D');
    const pack = exportOf(config({ trays: [{ id: 'z', label: 'Z', action: 'z' }] }));
    pack.trays[0]!.hotkey = 'Nope+';
    expect(planImport(c, pack, noChoices()).issues.length).toBe(1);
    // no launcher shortcut here
    const noLauncher = config({ settings: { launcherHotkey: '' }, trays: [] });
    expect(planImport(noLauncher, incoming(), noChoices()).hotkeys).toEqual([]);
  });

  it('two imported entries with the same shortcut', () => {
    const pack: Pack = { traycommandExport: 1, trays: [{ id: 'a', label: 'A', action: 'a', hotkey: 'Ctrl+Alt+J' }, { id: 'b', label: 'B', action: 'b', hotkey: 'Ctrl+Alt+J' }], schedules: [], variables: {}, settings: {} };
    expect(planImport(config(), pack, noChoices()).hotkeys).toMatchObject([{ key: 'trays[1]', holder: 'A', holderImported: true }]);
  });
});

describe('import: schedules, variables, settings, icons', () => {
  it('schedules alone go to the entry with their id', () => {
    const c = base();
    const pack: Pack = {
      traycommandExport: 1,
      trays: [{ id: 'down', label: 'Down 2', action: 'd' }],
      schedules: [
        { entry: 'net', label: 'Network', schedule: { every: '2h', alert: { choices: [{ label: 'D', run: 'down:off' }] } } },
        { entry: 'up', schedule: { cron: '0 9 * * *' } },
        { entry: 'gone', label: 'Somewhere › Gone', schedule: { startup: true } },
        { entry: 'gone2', schedule: { startup: true } },
      ],
      variables: {},
      settings: {},
    };
    const plan = planImport(c, pack, noChoices());
    expect(plan.entries[0]!.newId).toBe('down_2');
    expect(plan.schedules).toEqual([
      { index: 0, entry: 'net', label: 'Network', text: 'Every 2 hours', status: 'new', checked: true },
      { index: 1, entry: 'up', label: 'Docker › Up', text: 'At 09:00', status: 'identical', checked: false },
      { index: 2, entry: 'gone', label: 'Somewhere › Gone', text: 'When TrayCommand starts', status: 'missing', checked: false },
      { index: 3, entry: 'gone2', label: 'gone2', text: 'When TrayCommand starts', status: 'missing', checked: false },
    ]);
    expect(plan.config.trays[1]!.schedules![0]!.alert!.choices![0]!.run).toBe('down_2:off');
    expect(plan.counts.schedules).toBe(1);
    const unticked = planImport(c, pack, choices({ schedules: { 0: false, 1: true } }));
    expect(unticked.config.trays[1]!.schedules).toBeUndefined();
    expect((unticked.config.trays[0]!.menu![0] as { schedules: unknown[] }).schedules).toHaveLength(2);
  });

  it('a schedule alone for an entry that this import replaces', () => {
    const c = base();
    const pack: Pack = { traycommandExport: 1, trays: [{ id: 'net', label: 'Network', action: 'new' }], schedules: [{ entry: 'net', schedule: { every: '1h' } }], variables: {}, settings: {} };
    const plan = planImport(c, pack, noChoices());
    expect(plan.config.trays[1]!.schedules).toEqual([{ every: '1h' }]);
  });

  it('variables: new ones are added, different ones are kept unless chosen', () => {
    const c = base();
    const pack: Pack = { traycommandExport: 1, trays: [], schedules: [], variables: { DIR: 'D:\\y', UNUSED: 'z', NEW: 'n' }, settings: {} };
    const plan = planImport(c, pack, noChoices());
    expect(plan.variables).toEqual([
      { name: 'DIR', value: 'D:\\y', current: 'C:\\x', status: 'different', checked: false },
      { name: 'UNUSED', value: 'z', current: 'z', status: 'same', checked: false },
      { name: 'NEW', value: 'n', current: undefined, status: 'new', checked: true },
    ]);
    expect(plan.config.variables.DIR).toBe('C:\\x');
    expect(plan.config.variables.NEW).toBe('n');
    const chosen = planImport(c, pack, choices({ variables: { DIR: true, NEW: false } }));
    expect(chosen.config.variables.DIR).toBe('D:\\y');
    expect(chosen.config.variables.NEW).toBeUndefined();
  });

  it('settings: changed ones are applied, admin commands and the shell only when chosen; the app menu follows a renamed tray', () => {
    const c = base();
    const pack: Pack = {
      traycommandExport: 1,
      trays: [{ id: 'net', label: 'Other net' }],
      schedules: [],
      variables: {},
      settings: { theme: 'light', allowAdminCommands: true, appMenu: 'net', checkUpdates: true, shell: 'cmd' },
    };
    const plan = planImport(c, pack, noChoices());
    expect(plan.settings).toEqual([
      { name: 'theme', value: 'light', current: 'dark', status: 'different', checked: true, caution: undefined },
      { name: 'allowAdminCommands', value: true, current: false, status: 'different', checked: false, caution: 'Lets actions run as administrator: check the imported commands first' },
      { name: 'appMenu', value: 'net_2', current: 'own', status: 'different', checked: true, caution: undefined },
      { name: 'checkUpdates', value: true, current: true, status: 'same', checked: false, caution: undefined },
      { name: 'shell', value: 'cmd', current: undefined, status: 'different', checked: false, caution: 'Changes the shell every action here runs with: check it first' },
    ]);
    expect(plan.config.settings).toMatchObject({ theme: 'light', allowAdminCommands: false, appMenu: 'net_2' });
    expect(plan.config.settings.shell).toBeUndefined();
    expect(plan.issues).toEqual([]);
    const own = planImport(config({ settings: { appMenu: 'x' }, trays: [{ id: 'x', label: 'X' }] }), { ...pack, trays: [], settings: { appMenu: 'own' } }, noChoices());
    expect(own.config.settings.appMenu).toBe('own');
    const chosen = planImport(c, pack, choices({ settings: { allowAdminCommands: true, theme: false } }));
    expect(chosen.config.settings).toMatchObject({ theme: 'dark', allowAdminCommands: true });
  });

  it('icons point to where they were copied', () => {
    const c = base();
    const pack = exportOf(c);
    const plan = planImport(config(), pack, noChoices(), { 'icons/docker.png': 'icons/docker-2.png' });
    expect(plan.config.trays[0]!.icon).toBe('icons/docker-2.png');
    expect(plan.config.trays[0]!.state!.iconOff).toBe('icons/docker-off.png');
    // icons of entries not imported are not needed
    expect(planImport(config(), pack, choices({ entries: { 'trays[0]': 'skip' } })).icons).toEqual([]);
  });
});
