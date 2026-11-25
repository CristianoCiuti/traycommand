---
name: traycommand
description: Create, change, hide or remove TrayCommand tray icons and menus. TrayCommand runs shell commands from system tray icons (toggles with a live ON/OFF state, menus, sub menus), with global keyboard shortcuts, a keyboard launcher, forms that ask for values before running, schedules (times, intervals, startup, folder watches, time windows, a check that must pass, an alert with choices first), four looks and export/import. Use when the user asks for a new tray icon or menu entry that does something ("make me a tray that…", "add to the tray a command that…"), a keyboard shortcut for a command, a command that asks for a value, a command that runs at set times or when files appear in a folder, only if something is true, or after asking them, wants to change, hide, reorder or delete existing trays, share or bring in trays, change the look, or mentions TrayCommand or traycommand.json.
---

# TrayCommand

TrayCommand is a desktop app that shows one or more icons in the system tray. Each icon (a **tray**) and each entry of its menu runs a shell script on click. An entry with a `state` is a **toggle**: a check script runs periodically and decides whether it is ON or OFF, and the icon or check mark follows it.

Everything is defined in **one JSON file**. The running app watches this file and applies changes as soon as it is saved: there is nothing to restart. Your job is to edit that file correctly.

- Full field reference: [reference.md](reference.md) (read it before writing anything non-trivial).
- Ready-made patterns: [examples.md](examples.md). **Check it first**: many requests (launchers, services, processes, Docker, proxies, registry settings) have a pattern to adapt.
- Online documentation: https://cristianociuti.github.io/traycommand/

## 1. Find the configuration file

Ask TrayCommand itself; never guess the path:

```bash
{{TRAYCOMMAND_SH}} --info
```

```powershell
{{TRAYCOMMAND_PS}} --info | Out-String
```

(In PowerShell keep `| Out-String`: without a pipe PowerShell does not wait for the app and shows no output.)

It prints JSON with `version`, `configPath`, `configDir`, `configExists`, `dataDir`, `backupsDir`, `platform`, `defaultShell`, `schema`, `docs`:

- `configPath` is the file to edit. Relative paths inside it (icons, `cwd`) are resolved from `configDir`.
- `configExists: false` means there is no configuration yet: create `configPath` with `{"$schema": "<schema>", "version": 2, "trays": []}` and add to it.
- `backupsDir` is where to put the backup copy (step 4).
- `defaultShell` is the shell used by scripts that do not choose one (`powershell` on Windows unless `settings.shell` says otherwise).

The file it reports follows the user's choice: `--config=<file>` on TrayCommand's command line, else the `TRAYCOMMAND_CONFIG` environment variable, else the file chosen in TrayCommand's settings, else `traycommand.json` in the data folder. If the command does not run (TrayCommand moved or was uninstalled), the data folder is `%APPDATA%\TrayCommand` (Windows), `~/.config/TrayCommand` (Linux) or `~/Library/Application Support/TrayCommand` (macOS): its `state.json` has `configPath`, otherwise the file is `traycommand.json` there. Tell the user TrayCommand was not found.

## 2. Understand the request

Turn "a tray that does X" into concrete choices. Ask the user only what you cannot decide sensibly:

