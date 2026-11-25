import type { ActionInput, Config, MenuEntry, MenuNode, Schedule, Tray } from './config.ts';

/*
 * Where ${NAME} can be written in a configuration, and what it can refer to there.
 *
 * Every text that TrayCommand expands is listed with the values it gets besides the variables
 * (the inputs of its action, the TC_ values of a folder watch): this is what the editor uses to
 * suggest variables, to find where a variable is used, to rename it and to warn about names
 * that are not defined.
 */

/** Values a run started by a folder watch gets, as ${NAME} and as environment variables. */
export const FILE_VALUES: readonly { name: string; hint: string }[] = [
  { name: 'TC_FILE', hint: 'The file (full path)' },
  { name: 'TC_FILE_NAME', hint: 'Its name' },
  { name: 'TC_FILE_DIR', hint: 'Its folder' },
  { name: 'TC_EVENT', hint: 'add, change or remove' },
  { name: 'TC_FILES', hint: 'All the files that arrived together, one per line' },
  { name: 'TC_WATCH_DIR', hint: 'The folder watched' },
];
const FILE_NAMES = FILE_VALUES.map((v) => v.name);

/** Name of a variable or a secret. */
export const VARIABLE_NAME = /^[A-Za-z0-9_]+$/;

/** ${NAME} written in a text, in order of first appearance (not ${env:NAME}, not ${configDir}). */
export function namesIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) if (m[1] !== 'configDir') names.add(m[1]!);
  return [...names];
}

/** How many times ${name} is written in a text. */
export function countRefs(text: string, name: string): number {
  return text.split(`\${${name}}`).length - 1;
}

export interface TextField {
  /** Where the text is in the configuration, e.g. "trays[0].action.run". */
  path: string;
  /** Key of the entry the text belongs to ("trays[0].menu[1]"); none for the value of a variable. */
  entry?: string;
  /** The entry (with its parents) or "Variables". */
  owner: string;
  /** What the text is: "Click › Script", "Alert message"… */
  where: string;
  text: string;
  /** Names the text gets besides the variables: the inputs of its action, the TC_ values of a folder watch. */
  locals: string[];
  /** Replaces the text (in the configuration the list was made from). */
  set(text: string): void;
}

type Entry = MenuEntry & { rightAction?: ActionInput };
const isSeparator = (node: MenuNode | Tray): boolean => (node as { separator?: boolean }).separator === true;

const ACTION_NAMES = { action: 'Click', offAction: 'Turn off', rightAction: 'Right click' } as const;

/** Every text of the configuration where ${NAME} is replaced. */
export function textFields(config: Config): TextField[] {
  const out: TextField[] = [];

  Object.keys(config.variables).forEach((name) => {
    out.push({
      path: `variables.${name}`,
      owner: 'Variables',
      where: `Value of ${name}`,
      text: config.variables[name]!,
      locals: [],
      set: (t) => (config.variables[name] = t),
    });
  });

  const visit = (entry: Entry, key: string, parents: string[]) => {
    const owner = [...parents, entry.label || '(no label)'].join(' › ');
    const add = (path: string, where: string, text: string, locals: string[], set: (t: string) => void) => out.push({ path, entry: key, owner, where, text, locals, set });
    const files = (entry.schedules ?? []).some((s) => s.watch !== undefined);

    /** An action, written as a string or as an object. */
    const action = (holder: Record<string, unknown>, field: string, at: string, prefix: string, extra: string[]) => {
      const value = holder[field] as ActionInput | undefined;
      if (value === undefined) return;
      if (typeof value === 'string') return add(at, `${prefix}Script`, value, extra, (t) => (holder[field] = t));
      const locals = [...(value.inputs ?? []).map((i) => i.name), ...extra];
      add(`${at}.run`, `${prefix}Script`, value.run, locals, (t) => (value.run = t));
      if (value.cwd !== undefined) add(`${at}.cwd`, `${prefix}Working folder`, value.cwd, locals, (t) => (value.cwd = t));
      for (const name of Object.keys(value.env ?? {})) add(`${at}.env.${name}`, `${prefix}Environment variable ${name}`, value.env![name]!, locals, (t) => (value.env![name] = t));
      if (typeof value.notify === 'string') add(`${at}.notify`, `${prefix}Notification text`, value.notify, locals, (t) => (value.notify = t));
      const notify = value.notify;
      if (typeof notify === 'object' && notify.text !== undefined) add(`${at}.notify.text`, `${prefix}Notification text`, notify.text, locals, (t) => (notify.text = t));
      const notifyError = value.notifyError;
      if (notifyError?.text !== undefined) add(`${at}.notifyError.text`, `${prefix}Error notification text`, notifyError.text, locals, (t) => (notifyError.text = t));
      const confirm = value.confirm;
      if (typeof confirm === 'string') add(`${at}.confirm`, `${prefix}Confirmation`, confirm, locals, (t) => (value.confirm = t));
      else if (confirm) {
        add(`${at}.confirm.text`, `${prefix}Confirmation`, confirm.text, locals, (t) => (confirm.text = t));
        if (confirm.button !== undefined) add(`${at}.confirm.button`, `${prefix}Confirm button`, confirm.button, locals, (t) => (confirm.button = t));
      }
      // the form is shown before the values exist: its texts get the variables only
      value.inputs?.forEach((input, i) => {
        if (input.label !== undefined) add(`${at}.inputs[${i}].label`, `${prefix}Label of ${input.name}`, input.label, [], (t) => (input.label = t));
        if (input.optionsCommand !== undefined) add(`${at}.inputs[${i}].optionsCommand`, `${prefix}Choices of ${input.name}`, input.optionsCommand, [], (t) => (input.optionsCommand = t));
      });
    };

    add(`${key}.label`, 'Name', entry.label, [], (t) => (entry.label = t));
    const hc = entry.hotkeyConfirm;
    if (typeof hc === 'object') {
      if (hc.text !== undefined) add(`${key}.hotkeyConfirm.text`, 'Shortcut › Question', hc.text, [], (t) => (hc.text = t));
      if (hc.button !== undefined) add(`${key}.hotkeyConfirm.button`, 'Shortcut › Confirm button', hc.button, [], (t) => (hc.button = t));
    }
    for (const field of ['action', 'offAction', 'rightAction'] as const) {
      action(entry as unknown as Record<string, unknown>, field, `${key}.${field}`, `${ACTION_NAMES[field]} › `, files ? FILE_NAMES : []);
    }
    const state = entry.state;
    if (state) {
      add(`${key}.state.check`, 'State › Check script', state.check, [], (t) => (state.check = t));
      if (state.labelOff !== undefined) add(`${key}.state.labelOff`, 'State › Name when OFF', state.labelOff, [], (t) => (state.labelOff = t));
      for (const k of ['on', 'off'] as const) {
        const n = state.notify;
        const message = n?.[k];
        if (typeof message === 'string') add(`${key}.state.notify.${k}`, `State › Notification when ${k.toUpperCase()}`, message, [], (t) => (n![k] = t));
      }
    }
    entry.schedules?.forEach((s: Schedule, i) => {
      const at = `${key}.schedules[${i}]`;
      const prefix = `Schedule ${i + 1} › `;
      // the check, the alert and its buttons get the values of the schedule and, for a folder watch, the file
      const locals = [...Object.keys(s.values ?? {}), ...(s.watch ? FILE_NAMES : [])];
      const watch = s.watch;
      if (watch) add(`${at}.watch.path`, `${prefix}Folder`, watch.path, [], (t) => (watch.path = t));
      if (typeof s.if === 'string') add(`${at}.if`, `${prefix}Check`, s.if, locals, (t) => (s.if = t));
      else if (s.if) {
        const c = s.if;
        add(`${at}.if.check`, `${prefix}Check`, c.check, locals, (t) => (c.check = t));
      }
      const alert = s.alert;
      if (alert) {
        if (alert.title !== undefined) add(`${at}.alert.title`, `${prefix}Alert title`, alert.title, locals, (t) => (alert.title = t));
        if (alert.text !== undefined) add(`${at}.alert.text`, `${prefix}Alert message`, alert.text, locals, (t) => (alert.text = t));
        alert.choices?.forEach((c, j) => {
          add(`${at}.alert.choices[${j}].label`, `${prefix}Alert button ${j + 1}`, c.label, locals, (t) => (c.label = t));
          action(c as Record<string, unknown>, 'action', `${at}.alert.choices[${j}].action`, `${prefix}Alert button “${c.label}” › `, locals);
        });
      }
    });
    entry.menu?.forEach((child, i) => {
      if (!isSeparator(child)) visit(child as Entry, `${key}.menu[${i}]`, [...parents, entry.label || '(no label)']);
    });
  };
  config.trays.forEach((tray, i) => visit(tray as Entry, `trays[${i}]`, []));
  return out;
}

