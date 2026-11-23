import { z } from 'zod';
import { cronError, parseInterval } from './cron.ts';
import { canonicalHotkey, hotkeyError } from './hotkey.ts';
import { globError, patternList } from './glob.ts';
import { windowError } from './window.ts';
import { undefinedReferences } from './varRefs.ts';

/*
 * TrayCommand configuration (format v2).
 *
 * Single source of truth: the TypeScript types, the runtime validation and the
 * public JSON Schema (scripts/schema.mjs) are all derived from these definitions.
 */

export const CONFIG_VERSION = 2;
export const SCHEMA_URL = 'https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json';

const id = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/, 'Only letters, numbers, "_", "-" and "."')
  .describe('Unique identifier, used to reference this entry from other entries.');

export const ShellSchema = z
  .union([
    z.enum(['powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'sh']),
    z
      .object({
        command: z.string().min(1).describe('Executable of the shell.'),
        args: z.array(z.string()).default([]).describe('Arguments placed before the script, e.g. ["-c"].'),
      })
      .strict(),
  ])
  .describe('Shell used to run scripts: a preset name or a custom executable with its arguments.');
export type Shell = z.infer<typeof ShellSchema>;

const notify = z
  .union([z.boolean(), z.string()])
  .describe('Notification shown when the action succeeds: false = none, true = default text, string = custom text. Errors are always notified.');

/** A value asked to the user when the action starts. */
export const InputSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Letters, numbers and "_", not starting with a number')
      .describe('Name used in the script as ${NAME}. Also passed as an environment variable with the same name.'),
    label: z.string().optional().describe('Text shown next to the field (default: the name).'),
    type: z
      .enum(['text', 'password', 'number', 'select', 'checkbox', 'file', 'folder'])
      .optional()
      .describe('Kind of field (default "text"). "password" is masked, never remembered and hidden in the activity log. "checkbox" gives "true" or "false".'),
    default: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Value proposed the first time (then the last value used is proposed, unless remember is false).'),
    placeholder: z.string().optional().describe('Hint shown inside an empty field.'),
    options: z
      .array(z.union([z.string(), z.object({ value: z.string(), label: z.string().optional() }).strict()]))
      .optional()
      .describe('Choices of a "select".'),
    optionsCommand: z.string().optional().describe('Script whose output lines are the choices of a "select" (run when the form opens, with the shell of the action).'),
    optional: z.boolean().optional().describe('Allow an empty value.'),
    pattern: z.string().optional().describe('Regular expression the value must match.'),
    remember: z.boolean().optional().describe('Propose the last value used next time (default true; never for passwords).'),
  })
  .strict();
export type Input = z.infer<typeof InputSchema>;

/** Reference to another entry action: "id" (same kind of action), "id:on", "id:off" or "id:right". */
export const ActionRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+(:(on|off|right))?$/)
  .describe('Reference to another entry: "<id>" runs the same kind of action (on → on, off → off), "<id>:on", "<id>:off" or "<id>:right" forces one.');

