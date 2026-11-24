# Concepts

## Trays

A **tray** is one icon in the system tray. Each tray has an `id` (required), a `label` (the tooltip) and an `icon`. A tray can:

- run an **action** when clicked,
- run a different **right click** action (`rightAction`),
- open a **menu**,
- be a **toggle** with an ON/OFF state.

```json
{ "id": "terminal", "label": "Terminal", "icon": "icons/terminal.png", "action": "Start-Process wt" }
```

## Menu entries, sub menus and separators

A tray's `menu` is a list of entries. An entry has a `label` and usually an `action`; it can have its own `menu` (a sub menu, any depth) and its own `state`. A separator is `{ "separator": true }`.

```json
{
  "id": "tools",
  "label": "Tools",
  "icon": "icons/tools.png",
  "menu": [
    { "label": "Notepad", "action": "Start-Process notepad" },
    { "label": "Calculator", "action": "Start-Process calc" },
    { "separator": true },
    {
      "label": "Folders",
      "menu": [
        { "label": "Downloads", "action": "Start-Process \"$env:USERPROFILE\\Downloads\"" },
        { "label": "Temp", "action": "Start-Process $env:TEMP" }
      ]
    }
  ]
}
```

Menu entries need an `id` only when something else refers to them (composed actions, `enabledWhen`). If an entry has both a sub menu and an action, the sub menu starts with a **Run** (or **Turn off**) item.

## Actions

An action is a script run by a shell. The short form is just the script:

```json
"action": "Start-Process notepad"
```

The long form adds options:

```json
"action": {
  "run": "npm run build",
  "shell": "cmd",
  "cwd": "projects/web",
  "env": { "NODE_ENV": "production" },
  "timeout": 300,
  "notify": "Build finished",
  "confirm": "Rebuild the site?",
  "terminal": false
}
```

