import { computed, signal } from '@preact/signals';
import type { AppInfo, EntryStatus, ExecutionLog, SkillsInfo, UpdateInfo } from '../shared/api';
import { type Config, type MenuEntry, type MenuNode, type Tray, isSeparator, parseConfig, type ConfigIssue } from '../shared/config';

export const api = window.traycommand;

export const info = signal<AppInfo | undefined>(undefined);
export const saved = signal<Config | undefined>(undefined);
export const draft = signal<Config | undefined>(undefined);
export const loadIssues = signal<ConfigIssue[]>([]);
export const rawText = signal('');
export const status = signal<Map<string, EntryStatus>>(new Map());
export const logs = signal<ExecutionLog[]>([]);
export const update = signal<UpdateInfo | undefined>(undefined);
export const skills = signal<SkillsInfo | undefined>(undefined);
/** The skill banner was closed with "Not now" (until the next start). */
export const skillsSnoozed = signal(false);
export const route = signal<string>(location.hash.replace(/^#/, '') || '/');
/** Path of the selected entry: [trayIndex, menuIndex, ...] */
export const selection = signal<number[]>([]);
export const toast = signal<{ text: string; kind: 'ok' | 'error' } | undefined>(undefined);

/** JSON with sorted keys, so that key order does not count as a change. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

export const dirty = computed(() => stableStringify(saved.value) !== stableStringify(draft.value));
export const validation = computed(() => (draft.value ? parseConfig(draft.value) : undefined));

export function navigate(to: string) {
  location.hash = to;
  route.value = to;
}
window.addEventListener('hashchange', () => (route.value = location.hash.replace(/^#/, '') || '/'));

let toastTimer: number | undefined;
export function showToast(text: string, kind: 'ok' | 'error' = 'ok') {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = undefined), 3500);
}

export async function reload() {
  const loaded = await api.loadConfig();
  rawText.value = loaded.raw;
  if (loaded.ok) {
    // keep local edits only if the user has unsaved changes
    const keepDraft = draft.peek() !== undefined && dirty.peek();
    saved.value = loaded.config;
    if (!keepDraft) draft.value = structuredClone(loaded.config);
    loadIssues.value = [];
  } else {
    loadIssues.value = loaded.issues;
  }
}

export async function init() {
  info.value = await api.info();
  await reload();
  draft.value = saved.value ? structuredClone(saved.value) : undefined;
  status.value = new Map((await api.status()).map((s) => [s.key, s]));
  logs.value = await api.logs();
  api.onStatus((list) => (status.value = new Map(list.map((s) => [s.key, s]))));
  api.onLog((log) => (logs.value = [log, ...logs.value].slice(0, 300)));
  api.onConfigChanged(() => void reload());
  api.onUpdate((u) => (update.value = u));
  api.onNavigate((to) => navigate(to));
  api.onSkills((s) => (skills.value = s));
  skills.value = await api.skills();
  if (draft.value?.trays.length && selection.value.length === 0) selection.value = [0];
}

export async function save(): Promise<boolean> {
  const config = draft.value;
  if (!config) return false;
  const result = await api.saveConfig(config);
  if (!result.ok) {
    showToast(`Not saved: ${result.issues?.[0]?.path} ${result.issues?.[0]?.message}`, 'error');
    return false;
  }
  saved.value = structuredClone(config);
  showToast('Saved');
  return true;
}

export function discard() {
  draft.value = saved.value ? structuredClone(saved.value) : undefined;
}

/* ---------- tree helpers ---------- */

export type AnyEntry = Tray | MenuEntry;

export function entryAt(config: Config | undefined, path: number[]): AnyEntry | undefined {
  if (!config || !path.length) return undefined;
  let node: AnyEntry | undefined = config.trays[path[0]!];
  for (const i of path.slice(1)) {
    const child: MenuNode | undefined = node?.menu?.[i];
    if (!child || isSeparator(child)) return undefined;
    node = child;
  }
  return node;
}

export function statusKey(path: number[]): string {
  return `trays[${path[0]}]${path
    .slice(1)
    .map((i) => `.menu[${i}]`)
    .join('')}`;
}

/** Immutable update of the draft. */
export function mutate(fn: (config: Config) => void) {
  if (!draft.value) return;
  const copy = structuredClone(draft.value);
  fn(copy);
  draft.value = copy;
}

export function updateEntry(path: number[], patch: (entry: AnyEntry) => void) {
  mutate((config) => {
    const entry = entryAt(config, path);
    if (entry) patch(entry);
  });
}

export function siblingsOf(config: Config, path: number[]): (MenuNode | Tray)[] | undefined {
  if (path.length === 1) return config.trays;
  const parent = entryAt(config, path.slice(0, -1));
  return parent?.menu;
}

export function allIds(config: Config | undefined): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const visit = (node: MenuNode | Tray) => {
    if (isSeparator(node as MenuNode)) return;
    const e = node as MenuEntry;
    if (e.id) out.push({ id: e.id, label: e.label });
    e.menu?.forEach(visit);
  };
  config?.trays.forEach(visit);
  return out;
}

export function uniqueId(config: Config, base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  const ids = new Set(allIds(config).map((x) => x.id));
  if (!ids.has(slug)) return slug;
  let n = 2;
  while (ids.has(`${slug}_${n}`)) n++;
  return `${slug}_${n}`;
}

export function issuesFor(path: number[]): ConfigIssue[] {
  const v = validation.value;
  if (!v || v.ok) return [];
  const prefix = statusKey(path);
  return v.issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) && !i.path.slice(prefix.length).includes('.menu['));
}