- **New tray icon or entry in an existing menu?** Several related commands usually belong in the menu of one tray rather than in many icons. Look at the existing trays first.
- **Plain action or toggle?** If X has an ON/OFF nature (a service, a proxy, a VPN, a container, a setting), make a toggle: `state.check` + `action` (turn on) + `offAction` (turn off). Otherwise a plain `action`.
- **Clicks**: on a tray, left click runs `action` (`offAction` while ON) and right click opens `menu`; without `action`, both clicks open the menu; `rightAction` replaces the menu on right click. So a toggle tray can also have a menu of related commands.
- **Script**: write it for the shell that will run it (`defaultShell` or an explicit `shell`). On Windows the default is Windows PowerShell 5.1 (not PowerShell 7: no `&&`, no `??`, no ternary).
- **Visible or hidden?** Scripts run hidden. Long-running or interactive commands whose output the user wants to see need `"terminal": true`. GUI programs should be launched without waiting (`Start-Process` on Windows, `… &` / `nohup` / `open` elsewhere), otherwise the entry stays busy.
- **Needs administrator?** (services, Program Files, HKLM, system files…) Use `"admin": true` on the action (one UAC prompt per click). Such actions run only when `settings.allowAdminCommands` is `true`: if it is off, **do not turn it on yourself** unless the user explicitly asks; tell them to enable **Settings → Advanced → Allow commands as administrator** (`--validate` warns about it). State checks cannot be admin: choose a check that works without elevation.
- **Needs a value each time?** (a branch, an environment, a file, a ticket key) Add `inputs` to the action instead of hard-coding it or creating many entries: a form asks it before running, the last value is proposed again. Use `type: "select"` with `options` (or `optionsCommand` to compute the choices), `checkbox`, `file`, `folder`, `password` as fits. In the script prefer the environment variable (`$env:NAME`, `"$NAME"`) for free text.
- **Keyboard shortcut?** Only when asked: `"hotkey": "Ctrl+Alt+<letter>"` on the entry (a click from anywhere; on a tray with only a menu it opens the launcher on that menu). Check the file for shortcuts already used, launcher included (`settings.launcherHotkey`, default `Ctrl+Alt+Space`). Remind the user that every entry is also reachable from the launcher without a shortcut. For a destructive command, `"hotkeyConfirm": true` (or `{ "text", "button" }`) asks before the shortcut runs it.
- **At set times / periodically / at startup / when files arrive in a folder?** Use `schedules` (`cron`, `every`, `startup`, `watch`), never the Windows Task Scheduler, crontab, or a polling script. Limit to hours or days with `between` / `days`; run only if a command succeeds with `if`; ask the user first (a window over the others or a notification, with up to 4 buttons) with `alert`; a notification whose click runs one button directly: `"style": "notification"` + `"click": "<label>"`. For toggles use `"run": "on"` / `"off"`. Scheduled runs never ask: give `values` for required inputs. A watch passes the file in `TC_FILE` (env var).
- **Steps that depend on each other?** Put the next steps in `after`. If a step must run only when the script worked (or failed, or ended with a given exit code), write `{ "run": "<id>", "when": "success" }` / `"failed"` / `{ "run": "<id>", "exitCodes": [3] }` instead of a plain ref, and make the script exit with the right code (an exit code routed with `exitCodes` is not reported as an error). Do not chain steps inside one script just to test a result. A status line at the top of a menu = an entry with `state` (and `state.labelOff` for the OFF text) and no `action`. The entry stays running until the whole chain ends.
- **Feedback**: `"notify": "text"` for actions whose effect is not visible; `"confirm": "question?"` for destructive ones (`{ "text": "…", "button": "Restart" }` to name the button; it asks in a TrayCommand window, Enter runs, Esc cancels); `"timeout"` (seconds) for anything that could hang: 30–120 for services and network calls, more for builds and downloads.
- **Share, copy to another PC, bring in trays from a file?** Use TrayCommand's own export and import (run TrayCommand as in step 1, with these options; in PowerShell keep `| Out-String`), never build or merge export files by hand:
  - export: `--export=<file.zip> [--entries=<id>,<id>]` (everything, or those entries with what they need; icons included);
  - import: first `--import=<file>` (a dry run: it prints what each entry would become, new / identical / conflict → add / skip / replace / merge / rename, and which variables and settings come along), show it to the user, then `--import=<file> --apply` only with their OK. It keeps a backup and a running TrayCommand reloads the file. To choose item by item (keep both, untick something), point them to **Settings → Configuration file → Import…** in TrayCommand.
- **Update TrayCommand?** `--update` tells whether a new version exists (`available`, `latest`, `notes`); `--update=install` installs it (TrayCommand restarts). Install only when the user asks.
- **Where**: a new tray goes at the end of `trays` (after hidden ones too); a new menu entry goes next to related entries, otherwise at the end of the menu (before any trailing separator). Respect the order the user asks for.

## 3. Test the scripts before saving

Run the check script and, when it is safe and the user agrees, the action scripts yourself, with the same shell TrayCommand will use. Make sure that:

- the state check exits 0 and its output matches `on` (or does not match `off`) exactly when the thing is ON, and is fast (it runs every `interval` seconds);
- the action exits 0 on success (exit code ≠ 0 is reported to the user as an error).

For PowerShell use `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "<script>"` to reproduce the TrayCommand environment.

**PowerShell exit codes**: a failing cmdlet usually does *not* make the script exit with a non-zero code (non-terminating error). For checks and actions that must fail visibly, add `-ErrorAction Stop` to the cmdlet (an uncaught terminating error exits 1), or end with an explicit `exit 1`. A check like `(Get-Service X).Status` with `"on": "^Running$"` is fine without it, because a failure prints no `Running`.

**cmd output**: `echo on` and `echo off` print nothing in cmd (they toggle command echoing). In a cmd state check print other words (`echo yes` / `echo no`) or use `echo.on` / `echo.off`; `exit /b 1` makes it fail.

