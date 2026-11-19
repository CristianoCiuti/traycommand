# Migrating from 1.x

TrayCommand 2.0 is a complete rewrite with a new configuration format. **There is no backward compatibility**: a 1.x `tray-command.json` is not read by 2.0. A conversion script does the work for you.

## What changed

| 1.x | 2.0 |
| --- | --- |
| `subMenu` | `menu` |
| `command` | `action` (a string, or an object with `run`) |
| `turnOffCommand` | `offAction` |
| `rightCommand` | `rightAction` (trays only) |
| `checkCommand` | `state` with `check` |
| `stateOnOutput` | `state.on` (regular expression) |
| `stateOffOutput` | `state.off` (regular expression) |
| `checkIntervalMs` (milliseconds) | `state.interval` (**seconds**, minimum 2) |
| `iconOff` on the entry | `state.iconOff` |
| `stateOnMessage` / `stateOffMessage` | `state.notify.on` / `state.notify.off` |
| `message` | `notify` |
| `simultaneous` | `parallel` |
| References `{ "id": "x", "type": "run" }` / `"stop"` / `"right"` | `"x"` (same kind), `"x:on"`, `"x:off"`, `"x:right"` |
| `"enabled": false` | `"disabled": true` |
| `"enabled": "check x"` | `"enabledWhen": "x"` |
| `icon: { "path": "...", "relative": true }` | `"icon": "icons/x.png"`: a plain path, relative to the **configuration file** folder |
| `§APP§` | `${configDir}` |
| `settings.misc.*` | `settings.*` (`autostart`, `theme`, `notifyOnStartup`…) |
| `settings.shell.shell` | `settings.shell` |
| The `"default"` tray | The built-in [TrayCommand menu](./getting-started#the-traycommand-menu) |
| — | `"version": 2`, `variables`, `hidden`, `confirm`, `timeout`, `terminal`, `admin` |

Not carried over: references to another entry's state check, composed state checks, right click on menu items, `iconSize`. The script prints a warning for each one it drops.

## Convert your file

The script is in the repository. From a clone (Node.js 22 or newer):

```powershell
git clone https://github.com/CristianoCiuti/traycommand.git
cd traycommand
node scripts/convert-v1.mjs old.json new.json "path\to\old\TrayCommand.exe"
```

- `old.json`: your 1.x `tray-command.json`.
- `new.json`: the file to create. Put it where you want to keep it (it can be the final location, for example a synced folder).
- The third argument is the 1.x executable: 1.x relative icon paths were relative to it. The script rewrites them relative to `new.json`. When omitted, `TrayCommand.exe` next to `old.json` is assumed.

The output lists the trays written and any warnings. The `"default"` tray is dropped if it only contained "Edit config file"; otherwise it is kept and becomes the tray hosting the TrayCommand menu (`settings.appMenu`).

## Use the new file

1. Start TrayCommand 2.0.
2. **Settings → Configuration file → Use another file…** and pick `new.json`.
3. Check the trays on the **Trays** page; use the **Test** buttons on toggles to verify the state patterns (they are now regular expressions).

Optionally copy your icons next to the new file and switch to relative paths.

## Remove the 1.x autostart

TrayCommand 2.0 does not touch what 1.x created. If 1.x started at login, remove it by hand, otherwise both versions start:

- a 1.x shortcut in the Startup folder (<kbd>Win</kbd>+<kbd>R</kbd> → `shell:startup`), and/or
- a 1.x scheduled task (open **Task Scheduler** and delete it).

Then enable [Start at login](./startup-and-updates#start-at-login) in 2.0.
