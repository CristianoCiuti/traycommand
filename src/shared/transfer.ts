import { z } from 'zod';
import {
  CONFIG_VERSION,
  ConfigSchema,
  ScheduleSchema,
  SettingsSchema,
  TraySchema,
  isSeparator,
  normalizeAction,
  parseConfig,
  type ActionInput,
  type Config,
  type ConfigIssue,
  type MenuEntry,
  type MenuNode,
  type Schedule,
  type Settings,
  type Tray,
} from './config.ts';
import { describeCron, describeInterval, parseInterval } from './cron.ts';
import { canonicalHotkey } from './hotkey.ts';
import { describeWindow } from './window.ts';

/*
 * Export and import of parts of a configuration.
 *
 * An export ("pack") holds trays and menu entries (with the parents needed to place them),
 * schedules of entries that are not exported (added to the entry with the same id on import),
 * variables and settings. Icons travel next to it in a zip, referenced as "icons/<name>".
 */

export const PACK_FILE = 'traycommand-export.json';
export const PACK_FORMAT = 1;

export interface AttachedSchedule {
  /** Id of the entry the schedule belongs to. */
  entry: string;
  /** Label of that entry when exported (shown when it is missing). */
  label?: string;
  schedule: Schedule;
}

export interface Pack {
  traycommandExport: number;
  app?: string;
  created?: string;
  trays: Tray[];
  schedules: AttachedSchedule[];
  variables: Record<string, string>;
  settings: Partial<Settings>;
}

type Node = Tray | MenuEntry;
type Refs = MenuEntry & { rightAction?: ActionInput };

export const SETTING_KEYS = Object.keys(SettingsSchema.shape) as (keyof Settings)[];
const SETTING_DEFAULTS = SettingsSchema.parse({});

/** JSON with sorted keys, so that key order does not count as a difference. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

const childKey = (parent: string | undefined, i: number) => (parent === undefined ? `trays[${i}]` : `${parent}.menu[${i}]`);
export const scheduleKey = (entryKey: string, i: number) => `${entryKey}#${i}`;

export interface FlatEntry {
  key: string;
  node: Node;
  depth: number;
  /** Labels of the ancestors and of the entry: "Tray › Sub › Entry". */
  path: string[];
}

