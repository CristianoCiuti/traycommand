import fs from 'node:fs';
import path from 'node:path';
import { expand } from '../shared/variables';
import { PACK_FILE, flatten, iconFileName, packIcons, readPack, type ExportIcon, type Pack } from '../shared/transfer';
import { isZip, readZip, writeZip, type ZipFile } from './zip';

/*
 * Export and import files: a zip (traycommand-export.json + icons/) or a single JSON file,
 * which may also be a whole configuration file (its icons are taken from its folder).
 */

export const ICON_EXTENSIONS = ['.png', '.ico', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
const MAX_ICON = 5 * 1024 * 1024;

const isImage = (name: string) => ICON_EXTENSIONS.includes(path.extname(name).toLowerCase());

/** The pack without the icons that could not be put in the export. */
export function withoutIcons(pack: Pack, names: string[]): Pack {
  const gone = new Set(names.map((n) => `icons/${n}`));
  const copy = structuredClone(pack);
  for (const f of flatten(copy.trays)) {
    if (f.node.icon && gone.has(f.node.icon)) delete f.node.icon;
    if (f.node.state?.iconOff && gone.has(f.node.state.iconOff)) delete f.node.state.iconOff;
  }
  return copy;
}

/**
 * Writes an export. `resolve` gives the file of an icon as written in the configuration.
 * Returns the icons that could not be read (left out, with their references).
 */
export function writeExport(file: string, kind: 'zip' | 'json', pack: Pack, icons: ExportIcon[], resolve: (raw: string) => string): { missing: string[] } {
  const files: ZipFile[] = [];
  const missing: ExportIcon[] = [];
  for (const icon of icons) {
    try {
      const source = resolve(icon.raw);
      if (!isImage(source) || fs.statSync(source).size > MAX_ICON) throw new Error('not an image');
      files.push({ name: `icons/${icon.name}`, data: fs.readFileSync(source) });
    } catch {
      missing.push(icon);
    }
  }
  const final = missing.length ? withoutIcons(pack, missing.map((m) => m.name)) : pack;
  const json = Buffer.from(`${JSON.stringify(final, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, kind === 'zip' ? writeZip([{ name: PACK_FILE, data: json }, ...files]) : json);
  fs.renameSync(tmp, file);
  return { missing: missing.map((m) => m.raw) };
}

export type ReadImport =
  | { ok: true; pack: Pack; kind: 'export' | 'config'; icons: Map<string, Buffer>; missing: string[] }
  | { ok: false; error: string };

function parseJson(data: Buffer): unknown {
  return JSON.parse(data.toString('utf8').replace(/^﻿/, ''));
}

const norm = (p: string) => path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').toLowerCase();

/** Reads an export (zip or JSON) or a configuration file, with its icons. */
export function readImport(file: string, env: Record<string, string | undefined> = process.env): ReadImport {
  let data: Buffer;
  try {
    data = fs.readFileSync(file);
  } catch (error) {
    return { ok: false, error: `Cannot read the file: ${(error as Error).message}` };
  }
  const icons = new Map<string, Buffer>();
  const missing: string[] = [];
  if (isZip(data)) {
    let entries: ZipFile[];
    try {
      entries = readZip(data);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    // the export file first (also inside a folder, when the zip was made again), then any configuration file
    const jsons = entries
      .filter((e) => e.name.toLowerCase().endsWith('.json'))
      .sort((a, b) => Number(path.posix.basename(b.name) === PACK_FILE) - Number(path.posix.basename(a.name) === PACK_FILE) || a.name.split('/').length - b.name.split('/').length);
    let found: { entry: ZipFile; pack: Pack; kind: 'export' | 'config' } | undefined;
    let firstError: string | undefined;
    for (const entry of jsons) {
      let raw: unknown;
      try {
        raw = parseJson(entry.data);
      } catch {
        continue;
      }
      const r = readPack(raw);
      if (r.ok) {
        found = { entry, pack: r.pack, kind: r.kind };
        break;
      }
      firstError ??= r.error;
    }
    if (!found) return { ok: false, error: firstError ?? 'The zip file has no TrayCommand export inside' };
    const base = path.posix.dirname(found.entry.name);
    const byPath = new Map(entries.map((e) => [norm(e.name), e]));
    for (const raw of packIcons(found.pack)) {
      const rel = raw.replace(/^\$\{configDir\}[\\/]?/, '');
      const hit = byPath.get(norm(path.posix.join(base === '.' ? '' : base, rel.replace(/\\/g, '/'))));
      if (hit && isImage(hit.name) && hit.data.length <= MAX_ICON) icons.set(raw, hit.data);
      else missing.push(raw);
    }
    return { ok: true, pack: found.pack, kind: found.kind, icons, missing };
  }
  let raw: unknown;
  try {
    raw = parseJson(data);
  } catch (error) {
    return { ok: false, error: `This file is not a TrayCommand export or configuration (${(error as Error).message})` };
  }
  const r = readPack(raw);
  if (!r.ok) return r;
  // a JSON file alone: icons are looked for next to it (a configuration file keeps them in its folder)
  const dir = path.dirname(file);
  for (const iconRaw of packIcons(r.pack)) {
    const expanded = expand(iconRaw, { variables: r.pack.variables, env, configDir: dir });
    const source = path.isAbsolute(expanded) ? expanded : path.resolve(dir, expanded);
    const rel = path.relative(dir, source);
    try {
      // never a network path (opening it could send the user's credentials); an export only uses files next to it
      if (/^([\\/]{2})/.test(expanded) || /^([\\/]{2})/.test(source)) throw new Error('network path');
      if (r.kind === 'export' && (rel.startsWith('..') || path.isAbsolute(rel))) throw new Error('outside the export');
      if (!isImage(source) || fs.statSync(source).size > MAX_ICON) throw new Error('not an image');
      icons.set(iconRaw, fs.readFileSync(source));
    } catch {
      missing.push(iconRaw);
    }
  }
  return { ok: true, pack: r.pack, kind: r.kind, icons, missing };
}

/**
 * Copies imported icons into the "icons" folder of the configuration.
 * The same file already there is reused; another file with the same name gets a new name.
 * Returns where each icon went, as written in the configuration ("icons/<name>").
 */
export function saveIcons(configDir: string, icons: Map<string, Buffer>, wanted: string[]): Record<string, string> {
  const dir = path.join(configDir, 'icons');
  const out: Record<string, string> = {};
  for (const raw of wanted) {
    const data = icons.get(raw);
    if (!data) continue;
    fs.mkdirSync(dir, { recursive: true });
    const name = iconFileName(raw);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let n = 2; ; n++) {
      const target = path.join(dir, candidate);
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, data);
        break;
      }
      if (fs.readFileSync(target).equals(data)) break;
      candidate = `${stem}-${n}${ext}`;
    }
    out[raw] = `icons/${candidate}`;
  }
  return out;
}
