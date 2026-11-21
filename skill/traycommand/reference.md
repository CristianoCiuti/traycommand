# TrayCommand configuration reference (format version 2)

JSON Schema: https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json

```json
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "settings": {},
  "variables": {},
  "trays": []
}
```

`version` must be `2`. Unknown properties anywhere are errors. JSON comments are not allowed.

## settings

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `shell` | shell | `powershell` on Windows, `$SHELL` (or bash) elsewhere | Default shell for actions and checks. |
| `theme` | `"system"` \| `"light"` \| `"dark"` | `"system"` | Editor window theme. |
| `appMenu` | string | `"own"` | `"own"` = TrayCommand has its own icon; otherwise the `id` of a tray whose menu gets the TrayCommand sub menu. |
| `notifyOnStartup` | boolean | `false` | Notification when TrayCommand starts hidden. |
| `checkUpdates` | boolean | `true` | Check for new versions. |
| `autostart` | boolean | `false` | Start at login. |
| `allowAdminCommands` | boolean | `false` | Required for actions with `"admin": true`. |
| `launcherHotkey` | string | `"Ctrl+Alt+Space"` | Global shortcut of the launcher (search and run any entry). `""` = none. |
| `skillUpdates` | `"auto"` \| `"ask"` | `"auto"` | Update this AI skill automatically or ask first. |

Do not change settings unless the user explicitly asks. In particular never turn on `allowAdminCommands` on your own: tell the user to do it.

## variables

`{ "NAME": "value" }`, names with letters, digits, `_`. Use `${NAME}` in scripts, labels, icon paths, `cwd`, `env` values, `confirm` and `notify` texts. Values may use other variables. Built in: `${env:NAME}` (environment variable, empty if unset) and `${configDir}` (folder of the configuration file). Unknown `${…}` are left untouched, so `${HOME}` still reaches bash.

## trays (array, display order)

| Property | Type | Meaning |
| --- | --- | --- |
| `id` | string | **Required.** Unique in the whole file. Letters, digits, `_`, `-`, `.`. |
| `label` | string | **Required.** Tooltip. |
| `icon` | string | Image file (png, ico, jpg), relative to the config folder. Default: TrayCommand logo. |
| `hidden` | boolean | Not shown, kept in the file. Checks paused. |
| `disabled` | boolean | Not clickable (click opens the menu). Checks paused. |
| `enabledWhen` | string | Clickable only while entry `id` is ON (`"id"`) or OFF (`"!id"`). |
| `action` | action | Left click (click while OFF for toggles). Without it left click opens the menu. |
| `offAction` | action | Toggles only: click while ON. |
| `rightAction` | action | Right click. Without it right click opens the menu. |
| `state` | state | Makes it a toggle. |
| `hotkey` | shortcut | Global keyboard shortcut = click. Without `action`: opens the launcher on the menu. |
| `schedules` | array of schedule | Automatic runs. |
| `menu` | array of entries / separators | The menu. |

## menu entries

Same properties as a tray except: `id` optional (needed only when referenced), no `rightAction`, `label` is the menu text, `menu` makes a sub menu (any depth). An entry with neither `action` nor `menu` is a greyed-out title. An entry with both `action` and `menu` gets **Run** / **Turn off** at the top of its sub menu. A toggle entry without an icon shows a check mark.

Separator: `{ "separator": true }` (leading, trailing and repeated separators are dropped).

## action

A string (the script) or an object:

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `run` | string | — | **Required.** The script; multi-line with `\n`. |
| `shell` | shell | `settings.shell` | Shell for this action. |
| `cwd` | string | config folder | Working directory (relative to the config folder). |
| `env` | object | — | Extra environment variables. |
| `timeout` | integer | none | Kill after N seconds (reported as an error). |
| `notify` | boolean \| string | `false` | Notification on success (`true` = "Done"). Errors are always notified. |
| `confirm` | string | — | Ask Run/Cancel with this text first. |
| `terminal` | boolean | `false` | Run in a visible terminal that stays open. |
| `admin` | boolean | `false` | Run elevated (UAC prompt each time). Needs `settings.allowAdminCommands`. |
| `before` | refs | — | Actions of other entries to run first, in order. |
| `parallel` | refs | — | Actions of other entries to run at the same time. |
| `after` | refs | — | Actions of other entries to run afterwards, in order. |
| `inputs` | array of input | — | Values asked in a form before running (see below). |

A ref is `"id"` (same kind: on→on, off→off, right→on), `"id:on"`, `"id:off"` or `"id:right"`. Unknown ids are errors. Success = exit code 0 within the timeout. While an action runs the entry is busy and cannot be clicked again.

## state

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `check` | string | — | **Required.** Script that reports the state. |
| `shell` | shell | `settings.shell` | Shell for the check. |
| `on` | string | — | Regex: output matching means ON. |
| `off` | string | — | Regex: output matching means OFF (tested first). |
| `interval` | integer ≥ 2 | `60` | Seconds between checks. |
| `iconOff` | string | — | Icon while OFF (`icon` is used while ON). |
| `notify` | `{ "on"?, "off"? }` | — | Notification when it turns ON / OFF (`true` or a text). |