The shell is PowerShell on Windows and your login shell (`$SHELL`, otherwise bash) elsewhere, unless you change `settings.shell` or set `shell` on the action. Errors (exit code ≠ 0, timeout) are always notified; success only when `notify` is set. Every run is recorded on the [Activity page](./editor#activity).

### Clicking a notification

A notification can run another entry when it is clicked. Give `notify` a `click` with the id of the entry (`"id"` does what a click on it does, `"id:on"`, `"id:off"` or `"id:right"` choose), and `notifyError` for failures:

```json
"action": {
  "run": "logon.cmd",
  "shell": "cmd",
  "notify": { "text": "VDI ready: click to show it", "click": "vdi:on" },
  "notifyError": { "click": "vdi_logs" }
}
```

A failure notification shows `Failed: <reason>` (or `notifyError.text`) and the last 3 lines of the output, so a script that prints the reason last is explained in the notification itself. Without `notifyError.click`, clicking a failure opens the activity log. In the editor: **Options** of the action, **Clicking the notification runs** and **Clicking an error notification runs**.

All options are listed in the [reference](../reference/#actions).

## Toggles (state)

Adding a `state` turns an entry into a **toggle**. TrayCommand runs the `check` script every `interval` seconds and decides ON or OFF:

1. Exit code ≠ 0 → **OFF**.
2. Output matches the `off` regular expression → **OFF** (tested first).
3. `on` is set → **ON** only if the output matches it, otherwise **OFF**.
4. No patterns → **ON**.

A toggle runs `action` when clicked while OFF and `offAction` when clicked while ON. After an action, the state is checked again (700 ms later by default).

### Faster check marks

By default the check mark (or the ON/OFF icon) changes only when the check after the action has run. Two options of `state` make it quicker:

- `"optimistic": true` shows the new state as soon as the action succeeds: ON after `action`, OFF after `offAction`. The check still runs and corrects it if the action did not really change anything. Use it when the actions are fast and reliable (a flag file, a setting); it needs both `action` and `offAction`.
- `"recheckDelay"` is how many milliseconds to wait before that check: `0` checks at once, a few hundred when the real state takes a moment to follow (a service starting, an agent that writes a value).

```json
"state": { "check": "if exist \"%TEMP%\\quiet.flag\" (echo yes) else (echo no)", "shell": "cmd", "on": "^yes$", "optimistic": true, "recheckDelay": 0 }
```

In the editor: **Show the new state at once** and **Check after an action (ms)**.

```json
{
  "id": "vpn",
  "label": "VPN",
  "icon": "icons/vpn_on.png",
  "state": {
    "check": "(Get-VpnConnection -Name Office).ConnectionStatus",
    "on": "^Connected",
    "interval": 10,
    "iconOff": "icons/vpn_off.png",
    "notify": { "on": "VPN connected", "off": "VPN disconnected" }
  },
  "action": "rasdial Office",
  "offAction": "rasdial Office /disconnect"
}
```

The tray icon switches between `icon` (ON) and `state.iconOff` (OFF). In menus, a toggle without an icon is shown with a check mark.

::: tip
Use the **Test** button of the state check in the editor: it shows the output and the ON/OFF result computed with your patterns.
:::

## Right click

`rightAction` (trays only) runs on right click. Without it, right click opens the menu. On Linux it appears as an extra menu item, see [platforms](./platforms).

## Hidden vs disabled

| | `hidden: true` | `disabled: true` |
| --- | --- | --- |
| Shown | No | Yes, greyed out |
| Clickable | — | No |
| State checks | Paused | Paused |
| Applies to children | Yes | Yes |

Both keep the entry in the file, so you can bring it back later. Hidden trays can also be shown again from **Show trays** in the TrayCommand menu.

## Enabled when

`enabledWhen` makes an entry clickable only while another toggle is ON (`"id"`) or OFF (`"!id"`):

```json
{ "label": "Stop server", "enabledWhen": "server", "action": "nginx -s stop" }
```

An entry is also not clickable while its own action is still running.

## Composing actions

Every action can run the actions of other entries with `before`, `parallel` and `after`. Each item is a reference:

| Reference | Runs |
| --- | --- |
| `"id"` | The same kind of action of entry `id`: from an `action`, its `action`; from an `offAction`, its `offAction`. From a `rightAction` it runs `action`. |
| `"id:on"` | The `action` of `id`. |
| `"id:off"` | The `offAction` of `id`. |
| `"id:right"` | The `rightAction` of `id`. |

Order: `before` (one after the other) → own script together with all `parallel` → `after` (one after the other). Loops are detected and skipped.

Example: a **Proxy** toggle that also switches the Git and npm proxy toggles in its menu, at the same time:

```json
{
  "id": "proxy",
  "label": "Proxy",
  "state": { "check": "...", "on": "1" },
  "action": { "run": "...turn on...", "parallel": ["git_proxy", "npm_proxy"] },
  "offAction": { "run": "...turn off...", "parallel": ["git_proxy", "npm_proxy"] },
  "menu": [
    { "id": "git_proxy", "label": "Git proxy", "state": { "check": "..." }, "action": "...", "offAction": "..." },
    { "id": "npm_proxy", "label": "npm proxy", "state": { "check": "..." }, "action": "...", "offAction": "..." }
  ]
}
```

Turning **Proxy** on runs the `action` of both children; turning it off runs their `offAction`. The complete version is in the [recipes](../recipes/#system-proxy-with-git-and-npm).

## Variables

Define values once in `variables` and use them as `${NAME}` in scripts, labels, icons, paths, `env`, `confirm` and `notify` texts:

```json
"variables": { "WS": "C:/work/workspaces", "EDITOR": "code" }
```

```json
{ "label": "Web app", "action": "${EDITOR} \"${WS}/web.code-workspace\"" }
```

Built in:

| Variable | Value |
| --- | --- |
| `${env:NAME}` | The environment variable `NAME` (empty if not set). |
| `${configDir}` | The folder of the configuration file. |

Variables can use other variables. Unknown names are left as they are, so shell syntax like `${HOME}` in a bash script still works.

Every tray sees the same variables; the values an action asks (and the file of a folder watch) come first inside that action. Passwords and tokens go in **secrets**: used the same way, but kept encrypted on this PC instead of in the file. The **Variables** page of the editor lists them, shows where each one is used and renames it there too; while you edit a text, the variables it can use are offered as chips. See [variables and secrets](./variables).

## Values asked before running

An action can ask for values in a small form before it runs (`inputs`): text, choices (also produced by a script), yes/no, files, folders, passwords. They are used as `${NAME}` and as environment variables. See [asking for values](./inputs).

## Shortcuts, launcher and schedules

- Any entry can have a global keyboard **shortcut** (`hotkey`), and the **launcher** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd>) runs any entry by typing part of its name. See [launcher and shortcuts](./launcher).
- **Schedules** run an entry at set times, at an interval, when TrayCommand starts or when files appear in a folder, optionally only in a time window. See [schedules](./schedules).

Hidden entries can still be run from the launcher, their shortcut and their schedules; disabled entries cannot.

## Relative paths

`icon`, `state.iconOff` and `cwd` can be relative: they are resolved from the **folder of the configuration file**. Scripts run in that folder too, unless `cwd` says otherwise. Keep icons next to the configuration file and the whole folder can move or sync between PCs.

## How a click is decided

| Entry has | Left click | Right click (trays) |
| --- | --- | --- |
| `action`, no `state` | Runs `action` | `rightAction`, else opens the menu |
| `state` and is OFF | Runs `action` | `rightAction`, else opens the menu |
| `state` and is ON, with `offAction` | Runs `offAction` | `rightAction`, else opens the menu |
| `state` and is ON, no `offAction` | Runs `action` | `rightAction`, else opens the menu |
| No `action` | Opens the menu | `rightAction`, else opens the menu |
| Disabled, `enabledWhen` not met, or still running | Tray: opens the menu. Menu entry: greyed out | Opens the menu |

Clicking an entry whose action is still running shows a "still running" notification instead of starting it twice.
