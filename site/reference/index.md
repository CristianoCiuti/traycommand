# Configuration reference

The configuration is one JSON file (by default `traycommand.json` in the [data folder](./cli#data-folder)). The editor writes it for you; this page describes every property.

## Structure

```json
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "settings": {},
  "variables": {},
  "trays": []
}
```

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `$schema` | string | no | URL of the JSON Schema, for autocompletion in editors. |
| `version` | `2` | **yes** | Format version. Must be `2`. |
| `settings` | object | no | [Settings](#settings). |
| `variables` | object | no | [Variables](#variables). |
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
| `theme` | `"system"` \| `"light"` \| `"dark"` | `"system"` | Theme of the editor window. |
| `appMenu` | string | `"own"` | `"own"`: TrayCommand has its own tray icon. Otherwise the `id` of a tray whose menu gets a **TrayCommand** sub menu (open, settings, quit…). If that tray is hidden, the TrayCommand icon comes back. |
| `notifyOnStartup` | boolean | `false` | Show a notification when TrayCommand starts hidden. |
| `checkUpdates` | boolean | `true` | Check GitHub releases every 6 hours. See [updates](../guide/startup-and-updates#updates). |
| `autostart` | boolean | `false` | Start TrayCommand when you log in. See [start at login](../guide/startup-and-updates#start-at-login). |
| `allowAdminCommands` | boolean | `false` | Allow actions with `"admin": true` (prompt on each run). See [administrator](../guide/administrator). |

## Variables

```json
"variables": {
  "WS": "C:/work/workspaces",
  "TOOLS": "${configDir}/tools"
}
```

An object of `NAME: value`. Names use letters, digits and `_`. Write `${NAME}` in scripts, labels, icon paths, `cwd`, `env` values, `confirm` and `notify` texts.

| Syntax | Value |
| --- | --- |
| `${NAME}` | The variable `NAME`. It can contain other variables. |
| `${env:NAME}` | The environment variable `NAME` (empty when not set). |
| `${configDir}` | Folder of the configuration file. |

Unknown names are left untouched, so `${HOME}` in a bash script still reaches the shell.

## Trays

Each item of `trays` is one tray icon.

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | **Required.** Unique identifier (letters, digits, `_`, `-`, `.`). |
| `label` | string | **Required.** Tooltip text. |
| `icon` | string | Image file (png, ico, jpg). Relative paths are resolved from the configuration file folder. Without it the TrayCommand icon is used. |
| `hidden` | boolean | Hide without deleting. State checks are paused. |
| `disabled` | boolean | Not clickable (click opens the menu); state checks are paused. |
| `enabledWhen` | string | Clickable only while the entry with this id is ON (`"id"`) or OFF (`"!id"`). |
| `action` | [action](#actions) | Run on left click (on click while OFF, for toggles). Without it, left click opens the menu. |
| `offAction` | [action](#actions) | Toggles only: run on click while ON. |
| `rightAction` | [action](#actions) | Run on right click. Without it, right click opens the menu. |
| `state` | [state](#state) | Makes the tray a toggle. |
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
| `enabledWhen` | string | `"id"` or `"!id"`, see above. |
| `action` | [action](#actions) | Run on click. |
| `offAction` | [action](#actions) | Toggles only: run on click while ON. |
| `state` | [state](#state) | Makes the entry a toggle (check mark when it has no icon). |
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
| `notify` | boolean \| string | `false` | Notification on success: `false` none, `true` "Done", a string = custom text. Errors are always notified. |
| `confirm` | string | — | Ask for confirmation with this text before running (**Run** / **Cancel**). |
| `terminal` | boolean | `false` | Run in a visible terminal window that stays open. |
| `admin` | boolean | `false` | Run as administrator (prompt on every run). Requires `settings.allowAdminCommands`. See [administrator](../guide/administrator#run-as-administrator). |
| `before` | array of refs | — | Actions of other entries to run, one after the other, before this one. |
| `parallel` | array of refs | — | Actions of other entries to run together with this one. |
| `after` | array of refs | — | Actions of other entries to run, one after the other, after this one. |

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
| `notify` | `{ "on"?, "off"? }` | — | Notification when the state changes to ON / OFF: `true` default text, a string = custom text. |

Evaluation of each check:

1. exit code ≠ 0 → **OFF**;
2. output matches `off` → **OFF**;
3. `on` set → **ON** if the output matches it, otherwise **OFF**;
4. otherwise → **ON**.

Patterns are JavaScript regular expressions in multi-line mode (`^` and `$` match at each line). Remember to escape backslashes in JSON (`"\\d+"`). A check is stopped after `max(interval, 30)` seconds. The state is also checked again right after the entry's action runs. Checks are paused while the entry (or a parent) is hidden or disabled. `admin` is not available for checks.

## Shell

A preset name or a custom executable:

| Value | Description |
| --- | --- |
| `"powershell"` | Windows PowerShell, `-NoProfile -NonInteractive -ExecutionPolicy Bypass`, UTF-8 output. |
| `"pwsh"` | PowerShell 7, same options. |
| `"cmd"` | `cmd.exe /d /s /c`. |
| `"bash"`, `"zsh"` | Login shell (`-lc`). |
| `"sh"` | `sh -c`. |
| `{ "command": "…", "args": ["…"] }` | Custom: `command` is the executable, `args` go before the script (default `[]`). |

See [platforms](../guide/platforms#default-shell) for details.

## Validation

Besides the types above, TrayCommand checks that:

- every `id` is unique across all trays and entries;
- every reference in `before`, `parallel`, `after` and `enabledWhen` points to an existing id;
- `on` and `off` are valid regular expressions;
- `settings.appMenu` is `"own"` or the id of a tray.

`offAction` without `state` is accepted with a warning (it is never used).

## Complete example

```jsonc
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "settings": {
    "shell": "powershell",
    "theme": "system",
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
      // no action: a click opens the menu
      "id": "code",
      "label": "VS Code",
      "icon": "icons/code.png",
      "menu": [
        { "label": "Project A", "action": "code \"${WS}/a.code-workspace\"" },
        { "label": "Project B", "action": "code \"${WS}/b.code-workspace\"" }
      ]
    },
    // kept in the file, not shown
    { "id": "notes", "label": "Notes", "icon": "icons/note.png", "hidden": true, "action": "Start-Process notepad" }
  ]
}
```

::: warning Comments
The comments above are for explanation only. JSON does not allow comments: remove them in your file.
:::
