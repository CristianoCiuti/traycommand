# Command line and data folder

## Command line options

```powershell
TrayCommand.exe [--hidden] [--config=<file>] [--data-dir=<dir>]
```

| Option | Description |
| --- | --- |
| `--hidden` | Start in the tray without opening the editor window (used by start at login). On the very first start the window is shown anyway. |
| `--config=<file>` | Use this configuration file. Takes precedence over everything else and is kept when TrayCommand relaunches itself (updates, start at login). |
| `--data-dir=<dir>` | Use another [data folder](#data-folder) (state, logs, backups). With this option start at login is never changed, which makes it handy for test copies. |

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

They honour `--config`, `TRAYCOMMAND_CONFIG` and `--data-dir` like a normal start.

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