/** Every entry of a tree, parents first (separators skipped). */
export function flatten(trays: Node[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  const visit = (nodes: (MenuNode | Tray)[], parent: string | undefined, depth: number, path: string[]) => {
    nodes.forEach((n, i) => {
      if (isSeparator(n as MenuNode)) return;
      const node = n as Node;
      const key = childKey(parent, i);
      const p = [...path, node.label];
      out.push({ key, node, depth, path: p });
      if (node.menu) visit(node.menu, key, depth + 1, p);
    });
  };
  visit(trays, undefined, 0, []);
  return out;
}

const isUnder = (key: string, ancestor: string) => key === ancestor || key.startsWith(`${ancestor}.`);
function ancestorsOf(key: string): string[] {
  const out: string[] = [];
  let k = key;
  for (let m = /^(.*)\.menu\[\d+\]$/.exec(k); m; m = /^(.*)\.menu\[\d+\]$/.exec(k)) {
    k = m[1]!;
    out.push(k);
  }
  return out;
}

/** "Every day at 09:00", "When a file *.txt appears in C:\in", with the time window. */
export function describeSchedule(s: Schedule): string {
  let text: string;
  if (s.cron !== undefined) text = describeCron(s.cron);
  else if (s.every !== undefined) text = describeInterval(parseInterval(s.every) ?? 0);
  else if (s.watch) text = `When files change in ${s.watch.path}${s.watch.files ? ` (${[s.watch.files].flat().join(', ')})` : ''}`;
  else text = 'When TrayCommand starts';
  const window = describeWindow(s.between, s.days);
  return [text, window, s.disabled ? '(off)' : ''].filter(Boolean).join(' ');
}

/* ================================ export ================================ */

export interface ExportSelection {
  /** Keys of the entries ("trays[0].menu[2]"). An entry needs its parents: they are exported with it. */
  entries: Set<string>;
  /** "<entry key>#<index>" */
  schedules: Set<string>;
  variables: Set<string>;
  settings: Set<string>;
  /** Put the icon files in the export. */
  icons: boolean;
}

/** Settings that differ from the defaults (the ones worth sharing). */
export function changedSettings(settings: Settings): string[] {
  return SETTING_KEYS.filter((k) => settings[k] !== undefined && stableJson(settings[k]) !== stableJson(SETTING_DEFAULTS[k]));
}

export interface ScheduleRow {
  key: string;
  entryKey: string;
  index: number;
  entryId?: string;
  path: string[];
  schedule: Schedule;
}

export function scheduleRows(config: Config): ScheduleRow[] {
  return flatten(config.trays).flatMap((f) => (f.node.schedules ?? []).map((schedule, index) => ({ key: scheduleKey(f.key, index), entryKey: f.key, index, entryId: f.node.id, path: f.path, schedule })));
}

/** Everything but the settings left at their default value. */
export function defaultExportSelection(config: Config): ExportSelection {
  return {
    entries: new Set(flatten(config.trays).map((f) => f.key)),
    schedules: new Set(scheduleRows(config).map((s) => s.key)),
    variables: new Set(Object.keys(config.variables)),
    settings: new Set(changedSettings(config.settings)),
    icons: true,
  };
}

/** Checks or unchecks an entry with everything inside it (and its schedules); checking adds its parents too. */
export function toggleEntry(config: Config, sel: ExportSelection, key: string, on: boolean): ExportSelection {
  const entries = new Set(sel.entries);
  const schedules = new Set(sel.schedules);
  for (const f of flatten(config.trays)) {
    if (!isUnder(f.key, key)) continue;
    if (on) entries.add(f.key);
    else entries.delete(f.key);
    (f.node.schedules ?? []).forEach((_, i) => (on ? schedules.add(scheduleKey(f.key, i)) : schedules.delete(scheduleKey(f.key, i))));
  }
  if (on) ancestorsOf(key).forEach((k) => entries.add(k));
  return { ...sel, entries, schedules };
}

export type Check = 'all' | 'some' | 'none';

/** "all" = the entry and everything inside it, "some" = the entry without part of its menu. */
export function entryCheck(config: Config, sel: ExportSelection, key: string): Check {
  if (!sel.entries.has(key)) return 'none';
  return flatten(config.trays).every((f) => !isUnder(f.key, key) || sel.entries.has(f.key)) ? 'all' : 'some';
}

export function setCheck(selected: number, total: number): Check {
  return selected === 0 ? 'none' : selected === total ? 'all' : 'some';
}

export type Section = 'entries' | 'schedules' | 'variables' | 'settings';

export function sectionCheck(config: Config, sel: ExportSelection, section: Section): Check {
  const all = sectionKeys(config, section);
  return setCheck(all.filter((k) => sel[section].has(k)).length, all.length);
}

export function sectionKeys(config: Config, section: Section): string[] {
  if (section === 'entries') return flatten(config.trays).map((f) => f.key);
  if (section === 'schedules') return scheduleRows(config).map((s) => s.key);
  if (section === 'variables') return Object.keys(config.variables);
  return SETTING_KEYS as string[];
}

/** Checks or unchecks a whole section (the trays section brings the schedules of its entries along). */
export function toggleSection(config: Config, sel: ExportSelection, section: Section, on: boolean): ExportSelection {
  if (section === 'entries') return config.trays.reduce((s, _t, i) => toggleEntry(config, s, `trays[${i}]`, on), sel);
  return { ...sel, [section]: new Set(on ? sectionKeys(config, section) : []) };
}

export function toggleKey(sel: ExportSelection, section: Exclude<Section, 'entries'>, key: string, on: boolean): ExportSelection {
  const next = new Set(sel[section]);
  if (on) next.add(key);
  else next.delete(key);
  return { ...sel, [section]: next };
}

/** A schedule of an entry that is not exported can travel alone only if the entry has an id. */
export function scheduleExportable(sel: ExportSelection, row: ScheduleRow): boolean {
  return sel.entries.has(row.entryKey) || row.entryId !== undefined;
}

/** Removes separators at the start, at the end and next to each other. */
export function tidySeparators(nodes: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const n of nodes) {
    if (isSeparator(n) && (!out.length || isSeparator(out.at(-1)!))) continue;
    out.push(n);
  }
  while (out.length && isSeparator(out.at(-1)!)) out.pop();
  return out;
}

/** "C:\icons\My Icon.png" → "My_Icon.png" */
export function iconFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop()!.replace(/\$\{[^}]*\}/g, '');
  let clean = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '');
  // "${APP}.png" → "icon.png": the extension tells what the file is
  if (clean.startsWith('.')) clean = `icon${clean.replace(/^\.+/, '.')}`;
  if (!clean || clean === 'icon.') return 'icon.png';
  // names Windows does not allow (CON, NUL, COM1…)
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? `icon-${clean}` : clean;
}

