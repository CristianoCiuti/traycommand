import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, isSeparator, type Config, type ConfigInput, type MenuEntry } from '../../src/shared/config';
import { buildExport, defaultExportSelection, exportDependencies, noChoices, planImport, readPack, toggleEntry, toggleSection, type ExportSelection, type ImportChoices, type Pack } from '../../src/shared/transfer';
import { readImport, writeExport } from '../../src/main/transfer';

const config = (input: Partial<ConfigInput> = {}): Config => ConfigSchema.parse({ version: 2, ...input });
const pack = (o: Partial<Pack> = {}): Pack => ({ traycommandExport: 1, trays: [], schedules: [], variables: {}, settings: {}, ...o });
const choices = (o: Partial<ImportChoices> = {}): ImportChoices => ({ ...noChoices(), ...o });
const none = (c: Config): ExportSelection => toggleSection(c, { ...defaultExportSelection(c), variables: new Set(), settings: new Set() }, 'entries', false);

describe('challenge: references with :on / :off / :right', () => {
  it('rewrites "id:on" refs when the referenced imported entry is renamed (Keep both)', () => {
    const current = config({ trays: [{ id: 'a', label: 'A', action: 'x', state: { check: 'c' } }] });
    const p = pack({
      trays: [
        { id: 'a', label: 'Other A', action: 'y', state: { check: 'c2', interval: 60 } },
        { id: 'b', label: 'B', action: { run: 'z', after: ['a:on'] } },
      ],
    });
    const plan = planImport(current, p, choices());
    expect(plan.entries[0]!.decision).toBe('rename');
    expect(plan.entries[0]!.newId).toBe('a_2');
    const b = plan.config.trays.find((t) => t.id === 'b')!;
    // b pointed at the imported "a", which is now "a_2"
    expect((b.action as { after: string[] }).after).toEqual(['a_2:on']);
  });

  it('export dependencies see entries referenced as "id:off"', () => {
    const c = config({
      trays: [
        { id: 'a', label: 'A', action: 'x', offAction: 'y', state: { check: 'c' } },
        { id: 'b', label: 'B', action: { run: 'z', before: ['a:off'] } },
      ],
    });
    const sel = toggleEntry(c, none(c), 'trays[1]', true);
    expect(exportDependencies(c, sel).entries.map((d) => d.id)).toEqual(['a']);
  });
});

describe('challenge: Keep both on a tray with a menu', () => {
  it('does not modify the existing tray and keeps the menu in the copy', () => {
    const current = config({ trays: [{ id: 't', label: 'T', menu: [{ id: 'a', label: 'A', action: 'old' }] }] });
    const p = pack({ trays: [{ id: 't', label: 'T', menu: [{ id: 'a', label: 'A', action: 'new' }] }] });
    const plan = planImport(current, p, choices({ entries: { 'trays[0]': 'rename' } }));
    expect(plan.issues).toEqual([]);
    const original = plan.config.trays.find((t) => t.id === 't')!;
    // "Keep both" must leave the existing tray as it was
    expect((original.menu![0] as MenuEntry).action).toBe('old');
    const copy = plan.config.trays.find((t) => t.id === 't_2')!;
    expect(copy.menu?.length).toBe(1);
  });

  it('keeping both of an identical tray copies its menu too', () => {
    const tray = { id: 't', label: 'T', menu: [{ id: 'a', label: 'A', action: 'x' }] };
    const current = config({ trays: [tray] });
    const plan = planImport(current, pack({ trays: [structuredClone(tray)] }), choices({ entries: { 'trays[0]': 'rename' } }));
    const copy = plan.config.trays.find((t) => t.id === 't_2')!;
    expect(copy.menu?.length).toBe(1);
  });
});

describe('challenge: merge duplicates', () => {
  it('re-importing an updated tray does not duplicate menu entries without id already there', () => {
    const current = config({ trays: [{ id: 't', label: 'T', action: 'old', menu: [{ label: 'No id', action: 'x' }] }] });
    const p = pack({ trays: [{ id: 't', label: 'T', action: 'new', menu: [{ label: 'No id', action: 'x' }] }] });
    const plan = planImport(current, p, choices());
    expect(plan.entries[0]!.decision).toBe('merge');
    expect(plan.config.trays[0]!.menu!.filter((n) => !isSeparator(n)).length).toBe(1);
  });
});

describe('challenge: readPack', () => {
  it('recognises a configuration file without a "trays" key (trays default to [])', () => {
    const r = readPack({ version: 2, variables: { A: '1' } });
    expect(r.ok).toBe(true);
  });
});

describe('challenge: icon names', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-challenge-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('an icon written as "icons/${APP}.png" survives export and import', () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    fs.mkdirSync(path.join(dir, 'icons'));
    fs.writeFileSync(path.join(dir, 'icons', 'docker.png'), PNG);
    const c = config({ variables: { APP: 'docker' }, trays: [{ id: 't', label: 'T', icon: 'icons/${APP}.png', action: 'x' }] });
    const built = buildExport(c, defaultExportSelection(c));
    const file = path.join(dir, 'out.zip');
    const { missing } = writeExport(file, 'zip', built.pack, built.icons, (raw) => path.join(dir, raw.replace('${APP}', 'docker')));
    expect(missing).toEqual([]);
    const r = readImport(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.missing).toEqual([]);
  });
});
