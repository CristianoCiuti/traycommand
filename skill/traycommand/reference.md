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
| `skillUpdates` | `"auto"` \| `"ask"` | `"auto"` | Update this AI skill automatically or ask first. |

Do not change settings unless the user asks (except `allowAdminCommands`, and only after telling them).

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

## shell

`"powershell"` (Windows PowerShell 5.1, `-NoProfile -NonInteractive -ExecutionPolicy Bypass`, UTF-8), `"pwsh"` (PowerShell 7), `"cmd"` (`cmd.exe /d /s /c`), `"bash"` / `"zsh"` (login shell, `-lc`), `"sh"` (`sh -c`), or `{ "command": "exe", "args": ["-c"] }`.

## Checks done by the validator

Unique ids; every ref in `before` / `parallel` / `after` / `enabledWhen` exists; `on` / `off` are valid regexes; `settings.appMenu` is `"own"` or a tray id. `offAction` without `state` is a warning.
