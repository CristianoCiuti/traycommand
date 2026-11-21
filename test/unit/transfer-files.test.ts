import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crc32, isZip, readZip, writeZip, MAX_ZIP_ENTRY } from '../../src/main/zip';
import { readImport, saveIcons, withoutIcons, writeExport } from '../../src/main/transfer';
import { PACK_FILE, type Pack } from '../../src/shared/transfer';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-transfer-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pack = (o: Partial<Pack> = {}): Pack => ({ traycommandExport: 1, trays: [], schedules: [], variables: {}, settings: {}, ...o });

describe('zip', () => {
  it('writes and reads back files, stored or deflated, with utf-8 names', () => {
    const big = Buffer.from('a'.repeat(5000));
    const files = [
      { name: 'traycommand-export.json', data: big },
      { name: 'icons/città.png', data: PNG },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ];
    const zip = writeZip(files, new Date(2026, 10, 21, 10, 30, 12));
    expect(isZip(zip)).toBe(true);
    expect(zip.length).toBeLessThan(5000);
    expect(readZip(zip)).toEqual(files);
    // dates before 1980 are clamped
    expect(readZip(writeZip(files, new Date(1970, 0, 1)))).toEqual(files);
  });

  it('crc32 of a known value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('skips folders, reads names with backslashes and latin1 names', () => {
    const zip = writeZip([
      { name: 'folder/', data: Buffer.alloc(0) },
      { name: 'a\\b.json', data: Buffer.from('{}') },
    ]);
    // clear the utf-8 flag of the second entry in the central directory
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 1);
    zip.writeUInt16LE(0, central + 8);
    expect(readZip(zip)).toEqual([{ name: 'a/b.json', data: Buffer.from('{}') }]);
  });

  it('refuses damaged, encrypted, too large and unknown zips', () => {
    const zip = writeZip([{ name: 'a.txt', data: Buffer.from('hello hello hello hello hello') }]);
    expect(isZip(Buffer.from('PK'))).toBe(false);
    expect(() => readZip(Buffer.from('not a zip at all, really not a zip'))).toThrow('The zip file is damaged');
    const centralAt = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const mutate = (fn: (z: Buffer) => void) => {
      const z = Buffer.from(zip);
      fn(z);
      return () => readZip(z);
    };
    expect(mutate((z) => z.writeUInt32LE(0, centralAt))).toThrow('damaged');
    expect(mutate((z) => z.writeUInt16LE(1, centralAt + 8))).toThrow('Encrypted zip files are not supported');
    expect(mutate((z) => z.writeUInt32LE(MAX_ZIP_ENTRY + 1, centralAt + 24))).toThrow('too large');
    expect(mutate((z) => z.writeUInt32LE(0, 0))).toThrow('damaged');
    expect(mutate((z) => z.writeUInt32LE(99999, centralAt + 20))).toThrow('damaged');
    expect(mutate((z) => z.writeUInt16LE(12, centralAt + 10))).toThrow('Unsupported compression in the zip file (method 12)');
    expect(mutate((z) => z.writeUInt32LE(123, centralAt + 16))).toThrow('damaged');
    // deflated data that is not deflate
    const deflated = writeZip([{ name: 'a.txt', data: Buffer.from('x'.repeat(100)) }]);
    const body = 30 + 'a.txt'.length;
    const broken = Buffer.from(deflated);
    broken.fill(0xff, body, body + 4);
    expect(() => readZip(broken)).toThrow('damaged');
  });

  it('refuses a zip whose files add up to too much', () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(16 * 1024 * 1024) }));
    expect(() => readZip(writeZip(files))).toThrow('too large');
  });
});