Evaluation: exit code ≠ 0 → OFF; output matches `off` → OFF; `on` set → ON if output matches, else OFF; otherwise ON. Regexes are JavaScript, multi-line (`^`/`$` per line). A check is killed after `max(interval, 30)` s. The state is re-checked right after the entry's action. No `admin` for checks.

## inputs (of an action)

Asked in a small keyboard-driven form before the action runs (from a click, the launcher, a shortcut, `--run`). Each value is `${NAME}` in `run` / `cwd` / `env` / `confirm` / `notify` **and** an environment variable `NAME` (prefer `$env:NAME` / `"$NAME"` in scripts for free text: quotes or spaces in the value cannot break the script). Inputs of composed actions (`before` / `parallel` / `after`) are asked together, once per name.

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | **Required.** `[A-Za-z_][A-Za-z0-9_]*`, unique in the action. |
| `label` | string | name | Field label. |
| `type` | `"text"` \| `"password"` \| `"number"` \| `"select"` \| `"checkbox"` \| `"file"` \| `"folder"` | `"text"` | `checkbox` gives `"true"`/`"false"`; `password` is never stored and masked in logs. |
| `default` | string \| number \| boolean | — | Proposed the first time. |
| `placeholder` | string | — | Hint in the empty field. |
| `options` | array of string or `{ "value", "label"? }` | — | Choices of a `select`. |
| `optionsCommand` | string | — | Script whose output lines are the `select` choices (e.g. `git branch --format=%(refname:short)`). |
| `optional` | boolean | `false` | Allow empty. |
| `pattern` | string | — | Regex the whole value must match. |
| `remember` | boolean | `true` | Propose the last value used. |

A `select` needs `options` or `optionsCommand`.

## schedules (of a tray or entry)

Timers inside TrayCommand (no Task Scheduler / cron). Exactly one of `cron`, `every`, `startup` per schedule.

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cron` | string | — | 5 fields `minute hour day month weekday`, local time; `*`, `1-5`, `1,3`, `*/15`, names `MON-FRI`, macros `@daily` `@hourly` `@weekly` `@monthly` `@yearly` `@weekdays`. |
| `every` | string | — | `"30s"`, `"15m"`, `"2h"`, `"1d"`, `"1h30m"`; minimum 5 s; counted from app start. |
| `startup` | `true` | — | Once when TrayCommand starts. |
| `run` | `"click"` \| `"on"` \| `"off"` \| `"right"` | `"click"` | `"on"`/`"off"` turn a toggle on/off only when needed (`"off"` needs `offAction`, `"right"` needs `rightAction`). |
| `values` | object | — | Values for the action inputs. Scheduled runs never ask and skip `confirm`: required inputs need a value here or a `default`. |
| `disabled` | boolean | `false` | Keep without running. |

Schedules do not run while the entry (or a parent) is `disabled`; `hidden` entries still run. A run is skipped while the previous one is going. Missed runs (PC off/asleep) are not recovered.

## shortcuts (`hotkey`, `settings.launcherHotkey`)

Keys joined by `+`: modifiers `Ctrl`, `Alt`, `Shift`, `Win` (`Super`/`Meta`/`Cmd`), `CommandOrControl`; one key `A`-`Z`, `0`-`9`, `F1`-`F24`, `Space`, `Enter`, `Tab`, `Up`/`Down`/`Left`/`Right`, `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete`, `Esc`, `Plus`, punctuation, `num0`-`num9`. Needs `Ctrl`, `Alt` or `Win` unless the key is `F1`-`F24`. Each shortcut once in the file (launcher included). Avoid common system/app shortcuts (`Ctrl+C`, `Win+E`, `Alt+Tab`, `Ctrl+Alt+Del`…); prefer `Ctrl+Alt+<letter>` or `Ctrl+Alt+Shift+<letter>`.

## shell

`"powershell"` (Windows PowerShell 5.1, `-NoProfile -NonInteractive -ExecutionPolicy Bypass`, UTF-8), `"pwsh"` (PowerShell 7), `"cmd"` (`cmd.exe /d /s /c`), `"bash"` / `"zsh"` (login shell, `-lc`), `"sh"` (`sh -c`), or `{ "command": "exe", "args": ["-c"] }`.

## Checks done by the validator

Unique ids; every ref in `before` / `parallel` / `after` / `enabledWhen` exists; `on` / `off` / `pattern` are valid regexes; `settings.appMenu` is `"own"` or a tray id; shortcuts valid and unique; input names unique per action, `select` with choices; schedules with exactly one of `cron`/`every`/`startup`, valid expression, something to run. Warnings: `offAction` without `state`; schedule `values` for unknown inputs.