function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export interface ExportIcon {
  /** The icon as written in the configuration. */
  raw: string;
  /** File name in the export ("icons/<name>"). */
  name: string;
}

export interface BuiltExport {
  pack: Pack;
  icons: ExportIcon[];
}

/** Copies the icon fields of an entry: through `map` (undefined = left out). */
function mapIcons(node: Node, map: (raw: string) => string | undefined) {
  const n = node as Node;
  if (n.icon !== undefined) {
    const v = map(n.icon);
    if (v === undefined) delete n.icon;
    else n.icon = v;
  }
  if (n.state?.iconOff !== undefined) {
    const v = map(n.state.iconOff);
    if (v === undefined) delete n.state.iconOff;
    else n.state.iconOff = v;
  }
}

export function buildExport(config: Config, sel: ExportSelection, meta: { app?: string; created?: string } = {}): BuiltExport {
  const icons = new Map<string, string>();
  const used = new Set<string>();
  const iconRef = (raw: string) => {
    if (!sel.icons) return undefined;
    if (!icons.has(raw)) icons.set(raw, uniqueName(iconFileName(raw), used));
    return `icons/${icons.get(raw)}`;
  };
  const copy = (node: Node, key: string): Node => {
    const { menu, schedules, ...own } = node;
    const out = structuredClone(own) as Node;
    mapIcons(out, iconRef);
    const kept = (schedules ?? []).filter((_, i) => sel.schedules.has(scheduleKey(key, i)));
    if (kept.length) out.schedules = structuredClone(kept);
    if (menu) {
      const children: MenuNode[] = [];
      menu.forEach((child, i) => {
        if (isSeparator(child)) children.push({ separator: true });
        else if (sel.entries.has(childKey(key, i))) children.push(copy(child, childKey(key, i)) as MenuEntry);
      });
      const tidy = tidySeparators(children);
      if (tidy.length) out.menu = tidy;
    }
    return out;
  };
  const trays = config.trays.flatMap((t, i) => (sel.entries.has(`trays[${i}]`) ? [copy(t, `trays[${i}]`) as Tray] : []));
  const schedules: AttachedSchedule[] = scheduleRows(config)
    .filter((r) => sel.schedules.has(r.key) && !sel.entries.has(r.entryKey) && r.entryId !== undefined)
    .map((r) => ({ entry: r.entryId!, label: r.path.join(' › '), schedule: structuredClone(r.schedule) }));
  const variables = Object.fromEntries(Object.entries(config.variables).filter(([k]) => sel.variables.has(k)));
  const settings = Object.fromEntries(SETTING_KEYS.filter((k) => sel.settings.has(k) && config.settings[k] !== undefined).map((k) => [k, structuredClone(config.settings[k])])) as Partial<Settings>;
  const pack: Pack = { traycommandExport: PACK_FORMAT, ...meta, trays, schedules, variables, settings };
  return { pack, icons: [...icons].map(([raw, name]) => ({ raw, name })) };
}

/** Number of things in an export: trays, schedules alone, variables, settings. */
export function packCount(pack: Pack): number {
  return pack.trays.length + pack.schedules.length + Object.keys(pack.variables).length + Object.keys(pack.settings).length;
}

/** A single thing without icons is a .json file; anything more is a zip. */
export function exportKind(pack: Pack, icons: number): 'zip' | 'json' {
  return icons > 0 || packCount(pack) > 1 ? 'zip' : 'json';
}

/** Ids referenced by an entry (actions run before, with, after it; enabledWhen; alert buttons). */
export function referencedIds(node: Refs, schedules: Schedule[] = node.schedules ?? []): string[] {
  const ids: string[] = [];
  for (const k of ['action', 'offAction', 'rightAction'] as const) {
    const a = normalizeAction(node[k]);
    for (const when of ['before', 'parallel', 'after'] as const) ids.push(...(a?.[when] ?? []).map((ref) => ref.split(':')[0]!));
  }
  if (node.enabledWhen) ids.push(node.enabledWhen.replace(/^!/, ''));
  for (const s of schedules) for (const c of s.alert?.choices ?? []) if (c.run !== undefined && c.run !== 'self') ids.push(c.run.split(':')[0]!);
  return [...new Set(ids)];
}