describe('export files', () => {
  it('a zip with the export and its icons; icons that cannot be read are left out', () => {
    fs.writeFileSync(path.join(dir, 'a.png'), PNG);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const p = pack({
      trays: [
        { id: 'a', label: 'A', icon: 'icons/a.png', state: { check: 'c', interval: 30, iconOff: 'icons/gone.png' }, menu: [{ id: 'b', label: 'B', icon: 'icons/notes.txt' }] },
      ],
    });
    const file = path.join(dir, 'out', 'export.zip');
    const r = writeExport(file, 'zip', p, [
      { raw: 'a.png', name: 'a.png' },
      { raw: 'gone.png', name: 'gone.png' },
      { raw: 'notes.txt', name: 'notes.txt' },
    ], (raw) => path.join(dir, raw));
    expect(r.missing).toEqual(['gone.png', 'notes.txt']);
    const entries = readZip(fs.readFileSync(file));
    expect(entries.map((e) => e.name)).toEqual([PACK_FILE, 'icons/a.png']);
    const written = JSON.parse(entries[0]!.data.toString()) as Pack;
    expect(written.trays[0]!.icon).toBe('icons/a.png');
    expect(written.trays[0]!.state).toEqual({ check: 'c', interval: 30 });
    expect(written.trays[0]!.menu).toEqual([{ id: 'b', label: 'B' }]);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('a JSON file', () => {
    const file = path.join(dir, 'one.json');
    writeExport(file, 'json', pack({ variables: { A: '1' } }), [], (raw) => raw);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(pack({ variables: { A: '1' } }));
  });

  it('a large icon is left out', () => {
    fs.writeFileSync(path.join(dir, 'big.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const r = writeExport(path.join(dir, 'x.zip'), 'zip', pack(), [{ raw: 'big.png', name: 'big.png' }], (raw) => path.join(dir, raw));
    expect(r.missing).toEqual(['big.png']);
  });

  it('withoutIcons leaves other icons alone', () => {
    const p = pack({ trays: [{ id: 'a', label: 'A', icon: 'icons/keep.png', state: { check: 'c', interval: 30, iconOff: 'icons/keep.png' } }] });
    expect(withoutIcons(p, ['gone.png'])).toEqual(p);
  });
});

describe('import files', () => {
  const exportZip = (files: { name: string; data: Buffer }[]) => {
    const file = path.join(dir, 'in.zip');
    fs.writeFileSync(file, writeZip(files));
    return file;
  };
  const json = (v: unknown) => Buffer.from(JSON.stringify(v));

  it('a zip made by an export', () => {
    const p = pack({ trays: [{ id: 'a', label: 'A', icon: 'icons/a.png', state: { check: 'c', interval: 30, iconOff: 'icons/missing.png' } }] });
    const r = readImport(exportZip([{ name: PACK_FILE, data: json(p) }, { name: 'icons/a.png', data: PNG }]));
    expect(r.ok && r.kind).toBe('export');
    expect(r.ok && [...r.icons]).toEqual([['icons/a.png', PNG]]);
    expect(r.ok && r.missing).toEqual(['icons/missing.png']);
  });

  it('a zip made again with Explorer: the export is inside a folder', () => {
    const p = pack({ trays: [{ id: 'a', label: 'A', icon: 'icons\\A.PNG' }] });
    const r = readImport(
      exportZip([
        { name: 'other.json', data: Buffer.from('{ not json') },
        { name: 'Export/', data: Buffer.alloc(0) },
        { name: `Export/${PACK_FILE}`, data: Buffer.concat([Buffer.from('﻿'), json(p)]) },
        { name: 'Export/icons/a.png', data: PNG },
      ]),
    );
    expect(r.ok && r.icons.get('icons\\A.PNG')).toEqual(PNG);
  });

  it('a zip with a configuration file and its icons', () => {
    const r = readImport(
      exportZip([
        { name: 'cfg/traycommand.json', data: json({ version: 2, trays: [{ id: 'a', label: 'A', icon: '${configDir}/art/a.png' }, { id: 'b', label: 'B', icon: 'art/not-an-image.txt' }] }) },
        { name: 'cfg/art/a.png', data: PNG },
        { name: 'cfg/art/not-an-image.txt', data: PNG },
      ]),
    );
    expect(r.ok && r.kind).toBe('config');
    expect(r.ok && [...r.icons.keys()]).toEqual(['${configDir}/art/a.png']);
    expect(r.ok && r.missing).toEqual(['art/not-an-image.txt']);
  });

  it('zips that cannot be imported', () => {
    expect(readImport(exportZip([{ name: 'a/b/one.json', data: Buffer.from('{ no') }, { name: 'two.json', data: Buffer.from('nope') }]))).toEqual({ ok: false, error: 'The zip file has no TrayCommand export inside' });
    expect(readImport(exportZip([{ name: 'readme.txt', data: Buffer.from('hi') }]))).toEqual({ ok: false, error: 'The zip file has no TrayCommand export inside' });
    expect(readImport(exportZip([{ name: 'x.json', data: json({ traycommandExport: 9 }) }]))).toEqual({ ok: false, error: 'This export was made by a newer TrayCommand: update TrayCommand to import it' });
    const damaged = path.join(dir, 'bad.zip');
    fs.writeFileSync(damaged, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]));
    expect(readImport(damaged)).toEqual({ ok: false, error: 'The zip file is damaged' });
  });

  it('a JSON configuration file: icons next to it or anywhere on this PC', () => {
    fs.mkdirSync(path.join(dir, 'art'));
    fs.writeFileSync(path.join(dir, 'art', 'a.png'), PNG);
    fs.writeFileSync(path.join(dir, 'abs.png'), PNG);
    fs.writeFileSync(path.join(dir, 'art', 'text.txt'), 'x');
    const file = path.join(dir, 'traycommand.json');
    const abs = path.join(dir, 'abs.png');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 2, variables: { ART: 'art' }, trays: [{ id: 'a', label: 'A', icon: '${ART}/a.png', menu: [{ id: 'b', label: 'B', icon: abs }, { id: 'c', label: 'C', icon: '${env:NOPE}missing.png' }, { id: 'd', label: 'D', icon: 'art/text.txt' }] }] }),
    );
    const r = readImport(file, {});
    expect(r.ok && [...r.icons.keys()]).toEqual(['${ART}/a.png', abs]);
    expect(r.ok && r.missing).toEqual(['${env:NOPE}missing.png', 'art/text.txt']);
  });

  it('a JSON export: icons only next to it, never on the network', () => {
    fs.mkdirSync(path.join(dir, 'in', 'icons'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'in', 'icons', 'a.png'), PNG);
    fs.writeFileSync(path.join(dir, 'outside.png'), PNG);
    const file = path.join(dir, 'in', 'export.json');
    const outside = path.join(dir, 'outside.png');
    fs.writeFileSync(
      file,
      JSON.stringify(pack({ trays: [{ id: 'a', label: 'A', icon: 'icons/a.png', menu: [{ id: 'b', label: 'B', icon: outside }, { id: 'c', label: 'C', icon: '../outside.png' }, { id: 'd', label: 'D', icon: '\\\\server\\share\\x.png' }, { id: 'e', label: 'E', icon: '//server/share/y.png' }] }] })),
    );
    const r = readImport(file, {});
    expect(r.ok && [...r.icons.keys()]).toEqual(['icons/a.png']);
    expect(r.ok && r.missing).toEqual([outside, '../outside.png', '\\\\server\\share\\x.png', '//server/share/y.png']);
    // a configuration file may use icons elsewhere on this PC, but not on the network
    const cfg = path.join(dir, 'in', 'traycommand.json');
    fs.writeFileSync(cfg, JSON.stringify({ version: 2, variables: { SRV: '\\\\server\\share' }, trays: [{ id: 'a', label: 'A', icon: outside }, { id: 'b', label: 'B', icon: '${SRV}\\z.png' }] }));
    const c = readImport(cfg, {});
    expect(c.ok && [...c.icons.keys()]).toEqual([outside]);
    expect(c.ok && c.missing).toEqual(['${SRV}\\z.png']);
  });

  it('files that cannot be imported', () => {
    expect(readImport(path.join(dir, 'nope.json'))).toMatchObject({ ok: false, error: expect.stringMatching(/^Cannot read the file: /) });
    const text = path.join(dir, 'x.json');
    fs.writeFileSync(text, 'hello');
    expect(readImport(text)).toMatchObject({ ok: false, error: expect.stringMatching(/^This file is not a TrayCommand export or configuration \(/) });
    fs.writeFileSync(text, '{"a":1}');
    expect(readImport(text)).toEqual({ ok: false, error: 'This file is not a TrayCommand export or configuration' });
    // uses the real environment by default
    fs.writeFileSync(text, JSON.stringify(pack()));
    expect(readImport(text).ok).toBe(true);
  });
});

