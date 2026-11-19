import { z } from 'zod';

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
export const MenuNodeSchema: z.ZodType<MenuNode> = z.lazy(() => z.union([SeparatorSchema, MenuEntrySchema]));

export const TraySchema = z
  .object({
    ...entryBase,
    id: id,
    rightAction: ActionInputSchema.optional().describe('Run on right click. Without it, right click opens the menu.'),
    menu: z.array(MenuNodeSchema).optional().describe('Menu of the tray icon. Without an action, left click opens it too.'),
  })
  .strict();
export type Tray = z.infer<typeof TraySchema>;

export const SettingsSchema = z
  .object({
    shell: ShellSchema.optional().describe('Default shell. When omitted: powershell on Windows, $SHELL (or bash) elsewhere.'),
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    appMenu: z
      .string()
      .default('own')
      .describe('"own" = TrayCommand has its own tray icon; otherwise the id of a tray whose menu gets the TrayCommand section.'),
    notifyOnStartup: z.boolean().default(false),
    checkUpdates: z.boolean().default(true),
    autostart: z.boolean().default(false).describe('Start TrayCommand when you log in.'),
    allowAdminCommands: z.boolean().default(false).describe('Allow actions with "admin": true (UAC prompt on each run).'),
    language: z.enum(['en', 'it']).default('en'),
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
      else ids.set(entry.id, path);
    }
    if (entry.offAction && !entry.state) warnings.push({ path: `${path}.offAction`, message: 'offAction is used only together with state' });
    entry.menu?.forEach((child, i) => visit(child, `${path}.menu[${i}]`));
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

  if (config.settings.appMenu !== 'own' && !config.trays.some((t) => t.id === config.settings.appMenu)) {
    issues.push({ path: 'settings.appMenu', message: `No tray with id "${config.settings.appMenu}"` });
  }

  return issues.length ? { ok: false, issues } : { ok: true, config, warnings };
}
