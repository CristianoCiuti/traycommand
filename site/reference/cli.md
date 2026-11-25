# Command line and data folder

## Command line options

```powershell
TrayCommand.exe [--hidden] [--config=<file>] [--data-dir=<dir>] [--launcher] [--run=<id>]
```

| Option | Description |
| --- | --- |
| `--hidden` | Start in the tray without opening the editor window (used by start at login). On the very first start the window is shown anyway. |
| `--config=<file>` | Use this configuration file. Takes precedence over everything else and is kept when TrayCommand relaunches itself (updates, start at login). |
| `--data-dir=<dir>` | Use another [data folder](#data-folder) (state, logs, backups). With this option start at login is never changed, which makes it handy for test copies. |
| `--launcher` | Open the [launcher](../guide/launcher). When TrayCommand is already running, the running copy opens it (and nothing else starts). |
| `--run=<id>` | Run the entry with this id, like a click (a form opens if it [asks for values](../guide/inputs); an entry with only a menu opens the launcher on it). Same behaviour when TrayCommand is already running. |

`--launcher` and `--run` let other tools start TrayCommand commands: a desktop shortcut, a key binding of your desktop environment (where global shortcuts are not available, such as Wayland), a Stream Deck button, another script.

Examples:

::: code-group
```powershell [Windows]
& "$env:LOCALAPPDATA\Programs\TrayCommand\TrayCommand.exe" --hidden --config="D:\Sync\traycommand.json"
```
```sh [Linux]
~/.local/share/TrayCommand/TrayCommand.AppImage --config="$HOME/Sync/traycommand.json"
```
```sh [macOS]
/Applications/TrayCommand.app/Contents/MacOS/TrayCommand --config="$HOME/Sync/traycommand.json"
```
:::

## Tools for scripts and AI agents

These options print JSON and exit at once, without starting TrayCommand (they work while it is running too).

| Option | Output | Exit code |
| --- | --- | --- |
| `--info` | `version`, `configPath`, `configDir`, `configExists`, `dataDir`, `backupsDir`, `platform`, `defaultShell`, `schema`, `docs` | 0 |
| `--validate` | Validates the configuration file in use: `{ "ok", "file", "issues": [{ "path", "message" }], "warnings" }` | 0 valid, 1 invalid |
| `--validate=<file>` | Same, for another file | 0 / 1 |
| `--update` | Checks for a new version: `{ "ok", "current", "latest", "available", "url", "notes" }` | 0, 1 when the check fails |
| `--update=install` | Checks, downloads, verifies the checksum and installs the new version; TrayCommand then starts (see [updates](../guide/startup-and-updates#updates)). Progress on stderr. | 0, 1 on failure |
| `--export=<file>` | Writes an export as **Export…** does: everything, or with `--entries=<id>,<id>` those entries (with their menus and schedules) and what they need. `.zip` or `.json` (a `.json` cannot carry icons). | 0 / 1 |
| `--import=<file>` | Shows what importing the file would do, as the **Import** window proposes it: `{ "applied": false, "counts", "entries": [{ "label", "id", "status", "decision", "newId" }], "variables", "settings", "issues", "warnings" }`. Nothing changes. | 0 / 1 |
| `--import=<file> --apply` | Imports it with the proposed choices and saves (a [backup](../guide/startup-and-updates#backups) is kept). | 0 / 1 |

They honour `--config`, `TRAYCOMMAND_CONFIG` and `--data-dir` like a normal start.

`--update=install` with TrayCommand running: the running copy downloads and installs the update itself and restarts; with unsaved changes in the editor it asks first. Without TrayCommand running, the command installs the update once it ends, then starts TrayCommand. Development builds never install updates.

`--import --apply` with TrayCommand running: the running copy sees the changed file and applies it within a few seconds, as for any change of the file.

```powershell
TrayCommand.exe --export="D:\share\vdi.zip" --entries=vdi_open | Out-String
TrayCommand.exe --import="D:\share\vdi.zip" | Out-String          # what would change
TrayCommand.exe --import="D:\share\vdi.zip" --apply | Out-String  # import it
TrayCommand.exe --update=install | Out-String
```

::: tip PowerShell
TrayCommand is a windowed app: PowerShell waits for it and shows its output only when the output is piped.
```powershell
& "$env:LOCALAPPDATA\Programs\TrayCommand\TrayCommand.exe" --validate | Out-String
```
:::

## Environment variable

| Variable | Description |
| --- | --- |
| `TRAYCOMMAND_CONFIG` | Path of the configuration file. Used when `--config` is not given; takes precedence over the file chosen in Settings. |

Order used to find the configuration file:

1. `--config=<file>`
2. `TRAYCOMMAND_CONFIG`
3. the file chosen in **Settings → Configuration file** (stored in `state.json`)
4. `traycommand.json` in the data folder

Relative paths are resolved from the current directory.

## Data folder

| System | Default location |
| --- | --- |
| Windows | `%APPDATA%\TrayCommand` |
| Linux | `~/.config/TrayCommand` |
| macOS | `~/Library/Application Support/TrayCommand` |

Open it from **Settings → Advanced → Data folder**. It contains:

| Path | Content |
| --- | --- |
| `traycommand.json` | The default configuration file (if you did not choose another one). |
| `state.json` | Settings of this PC only: chosen configuration file, window position, last version, administrator start mode. Not meant to be shared. |
| `logs/executions.jsonl` | Activity history, one JSON object per line (time, entry, script, exit code, duration, output trimmed to 8000 characters). Rotated to `executions.jsonl.1` above 2 MB. |
| `backups/` | `traycommand-<date-time>.json` copies made before each save; the newest 30 are kept. |
| `update/` | Temporary files of the last update (download, checksum, helper script). Safe to delete. |
| `update-result.json` | Written by the update helper, read and removed at the next start. |

The data folder also contains Electron's own cache folders.

## Single instance

Only one TrayCommand runs per user. Starting it again (from the Start menu, for example) opens the editor of the running instance instead of starting a second one.

## Exit behaviour

- Closing the editor window does **not** quit TrayCommand: it keeps running in the tray.
- **Quit TrayCommand** in the TrayCommand menu removes all icons, stops the state checks and exits.
- Installing an update quits TrayCommand and relaunches it with `--hidden` and the same `--config` option.