describe('saving imported icons', () => {
  it('copies icons into the icons folder, reusing the same file and renaming a different one', () => {
    const icons = path.join(dir, 'icons');
    fs.mkdirSync(icons);
    fs.writeFileSync(path.join(icons, 'same.png'), PNG);
    fs.writeFileSync(path.join(icons, 'other.png'), 'different');
    fs.writeFileSync(path.join(icons, 'other-2.png'), 'different too');
    const data = new Map([
      ['icons/same.png', PNG],
      ['icons/other.png', PNG],
      ['icons/new.png', PNG],
      ['noext', PNG],
    ]);
    const out = saveIcons(dir, data, ['icons/same.png', 'icons/other.png', 'icons/new.png', 'icons/absent.png', 'noext']);
    expect(out).toEqual({ 'icons/same.png': 'icons/same.png', 'icons/other.png': 'icons/other-3.png', 'icons/new.png': 'icons/new.png', noext: 'icons/noext' });
    expect(fs.readFileSync(path.join(icons, 'other-3.png'))).toEqual(PNG);
    expect(fs.readFileSync(path.join(icons, 'other.png'), 'utf8')).toBe('different');
    // a name without extension, taken
    fs.writeFileSync(path.join(icons, 'noext'), 'x');
    expect(saveIcons(dir, data, ['noext'])).toEqual({ noext: 'icons/noext-2' });
  });
});
