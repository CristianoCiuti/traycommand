---
name: traycommand
description: Create, change, hide or remove TrayCommand tray icons and menus. TrayCommand runs shell commands from system tray icons (toggles with a live ON/OFF state, menus, sub menus). Use when the user asks for a new tray icon or menu entry that does something ("make me a tray that…", "add to the tray a command that…"), wants to change, hide, reorder or delete existing trays, or mentions TrayCommand or traycommand.json.
---

# TrayCommand

TrayCommand (version {{TRAYCOMMAND_VERSION}}) is a desktop app that shows one or more icons in the system tray. Each icon (a **tray**) and each entry of its menu runs a shell script on click. An entry with a `state` is a **toggle**: a check script runs periodically and decides whether it is ON or OFF, and the icon or check mark follows it.

Everything is defined in **one JSON file**. The running app watches this file and applies changes as soon as it is saved: there is nothing to restart. Your job is to edit that file correctly.

- Full field reference: [reference.md](reference.md) (read it before writing anything non-trivial).
- Ready-made patterns: [examples.md](examples.md).
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

It prints JSON like `{"version":"…","configPath":"…","configDir":"…","dataDir":"…","platform":"…","defaultShell":"…","schema":"…"}`.

- `configPath` is the file to edit. Relative paths inside it (icons, `cwd`) are resolved from `configDir`.
- `defaultShell` is the shell used by scripts that do not choose one (`powershell` on Windows unless `settings.shell` says otherwise).

If the command is not available (TrayCommand moved), read `{{TRAYCOMMAND_DATA}}/state.json`: its `configPath` is the file; without it the file is `traycommand.json` in that same folder.

## 2. Understand the request

Turn "a tray that does X" into concrete choices. Ask the user only what you cannot decide sensibly:

- **New tray icon or entry in an existing menu?** Several related commands usually belong in the menu of one tray rather than in many icons. Look at the existing trays first.
- **Plain action or toggle?** If X has an ON/OFF nature (a service, a proxy, a VPN, a container, a setting), make a toggle: `state.check` + `action` (turn on) + `offAction` (turn off). Otherwise a plain `action`.
- **Script**: write it for the shell that will run it (`defaultShell` or an explicit `shell`). On Windows the default is Windows PowerShell 5.1 (not PowerShell 7: no `&&`, no `??`, no ternary).
- **Visible or hidden?** Scripts run hidden. Long-running or interactive commands whose output the user wants to see need `"terminal": true`. GUI programs should be launched without waiting (`Start-Process` on Windows, `… &` / `nohup` / `open` elsewhere), otherwise the entry stays busy.
- **Needs administrator?** Use `"admin": true` on the action (one UAC prompt per click) and tell the user that **Settings → Advanced → Allow commands as administrator** (`settings.allowAdminCommands`) must be on. State checks cannot be admin: choose a check that works without elevation.
- **Feedback**: `"notify": "text"` for actions whose effect is not visible; `"confirm": "question?"` for destructive ones; `"timeout"` for anything that could hang.

## 3. Test the scripts before saving

Run the check script and, when it is safe and the user agrees, the action scripts yourself, with the same shell TrayCommand will use. Make sure that:

- the state check exits 0 and its output matches `on` (or does not match `off`) exactly when the thing is ON, and is fast (it runs every `interval` seconds);
- the action exits 0 on success (exit code ≠ 0 is reported to the user as an error).

For PowerShell use `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "<script>"` to reproduce the TrayCommand environment.

## 4. Edit the file

1. Read the whole file.
2. Make a backup copy first: `{{TRAYCOMMAND_DATA}}/backups/traycommand-<yyyyMMdd-HHmmss>-agent.json`.
3. Change only what was asked. Keep everything else as it is: other trays, `settings`, `variables`, order, `$schema`, the `"version": 2` line. Keep 2-space indentation.
4. Rules that are easy to get wrong:
   - every `id` must be unique in the whole file; trays need an `id`, menu entries only if referenced; use short `snake_case` ids;
   - JSON strings need `\\` for one backslash and `\"` for a quote; forward slashes (`C:/tools`) work on Windows too and avoid escaping;
   - `on` / `off` are JavaScript regular expressions in a JSON string (`"\\d+"`);
   - unknown properties are errors (no comments in the file);
   - reuse existing `variables` (`${NAME}`), or add one when a path repeats; `${env:NAME}` and `${configDir}` are built in.
5. Icons: `icon` (and `iconOff` for toggles) are image files (png, ico), relative to `configDir`. Reuse icons already in the configuration folder when they fit. To create new ones on Windows use [scripts/make-icon.ps1](scripts/make-icon.ps1):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<this skill folder>/scripts/make-icon.ps1" -Text "DB" -Color "#2e7d32" -Out "<configDir>/icons/db_on.png"
   ```
   For toggles make two variants (for example a colour and grey: `-Color "#9e9e9e"` for `iconOff`). Without an icon a tray shows the TrayCommand logo.
6. To hide a tray or entry without deleting it, set `"hidden": true`; to show it again remove the property.

## 5. Validate

```bash
{{TRAYCOMMAND_SH}} --validate
```

```powershell
{{TRAYCOMMAND_PS}} --validate | Out-String
```

It validates the configuration file (or `--validate=<file>`) and prints `{"ok":true|false,"file":"…","issues":[{"path":"trays[2].action","message":"…"}],"warnings":[…]}`; the exit code is 0 when valid. Fix every issue and validate again. If the file is invalid the running app keeps the previous configuration and shows an error, so never leave it invalid.

## 6. Report

Tell the user what you added or changed (tray, entries, scripts), which icons you created, anything they must do (enable admin commands, Windows may hide new tray icons in the overflow area: **Settings → Personalization → Taskbar → Other system tray icons**), and that the change is already live. They can also review and adjust everything in the TrayCommand editor (left click on the TrayCommand icon → **Open TrayCommand**).