/** ${NAME} written in a value (not ${env:NAME}, not ${configDir}). */
export function referencedVariables(value: unknown): string[] {
  const names = new Set<string>();
  for (const m of JSON.stringify(value).matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) if (m[1] !== 'configDir') names.add(m[1]!);
  return [...names];
}

export interface Dependencies {
  entries: { key: string; id: string; label: string; by: string }[];
  variables: { name: string; by: string }[];
}

/** What the selected entries and schedules need but is left out of the export. */
export function exportDependencies(config: Config, sel: ExportSelection): Dependencies {
  const flat = flatten(config.trays);
  const byId = new Map(flat.filter((f) => f.node.id).map((f) => [f.node.id!, f]));
  const entries = new Map<string, Dependencies['entries'][number]>();
  const variables = new Map<string, Dependencies['variables'][number]>();
  const need = (node: Refs, schedules: Schedule[], by: string, values: unknown) => {
    for (const id of referencedIds(node, schedules)) {
      const f = byId.get(id);
      if (f && !sel.entries.has(f.key) && !entries.has(f.key)) entries.set(f.key, { key: f.key, id, label: f.path.join(' › '), by });
    }
    for (const name of referencedVariables(values)) {
      if (config.variables[name] !== undefined && !sel.variables.has(name) && !variables.has(name)) variables.set(name, { name, by });
    }
  };
  for (const f of flat) {
    const schedules = (f.node.schedules ?? []).filter((_, i) => sel.schedules.has(scheduleKey(f.key, i)));
    const exported = sel.entries.has(f.key);
    if (!exported && !schedules.length) continue;
    const { menu: _menu, ...own } = f.node;
    // an entry exported only for its schedules: just the schedules count
    if (exported) need(f.node as Refs, schedules, f.path.join(' › '), { ...own, schedules });
    else need({ label: '' }, schedules, f.path.join(' › '), schedules);
  }
  for (const [name, value] of Object.entries(config.variables)) {
    if (!sel.variables.has(name)) continue;
    for (const inner of referencedVariables(value)) {
      if (config.variables[inner] !== undefined && !sel.variables.has(inner) && !variables.has(inner)) variables.set(inner, { name: inner, by: `\${${name}}` });
    }
  }
  return { entries: [...entries.values()], variables: [...variables.values()] };
}

/** Adds what the export needs (one level: the result may need more, shown again). */
export function includeDependencies(config: Config, sel: ExportSelection, deps: Dependencies): ExportSelection {
  let next = deps.entries.reduce((s, d) => toggleEntry(config, s, d.key, true), sel);
  next = { ...next, variables: new Set([...next.variables, ...deps.variables.map((v) => v.name)]) };
  return next;
}

export function isEmptySelection(config: Config, sel: ExportSelection): boolean {
  return packCount(buildExport(config, { ...sel, icons: false }).pack) === 0;
}

/* ================================ import ================================ */