Never run actions that change the system (admin actions, stopping services, deleting files…) just to test them; if you cannot test something, say so in the report. Tested or not, check that the commands, names and paths exist (`Get-Command`, `Get-Service`, `Test-Path`, `which`).

## 4. Edit the file

1. Read the whole file. Files are UTF-8: in Windows PowerShell use `Get-Content -Raw -Encoding UTF8` and write with `-Encoding UTF8` (the default encoding of PowerShell 5.1 garbles non-ASCII characters).
2. Make a backup copy first (create `backupsDir` if it does not exist): `<backupsDir>/traycommand-<yyyyMMdd-HHmmss>-agent.json` (TrayCommand lists it under **Settings → Backups**).
3. Change only what was asked. Keep everything else as it is: other trays, `settings`, `variables`, order, `$schema`, the `"version": 2` line. Keep 2-space indentation.
4. Rules that are easy to get wrong:
   - every `id` must be unique in the whole file; trays need an `id`, menu entries only if referenced; use short `snake_case` ids;
   - JSON strings need `\\` for one backslash and `\"` for a quote; forward slashes (`C:/tools`) work on Windows too and avoid escaping;
   - `on` / `off` are JavaScript regular expressions in a JSON string (`"\\d+"`);
   - unknown properties are errors (no comments in the file);
   - reuse existing `variables` (`${NAME}`), or add one when a path repeats; `${env:NAME}` and `${configDir}` are built in.
   - passwords, tokens, API keys: never in the file. Add the name to `secrets`, use `${NAME}` (best through the action `env`), and tell the user to type the value in TrayCommand → Variables.
5. Icons: `icon` (and `iconOff` for toggles) are image files (png, ico), relative to `configDir`, usually in `<configDir>/icons/`. Reuse icons already there when they fit. To create new ones on Windows use [scripts/make-icon.ps1](scripts/make-icon.ps1): a coloured square with a white pictogram (`-Glyph`) or up to 3 letters (`-Text`, letters and digits only: emoji render as a box):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<this skill folder>/scripts/make-icon.ps1" -Glyph print -Color "#2e7d32" -Out "<configDir>/icons/printer_on.png"
   powershell -NoProfile -ExecutionPolicy Bypass -File "<this skill folder>/scripts/make-icon.ps1" -Glyph print -Color "#9e9e9e" -Out "<configDir>/icons/printer_off.png"
   powershell -NoProfile -ExecutionPolicy Bypass -File "<this skill folder>/scripts/make-icon.ps1" -Text "DB" -Color "#6a1b9a" -Out "<configDir>/icons/db.png"
   ```
   Glyphs: `print globe settings folder play stop code cloud wifi lock monitor mail document search power sync info warning terminal home calendar people phone camera music video download upload link shield key bug heart star flag clock moon sun car shop` (or a Segoe Fluent Icons hex code like `E749`). Options: `-Shape circle`, `-TextColor`. For toggles use a colour for ON and grey (`#9e9e9e`) for `iconOff`. Do not overwrite existing icon files unless asked. Without an icon a tray shows the TrayCommand logo. On Linux and macOS reuse existing images or leave the icon out.
6. To hide a tray or entry without deleting it, set `"hidden": true`; to show it again remove the property.

## 5. Validate

```bash
{{TRAYCOMMAND_SH}} --validate
```

```powershell
{{TRAYCOMMAND_PS}} --validate | Out-String
```

(In PowerShell the exit code is in `$LASTEXITCODE` afterwards.) It validates the configuration file that `--info` reports (or another one with `--validate=<file>`) and prints `{"ok":true|false,"file":"…","issues":[{"path":"trays[2].action","message":"…"}],"warnings":[…]}`; the exit code is 0 when valid. Fix every issue and validate again. Read the warnings too: missing icon files, admin actions while admin commands are off, `offAction` without `state`. If the file is invalid the running app keeps the previous configuration and shows an error, so never leave it invalid.

## 6. Report

Tell the user:

- what you added or changed (tray, entries, scripts) and which icons you created;
- what you tested and what you could not test;
- anything they must do: enable admin commands; on Windows new tray icons may land in the hidden overflow area (**Settings → Personalization → Taskbar → Other system tray icons** to pin them); what the commands need (for example saving the hosts file needs Notepad started as administrator);
- that a running TrayCommand applies the change by itself within a few seconds (if it is not running, at the next start); they can review and adjust everything in the editor (TrayCommand menu → **Open TrayCommand**) and restore the backup from **Settings → Backups**.
