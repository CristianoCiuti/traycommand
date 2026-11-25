# Configuration reference

The configuration is one JSON file (by default `traycommand.json` in the [data folder](./cli#data-folder)). The editor writes it for you; this page describes every property.

## Structure

```json
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "settings": {},
  "variables": {},
  "secrets": [],
  "trays": []
}
```

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `$schema` | string | no | URL of the JSON Schema, for autocompletion in editors. |
| `version` | `2` | **yes** | Format version. Must be `2`. |
| `settings` | object | no | [Settings](#settings). |
| `variables` | object | no | [Variables](#variables). |
| `secrets` | array of strings | no | Names of [secret variables](#secrets): their values are never in the file. |
| `trays` | array | no | The [trays](#trays), in display order. |

Unknown properties are errors: a typo such as `"acton"` is reported instead of silently ignored.

## Autocompletion in VS Code

Keep the `$schema` line at the top of the file. VS Code (and other editors with JSON Schema support) then offers autocompletion, descriptions on hover and validation:

```json
"$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json"
```

The schema is also available here: [config.schema.json](/traycommand/schema/v2/config.schema.json){target="_self"}.

## Settings

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `shell` | [shell](#shell) | `powershell` on Windows, `$SHELL` (or bash / zsh) elsewhere | Default shell for actions and state checks. |
| `theme` | `"system"` \| `"light"` \| `"dark"` | `"system"` | Light or dark, for the editor and the launcher. |
| `style` | `"aurora"` \| `"terminal"` \| `"brutal"` \| `"neon"` | `"aurora"` | [Look](../guide/editor#looks) of the editor, the launcher and the app icon: Aurora, Phosphor, Brutal, Neon HUD. |
| `appMenu` | string | `"own"` | `"own"`: TrayCommand has its own tray icon. Otherwise the `id` of a tray whose menu gets a **TrayCommand** sub menu (open, settings, quit…). If that tray is hidden, the TrayCommand icon comes back. |
| `notifyOnStartup` | boolean | `false` | Show a notification when TrayCommand starts hidden. |
| `checkUpdates` | boolean | `true` | Check GitHub releases every 6 hours. See [updates](../guide/startup-and-updates#updates). |
| `autostart` | boolean | `false` | Start TrayCommand when you log in. See [start at login](../guide/startup-and-updates#start-at-login). |
| `allowAdminCommands` | boolean | `false` | Allow actions with `"admin": true` (prompt on each run). See [administrator](../guide/administrator). |
| `launcherHotkey` | string | `"Ctrl+Alt+Space"` | Global [shortcut](#shortcuts) that opens the [launcher](../guide/launcher). `""` = no shortcut. |
| `skillUpdates` | `"auto"` \| `"ask"` | `"auto"` | Update the [skill for AI assistants](../guide/ai-assistants) automatically, or ask first. |

## Variables

```json
"variables": {
  "WS": "C:/work/workspaces",
  "TOOLS": "${configDir}/tools"
}
```

An object of `NAME: value`. Names use letters, digits and `_`. Write `${NAME}` in scripts, labels, icon paths, `cwd`, `env` values, `confirm`, `notify` and `notifyError` texts.

| Syntax | Value |
| --- | --- |
| `${NAME}` | The variable `NAME`. It can contain other variables. |
| `${env:NAME}` | The environment variable `NAME` (empty when not set). |
| `${configDir}` | Folder of the configuration file. |

Unknown names are left untouched, so `${HOME}` in a bash script still reaches the shell. The check of the configuration (and `--validate`) warns about them, without refusing the file.

Variables belong to the whole configuration. Inside an action, its [inputs](#inputs) and, for runs started by a folder watch, the `TC_` values of the file take precedence over a variable with the same name.

## Secrets

```json
"secrets": ["API_TOKEN"]
```

Names (letters, digits, `_`) of variables whose values are **not** in the file: they are set on the Variables page of the editor and kept encrypted on this PC for the current user (`secrets.json` in the [data folder](./cli#data-folder)). Use them as `${API_TOKEN}` like any variable. Their values are shown as `••••` in the activity log, notifications, labels, alerts and test output, and exports carry only the names. A name cannot be both in `variables` and in `secrets`. A secret with no value on this PC is replaced by nothing. See [variables and secrets](../guide/variables#secrets).

## Trays

Each item of `trays` is one tray icon.

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | **Required.** Unique identifier (letters, digits, `_`, `-`, `.`). |
| `label` | string | **Required.** Tooltip text. |
| `icon` | string | Image file (png, ico, jpg). Relative paths are resolved from the configuration file folder. Without it the TrayCommand icon is used. |
| `hidden` | boolean | Hide without deleting. State checks are paused. |
| `disabled` | boolean | Not clickable (click opens the menu); state checks are paused. |
| `enabledWhen` | string or object | Clickable only while the entry with this id is ON (`"id"`) or OFF (`"!id"`); `{ "all": [...] }` while all the conditions hold, `{ "any": [...] }` while at least one does. Groups can be nested. See [enabled when](../guide/concepts#enabled-when). |
| `action` | [action](#actions) | Run on left click (on click while OFF, for toggles). Without it, left click opens the menu. |
| `offAction` | [action](#actions) | Toggles only: run on click while ON. |
| `rightAction` | [action](#actions) | Run on right click. Without it, right click opens the menu. |
| `state` | [state](#state) | Makes the tray a toggle. |
| `hotkey` | [shortcut](#shortcuts) | Global keyboard shortcut: works like a click from any application. Without an action it opens the launcher on the tray menu. |
| `schedules` | array of [schedules](#schedules) | Run the tray automatically. |
| `menu` | array of [menu entries](#menu-entries) and [separators](#separators) | Menu of the tray icon. |

## Menu entries

Same as a tray, except:

- `id` is optional (needed only to reference the entry),
- `rightAction` is not available,
- `label` is the menu text,
- `menu` makes it a sub menu (any depth).

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | Optional unique identifier. |
| `label` | string | **Required.** Menu text. |
| `icon` | string | 16 px image shown next to the label. |
| `hidden` | boolean | Not shown. Children and state checks are paused too. |
| `disabled` | boolean | Shown greyed out; state checks are paused. |
| `enabledWhen` | string or object | `"id"`, `"!id"`, `{ "all": [...] }` or `{ "any": [...] }`, see above. |
| `action` | [action](#actions) | Run on click. |
| `offAction` | [action](#actions) | Toggles only: run on click while ON. |
| `state` | [state](#state) | Makes the entry a toggle (check mark when it has no icon). |
| `hotkey` | [shortcut](#shortcuts) | Global keyboard shortcut (a sub menu without action: opens the launcher on it). |
| `schedules` | array of [schedules](#schedules) | Run the entry automatically. |
| `menu` | array | Sub menu. If the entry also has an action, the sub menu starts with **Run** / **Turn off**. |

An entry with neither `action` nor `menu` is shown greyed out (useful as a title).

## Separators

```json
{ "separator": true }
```

Separators at the start or end of a menu, and repeated separators (for example around hidden entries), are dropped.

## Actions

An action is either a **string** (the script) or an **object**:

```json
"action": "Start-Process notepad"
```

is the same as

```json
"action": { "run": "Start-Process notepad" }
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `run` | string | — | **Required.** Script to run. Multi-line scripts are fine (`\n`). |
| `shell` | [shell](#shell) | `settings.shell` | Shell for this action. |
| `cwd` | string | config folder | Working directory. Relative paths are resolved from the configuration file folder. |
| `env` | object | — | Extra environment variables, `{ "NAME": "value" }`. Values can use variables. |
| `timeout` | integer | none | Kill the process (and its children) after N seconds. Reported as an error. |
| `notify` | boolean \| string \| object | `false` | Notification on success: `false` none, `true` "Done", a string = custom text, `{ "text"?, "click"? }` = text (default "Done") and an entry run when the notification is clicked. Errors are always notified. |
| `notifyError` | `{ "text"?, "click"? }` | — | How a failure is notified: `text` replaces the first line `Failed: <reason>` (the last 3 lines of the output still follow); `click` = entry run when it is clicked (default: open the activity log). |
| `confirm` | string \| `{ "text", "button"? }` | — | Ask before running, in a TrayCommand window: <kbd>Enter</kbd> runs, <kbd>Esc</kbd> cancels. A string is the question; `{ "text", "button" }` also sets the text of the confirm button (default **Run**). Both allow `${VARIABLES}` and the values asked by the action. Runs started by a person ask; scheduled runs do not. |
| `terminal` | boolean | `false` | Run in a visible terminal window that stays open. |
| `admin` | boolean | `false` | Run as administrator (prompt on every run). Requires `settings.allowAdminCommands`. See [administrator](../guide/administrator#run-as-administrator). |
| `before` | array of refs | — | Actions of other entries to run, one after the other, before this one. |
| `parallel` | array of refs | — | Actions of other entries to run together with this one. |
| `after` | array of refs or `{ "run", "when"? }` / `{ "run", "exitCodes" }` | — | Actions of other entries to run, one after the other, after this one. `when`: `"always"` (default), `"success"`, `"failed"`; `exitCodes`: only with these exit codes. See [run after only on some results](../guide/concepts#run-after-only-on-some-results). |
| `inputs` | array of [inputs](#inputs) | — | Values asked in a form before running, used as `${NAME}` and as environment variables. |

A reference is `"id"` (same kind: on → on, off → off; right → on), `"id:on"`, `"id:off"` or `"id:right"`. See [composing actions](../guide/concepts#composing-actions). Unknown ids are errors.

An action succeeds when the script exits with code 0 within the timeout.

## State

`state` turns a tray or entry into a toggle.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `check` | string | — | **Required.** Script that reports the state. |
| `shell` | [shell](#shell) | `settings.shell` | Shell for the check. |
| `on` | string | — | Regular expression: output matching it means ON. |
| `off` | string | — | Regular expression: output matching it means OFF. Tested first. |
| `interval` | integer | `60` | Seconds between checks (minimum 2). |
| `iconOff` | string | — | Icon shown while OFF (the main `icon` is shown while ON). |
| `recheckDelay` | integer (ms, 0–60000) | `700` | Wait between the end of an action of the entry and the check that follows it. `0` checks at once. |
| `optimistic` | boolean | `false` | Show the new state as soon as the action succeeds: ON after `action`, OFF after `offAction` (exit code 0). The check that follows corrects it if it was wrong. Needs both `action` and `offAction` (warning otherwise); `rightAction` and alert choices do not change the state. |
| `notify` | `{ "on"?, "off"? }` | — | Notification when the state changes to ON / OFF: `true` default text, a string = custom text. |

Evaluation of each check:

1. exit code ≠ 0 → **OFF**;
2. output matches `off` → **OFF**;
3. `on` set → **ON** if the output matches it, otherwise **OFF**;
4. otherwise → **ON**.

Patterns are JavaScript regular expressions in multi-line mode (`^` and `$` match at each line). Remember to escape backslashes in JSON (`"\\d+"`). A check is stopped after `max(interval, 30)` seconds. The state is also checked again after the entry's action runs (after `recheckDelay`); a check that was already running when an `optimistic` action ended is ignored and run again. Checks are paused while the entry (or a parent) is hidden or disabled. `admin` is not available for checks.

## Inputs

Values asked before an action runs. See [asking for values](../guide/inputs).

```json
"inputs": [
  { "name": "BRANCH", "label": "Branch", "default": "main" },
  { "name": "ENV", "type": "select", "options": ["dev", { "value": "prod", "label": "Production" }] },
  { "name": "TOKEN", "type": "password" }
]
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | — | **Required.** Letters, digits and `_`, not starting with a digit. Used as `${NAME}` and as the name of the environment variable. Unique within the action. |
| `label` | string | the name | Text shown above the field. |
| `type` | `"text"` \| `"password"` \| `"number"` \| `"select"` \| `"checkbox"` \| `"file"` \| `"folder"` | `"text"` | Kind of field. A checkbox gives `"true"` / `"false"`. |
| `default` | string \| number \| boolean | — | Value proposed the first time. |
| `placeholder` | string | — | Hint inside an empty field. |
| `options` | array of strings or `{ "value", "label"? }` | — | Choices of a `select`. |
| `optionsCommand` | string | — | Script whose output lines are the choices of a `select` (run when the form opens). |
| `optional` | boolean | `false` | Allow an empty value. |
| `pattern` | string | — | Regular expression the whole value must match. |
| `remember` | boolean | `true` | Propose the last value used. Passwords are never remembered. |

When an action runs other entries (`before`, `parallel`, `after`), the inputs of all of them are asked together; a name used twice is asked once.

## Schedules

Run an entry automatically. See [schedules](../guide/schedules).

```json
"schedules": [
  { "cron": "0 9 * * 1-5", "run": "on" },
  { "every": "30m" },
  { "startup": true, "values": { "ENV": "dev" } },
  { "watch": { "path": "C:\\Scans", "files": "*.pdf" }, "between": "08:00-19:00", "days": "mon-fri" }
]
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `cron` | string | — | Cron expression, 5 fields, local time. |
| `every` | string | — | Interval: a number and `s`, `m`, `h` or `d` (`"90s"`, `"15m"`, `"1h30m"`). Minimum 5 seconds. Counted from when TrayCommand starts. |
| `startup` | `true` | — | Once, when TrayCommand starts. |
| `watch` | object | — | When files appear, change or disappear in a folder: `path`, `files` (patterns), `events` (`"add"` `"change"` `"remove"`, default `["add"]`), `subfolders`, `existing`, `batch`, `settle` (default `"2s"`). The run gets `TC_FILE`, `TC_FILE_NAME`, `TC_FILE_DIR`, `TC_EVENT`, `TC_FILES`, `TC_WATCH_DIR`. See [when files change](../guide/schedules#when-files-change). |
| `between` | string | — | Only in this time range, local time: `"08:00-18:00"`, `"22:00-06:00"` (crosses midnight). |
| `days` | string | — | Only on these days: `"mon-fri"`, `"sat,sun"`. See [time window](../guide/schedules#time-window). |
| `if` | string \| object | — | Run only if this check passes (exit code 0; with an object also `on` / `off` patterns, `shell`, `timeout`). Gets the values of the run. See [only if](../guide/schedules#only-if-a-check-passes). |
| `alert` | object | — | Show an alert instead of running directly: `style` (`"window"` \| `"notification"`), `title`, `text`, `choices` (up to 4: `{ "label", "run": "self" \| "<id>[:on\|off\|right]" }` or `{ "label", "action" }`), `timeout`, `default`. See [alerts](../guide/schedules#alerts-and-choices). |
| `run` | `"click"` \| `"on"` \| `"off"` \| `"right"` | `"click"` | What runs. `"on"` / `"off"` are skipped when the toggle already is in that state. |
| `values` | object | — | Values for the inputs of the action. Scheduled runs never ask: missing values use the default. |
| `disabled` | boolean | `false` | Keep the schedule without running it. |

Exactly one of `cron`, `every`, `startup` and `watch` is required. Scheduled runs skip `confirm`, do not run while the entry is disabled, and are skipped while the previous run is still going.

## Shortcuts

Global keyboard shortcuts (`hotkey`, `settings.launcherHotkey`) are keys joined by `+`, case-insensitive: `"Ctrl+Alt+V"`, `"Win+Shift+D"`, `"F9"`.

- Modifiers: `Ctrl` (or `Control`), `Alt` (or `Option`), `Shift`, `Win` (or `Super`, `Meta`, `Cmd`), `CommandOrControl`.
- One key: `A`–`Z`, `0`–`9`, `F1`–`F24`, `Space`, `Tab`, `Enter`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `Esc`, `Plus`, punctuation, `num0`–`num9`, `numadd`, `numsub`, `nummult`, `numdiv`, `numdec`.
- At least one of `Ctrl`, `Alt`, `Win`, unless the key is a function key.

Each shortcut can be used once (entries and launcher together).

## Shell

A preset name or a custom executable:

| Value | Description |
| --- | --- |
| `"powershell"` | Windows PowerShell, `-NoProfile -NonInteractive -ExecutionPolicy Bypass`, UTF-8 output. |
| `"pwsh"` | PowerShell 7, same options. |
| `"cmd"` | `cmd.exe /d /s /c "<script>"`, the script passed exactly as written (quoted paths with spaces work). |
| `"bash"`, `"zsh"` | Login shell (`-lc`). |
| `"sh"` | `sh -c`. |
| `{ "command": "…", "args": ["…"] }` | Custom: `command` is the executable, `args` go before the script (default `[]`). On Windows, `cmd` / `cmd.exe` gets the script like `"cmd"`. |

See [platforms](../guide/platforms#default-shell) for details.

## Validation

Besides the types above, TrayCommand checks that:

- every `id` is unique across all trays and entries;
- every reference in `before`, `parallel`, `after` and `enabledWhen` points to an existing id;
- `on` and `off` are valid regular expressions;
- `settings.appMenu` is `"own"` or the id of a tray;
- shortcuts are valid and not used twice;
- input names are unique within an action, a `select` has `options` or `optionsCommand`, `pattern` is a valid regular expression;
- each schedule has exactly one of `cron` / `every` / `startup` / `watch`, a valid expression, interval, folder and file patterns, a valid time window, and something to run (`"off"` needs an `offAction`, `"right"` a `rightAction`).

`offAction` without `state` is accepted with a warning (it is never used), and so are schedule `values` for inputs the action does not have.

## Complete example

```jsonc
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "settings": {
    "shell": "powershell",
    "theme": "system",
    "style": "aurora",
    "appMenu": "own",
    "autostart": true
  },
  "variables": {
    // reusable values, used below as ${WS}
    "WS": "${configDir}/workspaces"
  },
  "trays": [
    {
      // a toggle: the check decides ON/OFF, the icon follows the state
      "id": "proxy",
      "label": "Proxy",
      "icon": "icons/globe_on.png",
      "state": {
        "check": "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').ProxyEnable",
        "on": "^1$",
        "interval": 5,
        "iconOff": "icons/globe_off.png",
        "notify": { "on": true, "off": true }
      },
      // turning it on/off also switches git_proxy, at the same time
      "action": { "run": "Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' ProxyEnable 1", "parallel": ["git_proxy"] },
      "offAction": { "run": "Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' ProxyEnable 0", "parallel": ["git_proxy"] },
      "menu": [
        {
          "id": "git_proxy",
          "label": "Git proxy",
          "state": { "check": "git config --global --get http.proxy", "interval": 30 },
          "action": "git config --global http.proxy http://proxy.example.com:8080",
          "offAction": "git config --global --unset http.proxy"
        }
      ]
    },
    {
      "id": "server",
      "label": "Web server",
      "icon": "icons/server_on.png",
      "state": { "check": "Get-Process nginx -ErrorAction Stop", "interval": 10, "iconOff": "icons/server_off.png" },
      "action": { "run": "Start-Process nginx -WorkingDirectory C:/nginx", "notify": "Server started" },
      "menu": [
        // clickable only while "server" is ON
        { "label": "Stop server", "enabledWhen": "server", "action": { "run": "Stop-Process -Name nginx", "confirm": "Stop the web server?" } },
        { "separator": true },
        {
          "label": "Sites",
          "menu": [
            { "label": "Intranet", "action": "Start-Process http://localhost:8080" },
            { "label": "Public", "action": "Start-Process http://localhost" }
          ]
        }
      ]
    },
    {
      // no action: a click opens the menu; Ctrl+Alt+C opens the launcher on this menu
      "id": "code",
      "label": "VS Code",
      "icon": "icons/code.png",
      "hotkey": "Ctrl+Alt+C",
      "menu": [
        { "label": "Project A", "action": "code \"${WS}/a.code-workspace\"" },
        { "label": "Project B", "action": "code \"${WS}/b.code-workspace\"" },
        {
          // asks the branch in a small form, then opens the project on it
          "label": "Project A on a branch…",
          "action": {
            "run": "git -C \"${WS}/a\" checkout $env:BRANCH; code \"${WS}/a.code-workspace\"",
            "inputs": [{ "name": "BRANCH", "label": "Branch", "type": "select", "optionsCommand": "git -C \"${WS}/a\" branch --format=%(refname:short)" }]
          }
        }
      ]
    },
    {
      // runs by itself every weekday evening, and on demand with Ctrl+Alt+B
      "id": "backup",
      "label": "Back up notes",
      "hotkey": "Ctrl+Alt+B",
      "action": "robocopy \"$env:USERPROFILE\\Notes\" \"D:\\Backup\\Notes\" /MIR; if ($LASTEXITCODE -lt 8) { exit 0 }",
      "schedules": [{ "cron": "0 18 * * 1-5" }]
    },
    // kept in the file, not shown
    { "id": "notes", "label": "Notes", "icon": "icons/note.png", "hidden": true, "action": "Start-Process notepad" }
  ]
}
```

::: warning Comments
The comments above are for explanation only. JSON does not allow comments: remove them in your file.
:::