const PackSchema = z.object({
  traycommandExport: z.number().int().positive(),
  app: z.string().optional(),
  created: z.string().optional(),
  trays: z.array(TraySchema).default([]),
  schedules: z.array(z.object({ entry: z.string().min(1), label: z.string().optional(), schedule: ScheduleSchema }).strict()).default([]),
  variables: z.record(z.string().regex(/^[A-Za-z0-9_]+$/), z.string()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type ReadResult = { ok: true; pack: Pack; kind: 'export' | 'config' } | { ok: false; error: string };

const pathText = (p: PropertyKey[]) => p.map((x) => (typeof x === 'number' ? `[${x}]` : `.${String(x)}`)).join('').replace(/^\./, '');

function zodError(error: z.ZodError, prefix = ''): string {
  const issue = error.issues[0]!;
  const at = pathText(issue.path);
  return `${prefix}${at ? `${at}: ` : ''}${issue.message}`;
}

/** Only the settings written in the file (not the defaults). */
function readSettings(raw: Record<string, unknown>): { ok: true; settings: Partial<Settings> } | { ok: false; error: string } {
  const parsed = SettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error, 'settings.') };
  return { ok: true, settings: Object.fromEntries(SETTING_KEYS.filter((k) => k in raw).map((k) => [k, parsed.data[k]])) as Partial<Settings> };
}

function duplicateId(trays: Tray[]): string | undefined {
  const seen = new Set<string>();
  for (const f of flatten(trays)) {
    if (!f.node.id) continue;
    if (seen.has(f.node.id)) return f.node.id;
    seen.add(f.node.id);
  }
  return undefined;
}

/** Recognises an export or a whole configuration file. */
export function readPack(raw: unknown): ReadResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'This file is not a TrayCommand export or configuration' };
  const obj = raw as Record<string, unknown>;
  let pack: Pack;
  let kind: 'export' | 'config';
  if ('traycommandExport' in obj) {
    if (typeof obj.traycommandExport === 'number' && obj.traycommandExport > PACK_FORMAT) return { ok: false, error: 'This export was made by a newer TrayCommand: update TrayCommand to import it' };
    const parsed = PackSchema.safeParse(obj);
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
    const settings = readSettings(parsed.data.settings);
    if (!settings.ok) return settings;
    pack = { ...parsed.data, settings: settings.settings };
    kind = 'export';
  } else if ('version' in obj) {
    if (obj.version !== CONFIG_VERSION) return { ok: false, error: `Configuration format ${String(obj.version)} is not supported (open it once with TrayCommand 2 to convert it)` };
    const parsed = ConfigSchema.safeParse(obj);
    if (!parsed.success) return { ok: false, error: zodError(parsed.error) };
    // only the settings written in the file (the others are defaults)
    const written = Object.keys((obj.settings as Record<string, unknown> | undefined) ?? {});
    const settings = Object.fromEntries(SETTING_KEYS.filter((k) => written.includes(k)).map((k) => [k, parsed.data.settings[k]])) as Partial<Settings>;
    pack = { traycommandExport: PACK_FORMAT, trays: parsed.data.trays, schedules: [], variables: parsed.data.variables, settings };
    kind = 'config';
  } else return { ok: false, error: 'This file is not a TrayCommand export or configuration' };
  const dup = duplicateId(pack.trays);
  if (dup) return { ok: false, error: `The id "${dup}" is used twice in the file` };
  return { ok: true, pack, kind };
}

/** Icons used in a pack (as written). */
export function packIcons(pack: Pack): string[] {
  const out = new Set<string>();
  for (const f of flatten(pack.trays)) {
    if (f.node.icon) out.add(f.node.icon);
    if (f.node.state?.iconOff) out.add(f.node.state.iconOff);
  }
  return [...out];
}

export type Decision = 'add' | 'replace' | 'merge' | 'rename' | 'skip';

export interface ImportChoices {
  /** Pack entry key → what to do (missing = the proposed one). */
  entries: Record<string, Decision>;
  /** Pack entry key → which entry keeps a shortcut used by both. */
  hotkeys: Record<string, 'existing' | 'imported'>;
  /** Index in pack.schedules → import it. */
  schedules: Record<number, boolean>;
  variables: Record<string, boolean>;
  settings: Record<string, boolean>;
}

export const noChoices = (): ImportChoices => ({ entries: {}, hotkeys: {}, schedules: {}, variables: {}, settings: {} });

export interface EntryRow {
  key: string;
  depth: number;
  label: string;
  icon?: string;
  id?: string;
  /** new = nothing here has its id; identical = already here, the same; conflict = something here has its id; inside = its parent is not imported. */
  status: 'new' | 'identical' | 'conflict' | 'inside';
  existing?: { label: string; where: string; differs: boolean };
  options: Exclude<Decision, 'skip'>[];
  decision: Decision;
  /** The id given with "Keep both". */
  newId?: string;
  hotkey?: string;
  schedules: number;
  /** One of its actions runs as administrator. */
  admin: boolean;
}

function runsAsAdmin(node: Node): boolean {
  return (['action', 'offAction', 'rightAction'] as const).some((k) => normalizeAction((node as Refs)[k])?.admin === true);
}

export interface HotkeyRow {
  key: string;
  label: string;
  hotkey: string;
  /** Who uses it here: an entry or the launcher. */
  holder: string;
  /** The holder is imported too (from the same file). */
  holderImported?: boolean;
  launcher: boolean;
  winner: 'existing' | 'imported';
}

export interface AttachedRow {
  index: number;
  entry: string;
  label: string;
  text: string;
  status: 'new' | 'identical' | 'missing';
  checked: boolean;
}

export interface ValueRow {
  name: string;
  value: unknown;
  current: unknown;
  status: 'new' | 'same' | 'different';
  checked: boolean;
  /** A setting turned off by default because it needs a look first. */
  caution?: string;
}