export const ActionSchema = z
  .object({
    run: z.string().min(1).describe('Script to run.'),
    shell: ShellSchema.optional().describe('Overrides the shell for this action.'),
    cwd: z.string().optional().describe('Working directory. Relative paths are resolved from the config file folder.'),
    env: z.record(z.string(), z.string()).optional().describe('Extra environment variables.'),
    timeout: z.number().int().positive().optional().describe('Kill the process after N seconds.'),
    notify: notify.optional(),
    confirm: z.string().optional().describe('Ask for confirmation with this text before running.'),
    terminal: z.boolean().optional().describe('Run in a visible terminal window that stays open, instead of hidden.'),
    admin: z
      .boolean()
      .optional()
      .describe('Run with administrator privileges (UAC prompt on every run). Requires settings.allowAdminCommands.'),
    before: z.array(ActionRefSchema).optional().describe('Actions of other entries to run, in order, before this one.'),
    parallel: z.array(ActionRefSchema).optional().describe('Actions of other entries to run together with this one.'),
    after: z.array(ActionRefSchema).optional().describe('Actions of other entries to run, in order, after this one.'),
    inputs: z.array(InputSchema).optional().describe('Values asked when the action starts, used in the script as ${NAME}.'),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;

/** A plain string is shorthand for { run: string }. */
export const ActionInputSchema = z.union([z.string().min(1), ActionSchema]);
export type ActionInput = z.infer<typeof ActionInputSchema>;

export const StateSchema = z
  .object({
    check: z.string().min(1).describe('Script that reports the state. Exit code != 0 means OFF; with no patterns, exit code 0 means ON.'),
    shell: ShellSchema.optional(),
    on: z.string().optional().describe('Regular expression: output matching it means ON.'),
    off: z.string().optional().describe('Regular expression: output matching it means OFF (tested first when present).'),
    interval: z.number().int().min(2).default(60).describe('Seconds between checks.'),
    iconOff: z.string().optional().describe('Icon shown when the state is OFF (the main icon is used when ON).'),
    notify: z
      .object({
        on: notify.optional(),
        off: notify.optional(),
      })
      .strict()
      .optional()
      .describe('Notifications when the state changes.'),
  })
  .strict()
  .describe('Makes the entry a toggle: the check script decides whether it is ON or OFF.');
export type State = z.infer<typeof StateSchema>;

export const WatchSchema = z
  .object({
    path: z.string().describe('Folder to watch. ${VARIABLES} allowed; a relative path starts from the configuration folder.'),
    files: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('File name patterns, e.g. "*.txt", "*.{csv,xlsx}", "report-??.pdf" (a string with commas or a list). With "/" the pattern matches the path inside the folder ("in/**/*.txt"). Default: every file.'),
    events: z
      .array(z.enum(['add', 'change', 'remove']))
      .optional()
      .describe('What starts a run: "add" = a file appears (created, copied, moved or renamed in), "change" = a file is modified, "remove" = a file disappears. Default ["add"].'),
    subfolders: z.boolean().optional().describe('Watch the sub folders too.'),
    existing: z.boolean().optional().describe('Also run for the matching files already in the folder when the watch starts (TrayCommand starts, the schedule is saved, or its time window opens).'),
    batch: z.boolean().optional().describe('One run for all the files that arrive together (listed in TC_FILES) instead of one run per file.'),
    settle: z.string().optional().describe('Quiet time before running, so that files are completely written: e.g. "2s" (default), "10s".'),
  })
  .strict()
  .describe('Runs the entry when files appear, change or disappear in a folder. The run gets TC_FILE, TC_FILE_NAME, TC_FILE_DIR, TC_EVENT, TC_FILES as ${...} and environment variables.');
export type Watch = z.infer<typeof WatchSchema>;

export const ConditionSchema = z
  .union([
    z.string(),
    z
      .object({
        check: z.string().describe('Script of the check.'),
        on: z.string().optional().describe('Regular expression: the check passes only if its output matches.'),
        off: z.string().optional().describe('Regular expression: the check fails if its output matches (tested first).'),
        shell: ShellSchema.optional(),
        timeout: z.number().int().positive().optional().describe('Seconds before the check is stopped (default 60): a check stopped fails.'),
      })
      .strict(),
  ])
  .describe('Run only if this check passes: exit code 0 (and, when given, output matching "on" and not "off"), like the state of a toggle. The check gets the same values as the run (TC_FILE…).');
export type Condition = z.infer<typeof ConditionSchema>;

export const ChoiceSchema = z
  .object({
    label: z.string().describe('Text of the button.'),
    run: z.string().optional().describe('"self" = what the schedule runs; or another entry: "<id>", "<id>:on", "<id>:off", "<id>:right".'),
    action: ActionInputSchema.optional().describe('A command of its own for this choice.'),
  })
  .strict()
  .describe('A button of an alert: exactly one of run or action. It gets the values of the event (TC_FILE…).');
export type Choice = z.infer<typeof ChoiceSchema>;

export const AlertSchema = z
  .object({
    style: z.enum(['window', 'notification']).optional().describe('"window" (default) = a small window over all the others; "notification" = a system notification: clicking it shows the choices.'),
    title: z.string().optional().describe('Default: the label of the entry. ${VALUES} allowed.'),
    text: z.string().optional().describe('The message. ${VALUES} allowed, e.g. "${TC_FILE_NAME} has arrived".'),
    choices: z.array(ChoiceSchema).optional().describe('Up to 4 buttons. Without choices the alert only informs.'),
    timeout: z.string().optional().describe('Close the alert if nobody answers within this time, e.g. "2m".'),
    default: z.string().optional().describe('Label of the choice run when the timeout expires (otherwise nothing runs).'),
    click: z
      .string()
      .optional()
      .describe('Notifications only: label of the choice run directly when the notification is clicked, without showing the choices.'),
  })
  .strict()
  .describe('Show an alert instead of running directly: a message, and buttons to choose what to run.');
export type Alert = z.infer<typeof AlertSchema>;

export const ScheduleSchema = z
  .object({
    cron: z.string().optional().describe('Cron expression (minute hour day month weekday), local time, e.g. "0 9 * * 1-5" = 09:00 on weekdays.'),
    every: z.string().optional().describe('Interval, e.g. "30s", "15m", "2h", "1d", "1h30m". The first run is one interval after TrayCommand starts.'),
    startup: z.boolean().optional().describe('Run once when TrayCommand starts.'),
    watch: WatchSchema.optional(),
    between: z.string().optional().describe('Active only in this time range, local time, e.g. "08:00-18:00" or "22:00-06:00" (crosses midnight). Runs and file events outside it are skipped.'),
    days: z.string().optional().describe('Active only on these days: "mon-fri", "sat,sun", "mon,wed,fri" (with "between": the days the range starts on).'),
    run: z
      .enum(['click', 'on', 'off', 'right'])
      .optional()
      .describe('What to run: "click" (default) = what a click does; "on" / "off" = turn a toggle on / off (skipped when it already is); "right" = the right click action.'),
    values: z.record(z.string(), z.string()).optional().describe('Values for the inputs of the action (scheduled runs never ask: missing values use the default).'),
    disabled: z.boolean().optional().describe('Keep the schedule without running it.'),
    if: ConditionSchema.optional(),
    alert: AlertSchema.optional(),
  })
  .strict()
  .describe('When to run the entry automatically. Exactly one of cron, every, startup or watch, optionally limited to a time window (between, days).');
export type Schedule = z.infer<typeof ScheduleSchema>;

export const HotkeyConfirmSchema = z
  .union([
    z.boolean(),
    z
      .object({
        text: z.string().optional().describe('The question. ${VARIABLES} allowed. Default: "Run “<label>”?" ("Turn on/off …" for toggles).'),
        button: z.string().optional().describe('Text of the confirm button. Default: "Run" ("Turn on" / "Turn off" for toggles).'),
      })
      .strict(),
  ])
  .describe('Ask before the keyboard shortcut runs the entry: true = default texts, or custom texts. Clicks, the launcher and schedules do not ask. Default: no confirmation.');
export type HotkeyConfirm = z.infer<typeof HotkeyConfirmSchema>;

const entryBase = {
  id: id.optional(),
  label: z.string().describe('Text shown in the menu (tooltip for a tray).'),
  icon: z.string().optional().describe('Image file (png, ico, jpg). Relative paths are resolved from the config file folder.'),
  hidden: z.boolean().optional().describe('Hide without deleting.'),
  disabled: z.boolean().optional().describe('Shown greyed out and not clickable; state checks are paused.'),
  enabledWhen: z
    .string()
    .regex(/^!?[A-Za-z0-9_.-]+$/)
    .optional()
    .describe('Enabled only while the entry with this id is ON ("!id" = while it is OFF).'),
  action: ActionInputSchema.optional().describe('Run on click (on click while OFF, for toggles).'),
  offAction: ActionInputSchema.optional().describe('Toggles only: run on click while ON.'),
  state: StateSchema.optional(),
  hotkey: z.string().optional().describe('Global keyboard shortcut, e.g. "Ctrl+Alt+V": works like a click from any application. On an entry with only a menu it opens the launcher on that menu.'),
  hotkeyConfirm: HotkeyConfirmSchema.optional(),
  schedules: z.array(ScheduleSchema).optional().describe('Run the entry automatically (cron, interval, at startup, when files change).'),
};

export interface MenuEntry {
  id?: string;
  label: string;
  icon?: string;
  hidden?: boolean;
  disabled?: boolean;
  enabledWhen?: string;
  action?: ActionInput;
  offAction?: ActionInput;
  state?: State;
  hotkey?: string;
  hotkeyConfirm?: HotkeyConfirm;
  schedules?: Schedule[];
  menu?: MenuNode[];
}
export interface Separator {
  separator: true;
}
export type MenuNode = MenuEntry | Separator;

export const SeparatorSchema = z.object({ separator: z.literal(true) }).strict();

export const MenuEntrySchema: z.ZodType<MenuEntry> = z.lazy(() =>
  z
    .object({
      ...entryBase,
      menu: z.array(MenuNodeSchema).optional().describe('Sub menu.'),
    })
    .strict(),
);
export const MenuNodeSchema: z.ZodType<MenuNode> = z.lazy(() => z.union([SeparatorSchema, MenuEntrySchema]).meta({ id: 'MenuNode', title: 'Menu entry or separator' }));

export const TraySchema = z
  .object({
    ...entryBase,
    id: id,
    rightAction: ActionInputSchema.optional().describe('Run on right click. Without it, right click opens the menu.'),
    menu: z.array(MenuNodeSchema).optional().describe('Menu of the tray icon. Without an action, left click opens it too.'),
  })
  .strict();
export type Tray = z.infer<typeof TraySchema>;

/** Looks of the editor and the launcher (each with its own icon). */
export const STYLES = ['aurora', 'terminal', 'brutal', 'neon'] as const;
export type Style = (typeof STYLES)[number];
export const STYLE_NAMES: Record<Style, string> = { aurora: 'Aurora', terminal: 'Phosphor', brutal: 'Brutal', neon: 'Neon HUD' };

export const SettingsSchema = z
  .object({
    shell: ShellSchema.optional().describe('Default shell. When omitted: powershell on Windows, $SHELL (or bash) elsewhere.'),
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    style: z
      .enum(STYLES)
      .default('aurora')
      .describe('Look of the editor, the launcher and the icon: "aurora" (default), "terminal" (Phosphor), "brutal", "neon" (Neon HUD). Light or dark follows "theme".'),
    appMenu: z
      .string()
      .default('own')
      .describe('"own" = TrayCommand has its own tray icon; otherwise the id of a tray whose menu gets the TrayCommand section.'),
    notifyOnStartup: z.boolean().default(false),
    checkUpdates: z.boolean().default(true),
    autostart: z.boolean().default(false).describe('Start TrayCommand when you log in.'),
    allowAdminCommands: z.boolean().default(false).describe('Allow actions with "admin": true (UAC prompt on each run).'),
    launcherHotkey: z
      .string()
      .default('Ctrl+Alt+Space')
      .describe('Global keyboard shortcut that opens the launcher (search and run any entry). Empty = no shortcut.'),
    skillUpdates: z
      .enum(['auto', 'ask'])
      .default('auto')
      .describe('TrayCommand skill for AI agents (Claude Code, opencode): "auto" = update it silently when TrayCommand has a newer one, "ask" = ask first.'),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(CONFIG_VERSION),
    settings: SettingsSchema.default(SettingsSchema.parse({})),
    variables: z
      .record(z.string().regex(/^[A-Za-z0-9_]+$/), z.string())
      .default({})
      .describe('Reusable values: write ${NAME} in scripts, paths and labels. ${env:NAME} and ${configDir} are built in.'),
    secrets: z
      .array(z.string().regex(/^[A-Za-z0-9_]+$/))
      .optional()
      .describe('Names of secret variables (passwords, tokens): used as ${NAME} like the others, but their values are never written in this file. They are kept encrypted on this PC, set from the Variables page of the editor, hidden in the activity log and never exported.'),
    trays: z.array(TraySchema).default([]),
  })
  .strict()
  .describe('TrayCommand configuration');
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

export function isSeparator(node: MenuNode): node is Separator {
  return (node as Separator).separator === true;
}

export function normalizeAction(input: ActionInput | undefined): Action | undefined {
  if (input === undefined) return undefined;
  return typeof input === 'string' ? { run: input } : input;
}

export function emptyConfig(): Config {
  return ConfigSchema.parse({ $schema: SCHEMA_URL, version: CONFIG_VERSION, trays: [] });
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ParseResult = { ok: true; config: Config; warnings: ConfigIssue[] } | { ok: false; issues: ConfigIssue[] };

function pathToString(path: PropertyKey[]): string {
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)), '');
}

