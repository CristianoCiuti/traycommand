# Changelog

Full release notes and downloads are on the [GitHub releases page](https://github.com/CristianoCiuti/traycommand/releases).

## 2.1.3 — update extraction fix (Windows)

- The update could fail with `Cannot extract the update: /usr/bin/tar: Cannot connect to C: resolve failed` when another `tar` (for example Git for Windows' `usrin`) came before Windows' own in `PATH`. TrayCommand now uses `%SystemRoot%\System32	ar.exe` by its full path, and falls back to PowerShell's `Expand-Archive`.
- After an update TrayCommand keeps the `--data-dir` option.

## 2.1.2 — skill installation fix

- Installing the AI skill could fail with `EPERM` when opencode or Claude Code were running (they watch their skills folder) or the antivirus was scanning the new files. The skill files are now written in place, retrying while a file is busy; one agent failing no longer stops the other. Leftover `traycommand.tmp-*` folders are removed.

## 2.1.1 — update fix (Windows)

- **Updates on Windows work again.** In 2.0.0 and 2.1.0 the helper that replaces the installation could be stopped by Windows before it ran: TrayCommand closed after the download and did not come back. The helper is now run by the new version itself. Versions 2.0.0 and 2.1.0 cannot update themselves to 2.1.1: download the zip once from the releases page, run `TrayCommand.exe` and click **Install** (your configuration is kept).
- If the Start menu shortcut is missing, TrayCommand puts it back when it starts.

## 2.1.0 — AI assistants

- **Skill for Claude Code and opencode**: TrayCommand finds the agents on your PC and proposes to install a skill that teaches them how to create and change trays. Kept up to date automatically, or after asking (`settings.skillUpdates`). See [AI assistants](./guide/ai-assistants).
- **Command line tools**: `--info` prints where the configuration and data are, `--validate` checks a configuration file. See [command line](./reference/cli#tools-for-scripts-and-ai-agents).

## 2.0.0 — complete rewrite

TrayCommand 2.0 is rewritten from scratch, with a new configuration format and a visual editor.

::: warning Breaking change
The 1.x configuration file is not read by 2.0. Convert it with the script described in [Migrating from 1.x](./guide/migration).
:::

### Highlights

- **New configuration format (v2)** with clearer names (`action`, `offAction`, `state`, `menu`), a string shorthand for actions, [variables](./guide/concepts#variables) and a public [JSON Schema](./reference/#autocompletion-in-vs-code) for autocompletion.
- **Visual editor** with live ON/OFF state, hide/show, drag to reorder, a **Test** button for every action and state check, validation before saving, and a raw [JSON page](./guide/editor#json).
- **Toggles** decided by exit code and `on` / `off` regular expressions, with an icon for the OFF state and notifications on change.
- **Composed actions** (`before`, `parallel`, `after`) with simple `"id"` / `"id:off"` references, and `enabledWhen` to follow another toggle.
- **Hidden and disabled** entries: keep them in the file, with their state checks paused.
- **Action options**: `confirm`, `timeout`, `terminal`, `cwd`, `env`, per-action `shell`, and [run as administrator](./guide/administrator#run-as-administrator) with a UAC prompt on each run.
- **Activity page** with the output of every run, and **Running** processes you can stop.
- **Install for this user** without administrator rights, and **self update** from GitHub releases verified with SHA-256.
- **Start at login** with a Startup folder shortcut (Windows), `~/.config/autostart` (Linux) or a LaunchAgent (macOS): no Task Scheduler, no registry.
- **Configuration file anywhere**, for example in a synced folder, chosen per PC, reloaded automatically when it changes, with the last 30 backups.
- Optional, Windows-only [start as administrator without prompt](./guide/administrator#start-as-administrator-without-prompt), off by default and behind an explicit risk warning.
- Windows, Linux and macOS builds.