export interface ImportPlan {
  entries: EntryRow[];
  hotkeys: HotkeyRow[];
  schedules: AttachedRow[];
  variables: ValueRow[];
  settings: ValueRow[];
  config: Config;
  /** Icons (as written in the pack) used by what is imported. */
  icons: string[];
  issues: ConfigIssue[];
  warnings: ConfigIssue[];
  counts: { add: number; replace: number; merge: number; rename: number; schedules: number; variables: number; settings: number };
}

/** Same entry: compared without the icon folders (an exported icon lives in another folder). */
function sameNode(a: Node, b: Node): boolean {
  const norm = (n: Node) => {
    const c = structuredClone(n);
    for (const f of flatten([c as Tray])) mapIcons(f.node, (raw) => iconFileName(raw).toLowerCase());
    return stableJson(c);
  };
  return norm(a) === norm(b);
}

function ownOf(node: Node): Node {
  const { menu: _menu, ...own } = node;
  return structuredClone(own) as Node;
}

interface Found {
  node: Node;
  siblings: (MenuNode | Tray)[];
  index: number;
  kind: 'tray' | 'entry';
  path: string[];
}

const SETTING_CAUTION: Partial<Record<keyof Settings, string>> = {
  shell: 'Changes the shell every action here runs with: check it first',
  allowAdminCommands: 'Lets actions run as administrator: check the imported commands first',
};

function renameRefs(node: Refs, renames: Map<string, string>) {
  const swap = (ref: string) => {
    const [id, how] = ref.split(':') as [string, string | undefined];
    return `${renames.get(id) ?? id}${how ? `:${how}` : ''}`;
  };
  for (const k of ['action', 'offAction', 'rightAction'] as const) {
    const a = node[k];
    if (a === undefined || typeof a === 'string') continue;
    for (const when of ['before', 'parallel', 'after'] as const) if (a[when]) a[when] = a[when].map(swap);
  }
  if (node.enabledWhen) node.enabledWhen = node.enabledWhen.replace(/^(!?)(.*)$/, (_m, not: string, id: string) => `${not}${swap(id)}`);
  for (const s of node.schedules ?? []) renameScheduleRefs(s, renames);
}

function renameScheduleRefs(s: Schedule, renames: Map<string, string>) {
  for (const c of s.alert?.choices ?? []) {
    if (c.run === undefined || c.run === 'self') continue;
    const [id, how] = c.run.split(':') as [string, string | undefined];
    c.run = `${renames.get(id) ?? id}${how ? `:${how}` : ''}`;
  }
}

/**
 * What an import does with the current choices: the rows to show and the configuration that results.
 * `iconPaths` maps the icons of the pack to where they were copied (when importing for real).
 */