export interface VariableUse {
  field: TextField;
  count: number;
}

/** Where ${name} refers to the variable (or secret) of the configuration: a value of the same name (an input) hides it. */
export function variableUses(config: Config, name: string): VariableUse[] {
  return textFields(config)
    .filter((f) => !f.locals.includes(name))
    .map((field) => ({ field, count: countRefs(field.text, name) }))
    .filter((u) => u.count > 0);
}

/** Number of uses of every variable and secret. */
export function useCounts(config: Config): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of textFields(config)) {
    for (const name of namesIn(f.text)) if (!f.locals.includes(name)) counts.set(name, (counts.get(name) ?? 0) + countRefs(f.text, name));
  }
  return counts;
}

/**
 * Renames a variable or a secret. `paths` are the texts where ${from} becomes ${to}
 * (all its uses when omitted, none with an empty list). Returns a new configuration.
 */
export function renameVariable(config: Config, from: string, to: string, paths?: Iterable<string>): Config {
  const next = structuredClone(config);
  const chosen = paths === undefined ? undefined : new Set(paths);
  for (const f of textFields(next)) {
    if (f.locals.includes(from) || (chosen && !chosen.has(f.path))) continue;
    if (countRefs(f.text, from)) f.set(f.text.split(`\${${from}}`).join(`\${${to}}`));
  }
  if (next.variables[from] !== undefined) {
    next.variables = Object.fromEntries(Object.entries(next.variables).map(([k, v]) => [k === from ? to : k, v]));
  }
  if (next.secrets) next.secrets = next.secrets.map((s) => (s === from ? to : s));
  return next;
}

export interface UndefinedReference {
  path: string;
  name: string;
  message: string;
}

/** Why ${name} is left as written in a text (or undefined when it has a value there). */
export function undefinedReason(name: string, known: ReadonlySet<string>, locals: readonly string[]): string | undefined {
  if (known.has(name) || locals.includes(name)) return undefined;
  if (FILE_NAMES.includes(name)) return `\${${name}} has a value only in runs started by a folder watch: here it is left as written`;
  return `\${${name}} is not a variable: it is left as written (fine if it is meant for the shell)`;
}

/** ${NAME} written where nothing of that name exists: TrayCommand leaves them as written. */
export function undefinedReferences(config: Config): UndefinedReference[] {
  const known = new Set([...Object.keys(config.variables), ...(config.secrets ?? [])]);
  const out: UndefinedReference[] = [];
  for (const f of textFields(config)) {
    for (const name of namesIn(f.text)) {
      const message = undefinedReason(name, known, f.locals);
      if (message) out.push({ path: f.path, name, message });
    }
  }
  return out;
}