/** Validates a raw object and cross-checks references between entries. */
export function parseConfig(raw: unknown): ParseResult {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({ path: pathToString(issue.path), message: issue.message })),
    };
  }
  const config = result.data;
  const issues: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const ids = new Map<string, string>();

  const visit = (node: MenuNode | Tray, path: string) => {
    if (isSeparator(node as MenuNode)) return;
    const entry = node as MenuEntry;
    if (entry.id) {
      if (ids.has(entry.id)) issues.push({ path: `${path}.id`, message: `Duplicate id "${entry.id}" (also at ${ids.get(entry.id)})` });
      else {
        ids.set(entry.id, path);
        entriesById.set(entry.id, entry as MenuEntry & { rightAction?: ActionInput });
      }
    }
    if (entry.offAction && !entry.state) warnings.push({ path: `${path}.offAction`, message: 'offAction is used only together with state' });
    if (!config.settings.allowAdminCommands) {
      for (const key of ['action', 'offAction', 'rightAction'] as const) {
        if (normalizeAction((entry as MenuEntry & { rightAction?: ActionInput })[key])?.admin) {
          warnings.push({ path: `${path}.${key}.admin`, message: 'Runs as administrator, but settings.allowAdminCommands is off: it will be refused until it is turned on' });
        }
      }
    }
    checkHotkey(entry.hotkey, `${path}.hotkey`);
    if (entry.hotkeyConfirm && !entry.hotkey) warnings.push({ path: `${path}.hotkeyConfirm`, message: 'Used only together with hotkey' });
    checkInputs(entry as MenuEntry & { rightAction?: ActionInput }, path);
    entry.schedules?.forEach((schedule, i) => checkSchedule(entry as MenuEntry & { rightAction?: ActionInput }, schedule, `${path}.schedules[${i}]`));
    entry.menu?.forEach((child, i) => visit(child, `${path}.menu[${i}]`));
  };

  const hotkeys = new Map<string, string>();
  const checkHotkey = (value: string | undefined, path: string) => {
    if (!value) return;
    const error = hotkeyError(value);
    if (error) {
      issues.push({ path, message: error });
      return;
    }
    const canonical = canonicalHotkey(value)!;
    const other = hotkeys.get(canonical);
    if (other) issues.push({ path, message: `Shortcut ${value} is already used by ${other === 'settings.launcherHotkey' ? 'the launcher' : other}` });
    else hotkeys.set(canonical, path);
  };
  checkHotkey(config.settings.launcherHotkey, 'settings.launcherHotkey');

  const checkInputs = (entry: MenuEntry & { rightAction?: ActionInput }, path: string) => {
    for (const key of ['action', 'offAction', 'rightAction'] as const) {
      const inputs = normalizeAction(entry[key])?.inputs;
      if (!inputs) continue;
      const names = new Set<string>();
      inputs.forEach((input, i) => {
        const at = `${path}.${key}.inputs[${i}]`;
        if (names.has(input.name)) issues.push({ path: `${at}.name`, message: `Duplicate input "${input.name}"` });
        names.add(input.name);
        if (input.type === 'select' && !input.options?.length && !input.optionsCommand) issues.push({ path: at, message: 'A "select" needs options or optionsCommand' });
        if (input.pattern !== undefined) {
          try {
            new RegExp(input.pattern);
          } catch (error) {
            issues.push({ path: `${at}.pattern`, message: `Invalid regular expression: ${(error as Error).message}` });
          }
        }
      });
    }
  };

  const checkRegex = (source: string | undefined, path: string) => {
    if (source === undefined) return;
    try {
      new RegExp(source);
    } catch (error) {
      issues.push({ path, message: `Invalid regular expression: ${(error as Error).message}` });
    }
  };
  const checkCondition = (condition: Condition, path: string) => {
    const c = typeof condition === 'string' ? { check: condition } : condition;
    if (!c.check.trim()) issues.push({ path: typeof condition === 'string' ? path : `${path}.check`, message: 'Write the check command' });
    if (typeof condition !== 'string') {
      checkRegex(condition.on, `${path}.on`);
      checkRegex(condition.off, `${path}.off`);
    }
  };
  /** Choices that run other entries: checked once every id is known. */
  const choiceRefs: { ref: string; path: string }[] = [];
  const entriesById = new Map<string, MenuEntry & { rightAction?: ActionInput }>();
  const checkAlert = (alert: Alert, path: string) => {
    const choices = alert.choices ?? [];
    if (!choices.length && !alert.text?.trim()) issues.push({ path, message: 'Write a message or add choices' });
    if (choices.length > 4) issues.push({ path: `${path}.choices`, message: 'At most 4 choices' });
    const labels = new Set<string>();
    choices.forEach((choice, i) => {
      const at = `${path}.choices[${i}]`;
      if (!choice.label.trim()) issues.push({ path: `${at}.label`, message: 'Write the text of the button' });
      else if (labels.has(choice.label)) issues.push({ path: `${at}.label`, message: `Two choices are called "${choice.label}"` });
      labels.add(choice.label);
      if ((choice.run === undefined) === (choice.action === undefined)) issues.push({ path: at, message: 'Set exactly one of run or action' });
      if (choice.run !== undefined && choice.run !== 'self') {
        if (!/^[A-Za-z0-9_.-]+(:(on|off|right))?$/.test(choice.run)) issues.push({ path: `${at}.run`, message: 'Use "self" or an entry id, optionally with :on, :off or :right' });
        else choiceRefs.push({ ref: choice.run, path: `${at}.run` });
      }
    });
    if (alert.timeout !== undefined) {
      const seconds = parseInterval(alert.timeout);
      if (seconds === undefined) issues.push({ path: `${path}.timeout`, message: 'Use a number and a unit: "30s", "5m", "1h"' });
      else if (seconds < 5 || seconds > 86400) issues.push({ path: `${path}.timeout`, message: 'Between 5 seconds and 1 day' });
    }
    if (alert.default !== undefined) {
      if (!choices.some((c) => c.label === alert.default)) issues.push({ path: `${path}.default`, message: `No choice is called "${alert.default}"` });
      else if (alert.timeout === undefined) warnings.push({ path: `${path}.default`, message: 'The default choice is used only with a timeout' });
    }
    if (alert.click !== undefined) {
      if (!choices.some((c) => c.label === alert.click)) issues.push({ path: `${path}.click`, message: `No choice is called "${alert.click}"` });
      else if (alert.style !== 'notification') warnings.push({ path: `${path}.click`, message: 'The click choice is used only with style "notification"' });
    }
  };
  const checkSchedule = (entry: MenuEntry & { rightAction?: ActionInput }, schedule: Schedule, path: string) => {
    const kinds = [schedule.cron !== undefined, schedule.every !== undefined, schedule.startup === true, schedule.watch !== undefined].filter(Boolean).length;
    if (kinds !== 1) issues.push({ path, message: 'Set exactly one of cron, every, startup or watch' });
    const windowProblem = windowError(schedule.between, schedule.days);
    if (windowProblem?.between) issues.push({ path: `${path}.between`, message: windowProblem.between });
    if (windowProblem?.days) issues.push({ path: `${path}.days`, message: windowProblem.days });
    if (schedule.watch) {
      const w = schedule.watch;
      if (!w.path.trim()) issues.push({ path: `${path}.watch.path`, message: 'Choose the folder to watch' });
      patternList(w.files).forEach((p) => {
        const error = globError(p);
        if (error) issues.push({ path: `${path}.watch.files`, message: error });
      });
      if (w.events && !w.events.length) issues.push({ path: `${path}.watch.events`, message: 'Choose at least one event' });
      if (w.settle !== undefined) {
        const seconds = parseInterval(w.settle);
        if (seconds === undefined) issues.push({ path: `${path}.watch.settle`, message: 'Use a number and a unit: "2s", "1m"' });
        else if (seconds > 3600) issues.push({ path: `${path}.watch.settle`, message: 'The longest wait is 1 hour' });
      }
    }
    if (schedule.cron !== undefined) {
      const error = cronError(schedule.cron);
      if (error) issues.push({ path: `${path}.cron`, message: error });
    }
    if (schedule.every !== undefined) {
      const seconds = parseInterval(schedule.every);
      if (seconds === undefined) issues.push({ path: `${path}.every`, message: 'Use a number and a unit: "30s", "15m", "2h", "1d"' });
      else if (seconds < 5) issues.push({ path: `${path}.every`, message: 'The minimum interval is 5 seconds' });
    }
    const run = schedule.run ?? 'click';
    const target = run === 'off' ? entry.offAction : run === 'right' ? entry.rightAction : entry.action;
    if (schedule.if !== undefined) checkCondition(schedule.if, `${path}.if`);
    if (schedule.alert) checkAlert(schedule.alert, `${path}.alert`);
    // with an alert the entry itself runs only through a "self" choice
    const runsSelf = !schedule.alert || (schedule.alert.choices ?? []).some((c) => c.run === 'self');
    if (runsSelf && !target && !(run === 'click' && entry.state && entry.offAction)) {
      issues.push({ path: `${path}.run`, message: run === 'off' ? 'Nothing to run: the entry has no offAction' : run === 'right' ? 'Nothing to run: the entry has no rightAction' : 'Nothing to run: the entry has no action' });
    }
    if ((run === 'on' || run === 'off') && !entry.state) warnings.push({ path: `${path}.run`, message: `"${run}" is meant for toggles: without a state it always runs` });
    const action = normalizeAction(target);
    const known = new Set((action?.inputs ?? []).map((i) => i.name));
    for (const name of Object.keys(schedule.values ?? {})) {
      if (!known.has(name)) warnings.push({ path: `${path}.values.${name}`, message: `The action has no input "${name}"` });
    }
  };
  config.trays.forEach((tray, i) => visit(tray, `trays[${i}]`));

  const checkRef = (ref: string, path: string) => {
    const target = ref.split(':')[0]!;
    if (!ids.has(target)) issues.push({ path, message: `Unknown id "${target}"` });
  };
  const visitRefs = (node: MenuNode | Tray, path: string) => {
    if (isSeparator(node as MenuNode)) return;
    const entry = node as MenuEntry & { rightAction?: ActionInput };
    for (const key of ['action', 'offAction', 'rightAction'] as const) {
      const action = normalizeAction(entry[key]);
      if (!action) continue;
      for (const when of ['before', 'parallel', 'after'] as const) {
        action[when]?.forEach((ref, i) => checkRef(ref, `${path}.${key}.${when}[${i}]`));
      }
    }
    if (entry.enabledWhen) checkRef(entry.enabledWhen.replace(/^!/, ''), `${path}.enabledWhen`);
    for (const pattern of ['on', 'off'] as const) {
      const source = entry.state?.[pattern];
      if (source === undefined) continue;
      try {
        new RegExp(source);
      } catch (error) {
        issues.push({ path: `${path}.state.${pattern}`, message: `Invalid regular expression: ${(error as Error).message}` });
      }
    }
    entry.menu?.forEach((child, i) => visitRefs(child, `${path}.menu[${i}]`));
  };
  config.trays.forEach((tray, i) => visitRefs(tray, `trays[${i}]`));
  for (const c of choiceRefs) {
    checkRef(c.ref, c.path);
    const [id, how] = c.ref.split(':') as [string, 'on' | 'off' | 'right' | undefined];
    const target = entriesById.get(id);
    if (!target) continue;
    const action = how === 'off' ? target.offAction : how === 'right' ? target.rightAction : target.action;
    if (!action) warnings.push({ path: c.path, message: `"${id}" has no ${how === 'off' ? 'offAction' : how === 'right' ? 'rightAction' : 'action'}: this button does nothing` });
  }

  if (config.settings.appMenu !== 'own' && !config.trays.some((t) => t.id === config.settings.appMenu)) {
    issues.push({ path: 'settings.appMenu', message: `No tray with id "${config.settings.appMenu}"` });
  }

  const secretNames = new Set<string>();
  (config.secrets ?? []).forEach((name, i) => {
    if (secretNames.has(name)) issues.push({ path: `secrets[${i}]`, message: `The secret "${name}" is listed twice` });
    else if (config.variables[name] !== undefined) issues.push({ path: `secrets[${i}]`, message: `"${name}" is both a variable and a secret: keep only one` });
    secretNames.add(name);
  });
  for (const ref of undefinedReferences(config)) warnings.push({ path: ref.path, message: ref.message });

  return issues.length ? { ok: false, issues } : { ok: true, config, warnings };
}