export function planImport(current: Config, pack: Pack, choices: ImportChoices, iconPaths: Record<string, string> = {}): ImportPlan {
  const config = structuredClone(current);
  const imported = new Set<Node>();
  const importedKey = new Map<Node, string>();
  const renames = new Map<string, string>();
  const rows: EntryRow[] = [];
  const taken = new Set([...flatten(config.trays), ...flatten(pack.trays)].map((f) => f.node.id).filter((x): x is string => !!x));

  const find = (id: string): Found | undefined => {
    let hit: Found | undefined;
    const visit = (nodes: (MenuNode | Tray)[], kind: 'tray' | 'entry', path: string[]) => {
      nodes.forEach((n, index) => {
        if (hit || isSeparator(n as MenuNode)) return;
        const node = n as Node;
        if (node.id === id && !imported.has(node)) hit = { node, siblings: nodes, index, kind, path: [...path, node.label] };
        else if (node.menu) visit(node.menu, 'entry', [...path, node.label]);
      });
    };
    visit(config.trays, 'tray', []);
    return hit;
  };

  const newId = (id: string) => {
    let n = 2;
    while (taken.has(`${id}_${n}`)) n++;
    taken.add(`${id}_${n}`);
    return `${id}_${n}`;
  };

  /** Appends nodes to a menu, without separators at the edges of what is added. */
  const tidyFrom = (dest: (MenuNode | Tray)[], start: number) => {
    const added = dest.splice(start) as MenuNode[];
    const tidy = tidySeparators(added);
    // a separator before the added entries is kept when the menu already had some
    if (start > 0 && added.length && isSeparator(added[0]!) && tidy.length && !isSeparator(dest[start - 1] as MenuNode)) tidy.unshift({ separator: true });
    dest.push(...tidy);
  };

  /**
   * `mode`: "copy" = inside a new copy ("Keep both"): taken ids get new ones, nothing here is touched;
   * "merge" = added to a menu already here: an entry without id that is already in it is not added again.
   */
  const visit = (node: Node, key: string, depth: number, kind: 'tray' | 'entry', dest: (MenuNode | Tray)[] | undefined, mode: 'normal' | 'copy' | 'merge' = 'normal') => {
    const row: EntryRow = { key, depth, label: node.label, icon: node.icon, id: node.id, status: 'new', options: ['add'], decision: 'add', hotkey: node.hotkey, schedules: node.schedules?.length ?? 0, admin: runsAsAdmin(node) };
    rows.push(row);
    const children = (into: (MenuNode | Tray)[] | undefined, childMode: 'normal' | 'copy' | 'merge' = 'normal') => {
      const start = into?.length ?? 0;
      node.menu?.forEach((child, i) => {
        if (isSeparator(child)) into?.push({ separator: true });
        else visit(child, childKey(key, i), depth + 1, 'entry', into, childMode);
      });
      if (into) tidyFrom(into, start);
    };
    if (!dest) {
      row.status = 'inside';
      row.options = [];
      row.decision = 'skip';
      children(undefined);
      return;
    }
    const found = node.id ? find(node.id) : undefined;
    let proposed: Decision = 'add';
    if (found && mode === 'copy') {
      // part of a copy: it gets a new id, the one here stays as it is
      row.options = ['rename'];
      proposed = 'rename';
    } else if (!node.id && mode === 'merge' && dest.some((n) => !isSeparator(n as MenuNode) && !imported.has(n as Node) && sameNode(node, n as Node))) {
      row.status = 'identical';
      proposed = 'skip';
    } else if (found) {
      const sameKind = found.kind === kind;
      const identical = sameKind && sameNode(node, found.node);
      row.existing = { label: found.node.label, where: found.path.slice(0, -1).join(' › '), differs: !sameNode(ownOf(node), ownOf(found.node)) };
      if (identical) {
        row.status = 'identical';
        row.options = ['rename'];
        proposed = 'skip';
      } else {
        row.status = 'conflict';
        row.options = sameKind ? [...(node.menu?.some((c) => !isSeparator(c)) ? (['merge'] as const) : []), 'replace', 'rename'] : ['rename'];
        proposed = row.options[0] === 'merge' ? 'merge' : sameKind && found.node.label === node.label ? 'replace' : 'rename';
      }
    }
    const wanted = choices.entries[key];
    row.decision = wanted === 'skip' || (wanted && (row.options as Decision[]).includes(wanted)) ? wanted : proposed;
    const register = (copy: Node) => {
      imported.add(copy);
      importedKey.set(copy, key);
    };
    switch (row.decision) {
      case 'skip':
        children(undefined);
        return;
      case 'merge': {
        const target = found!.node;
        const had = target.menu !== undefined;
        target.menu ??= [];
        children(target.menu, 'merge');
        if (!had && !target.menu.length) delete target.menu;
        return;
      }
      case 'replace': {
        const copy = ownOf(node);
        register(copy);
        found!.siblings[found!.index] = copy;
        if (node.menu) copy.menu = [];
        children(copy.menu);
        if (copy.menu && !copy.menu.length) delete copy.menu;
        return;
      }
      default: {
        const copy = ownOf(node);
        if (row.decision === 'rename') {
          row.newId = newId(node.id!);
          renames.set(node.id!, row.newId);
          copy.id = row.newId;
        }
        register(copy);
        dest.push(copy);
        if (node.menu) copy.menu = [];
        children(copy.menu, row.decision === 'rename' || mode === 'copy' ? 'copy' : 'normal');
        if (copy.menu && !copy.menu.length) delete copy.menu;
      }
    }
  };
  pack.trays.forEach((t, i) => visit(t, `trays[${i}]`, 0, 'tray', config.trays));

  // the entries brought in point to the copies that were renamed
  const importedNodes = [...imported];
  for (const n of importedNodes) renameRefs(n as Refs, renames);
  const usedIcons = new Set<string>();
  for (const n of importedNodes) {
    mapIcons(n, (raw) => {
      usedIcons.add(raw);
      return iconPaths[raw] ?? raw;
    });
  }

  // schedules of entries that were not exported: added to the entry with that id
  const scheduleRowsOut: AttachedRow[] = pack.schedules.map((a, index) => {
    const target = find(a.entry) ?? flatten(config.trays).map((f) => ({ node: f.node, path: f.path })).find((f) => f.node.id === a.entry);
    const text = describeSchedule(a.schedule);
    if (!target) return { index, entry: a.entry, label: a.label ?? a.entry, text, status: 'missing', checked: false };
    const identical = (target.node.schedules ?? []).some((s) => stableJson(s) === stableJson(a.schedule));
    const checked = choices.schedules[index] ?? !identical;
    if (checked) {
      const s = structuredClone(a.schedule);
      renameScheduleRefs(s, renames);
      (target.node.schedules ??= []).push(s);
    }
    return { index, entry: a.entry, label: target.path.join(' › '), text, status: identical ? 'identical' : 'new', checked };
  });

  const variables: ValueRow[] = Object.entries(pack.variables).map(([name, value]) => {
    const current = config.variables[name];
    const status = current === undefined ? 'new' : current === value ? 'same' : 'different';
    const checked = status === 'same' ? false : (choices.variables[name] ?? status === 'new');
    if (checked) config.variables[name] = value;
    return { name, value, current, status, checked };
  });

  const settings: ValueRow[] = (Object.keys(pack.settings) as (keyof Settings)[]).map((name) => {
    let value = pack.settings[name];
    if (name === 'appMenu') value = renames.get(value as string) ?? value;
    const current = config.settings[name];
    const status = stableJson(current) === stableJson(value) ? 'same' : 'different';
    const caution = SETTING_CAUTION[name];
    const checked = status === 'same' ? false : (choices.settings[name] ?? !caution);
    if (checked) (config.settings as Record<string, unknown>)[name] = value;
    return { name, value, current, status, checked, caution: status === 'different' ? caution : undefined };
  });

  // shortcuts: the ones here are kept unless the imported entry is chosen
  const hotkeys: HotkeyRow[] = [];
  const holders = new Map<string, Node>();
  const flat = flatten(config.trays);
  for (const f of flat) {
    const c = f.node.hotkey && !imported.has(f.node) ? canonicalHotkey(f.node.hotkey) : undefined;
    if (c && !holders.has(c)) holders.set(c, f.node);
  }
  const launcher = config.settings.launcherHotkey ? canonicalHotkey(config.settings.launcherHotkey) : undefined;
  for (const f of flat) {
    if (!imported.has(f.node) || !f.node.hotkey) continue;
    const c = canonicalHotkey(f.node.hotkey);
    if (!c) continue;
    const key = importedKey.get(f.node)!;
    if (c === launcher) {
      hotkeys.push({ key, label: f.node.label, hotkey: f.node.hotkey, holder: 'the launcher', launcher: true, winner: 'existing' });
      delete f.node.hotkey;
      continue;
    }
    const holder = holders.get(c);
    if (!holder) {
      holders.set(c, f.node);
      continue;
    }
    const winner = choices.hotkeys[key] ?? 'existing';
    hotkeys.push({ key, label: f.node.label, hotkey: f.node.hotkey, holder: holder.label, holderImported: imported.has(holder), launcher: false, winner });
    if (winner === 'existing') delete f.node.hotkey;
    else {
      delete holder.hotkey;
      holders.set(c, f.node);
    }
  }

  const parsed = parseConfig(config);
  const live = rows.filter((r) => r.status !== 'inside');
  const count = (d: Decision) => live.filter((r) => r.decision === d).length;
  return {
    entries: rows,
    hotkeys,
    schedules: scheduleRowsOut,
    variables,
    settings,
    config,
    icons: [...usedIcons],
    issues: parsed.ok ? [] : parsed.issues,
    warnings: parsed.ok ? parsed.warnings : [],
    counts: {
      add: count('add'),
      replace: count('replace'),
      merge: count('merge'),
      rename: count('rename'),
      schedules: scheduleRowsOut.filter((s) => s.checked).length,
      variables: variables.filter((v) => v.checked).length,
      settings: settings.filter((s) => s.checked).length,
    },
  };
}

/** Changes worth importing: anything checked. */
export function planChanges(plan: ImportPlan): number {
  const c = plan.counts;
  return c.add + c.replace + c.merge + c.rename + c.schedules + c.variables + c.settings;
}

/** Ticking a row that is not imported: the first thing it can do. */
export function checkedDecision(row: EntryRow): Decision {
  return row.options[0] ?? 'add';
}
