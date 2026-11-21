# Changelog

Full release notes and downloads are on the [GitHub releases page](https://github.com/CristianoCiuti/traycommand/releases).

## 2.5.0 — export and import

- **Export** (**Settings → Configuration file → Export…**): choose what to share by section (trays and menus, schedules, variables, settings) and, inside each section, item by item. Entries the export needs (run before, *enabled when*, alert buttons, `${VARIABLES}`) are pointed out and added with one click. Icons go with it by default. A single item is a `.json` file, anything more a `.zip` with the icons.
- **Import** (**Import…**, or drop the file on the editor window): opens an export, a whole configuration file or a zip containing one of them, and shows what it contains before changing anything. For entries already here: *add to it*, *replace it* or *keep both* (with a new id that the other imported entries follow). Shortcuts used twice, schedules, variables and settings are shown with their current value; administrator commands and the default shell are never changed for you, and entries that run as administrator are marked. The result is checked before it is saved, and a backup is kept. See [export and import](./guide/sharing).

## 2.4.0 — checks and alerts

- **Only if a check passes** (`if` on a schedule): a command runs first and the schedule goes on only if it succeeds (exit code, and optionally patterns on its output, like a toggle). It gets the values of the event, e.g. the file of a folder watch. See [only if](./guide/schedules#only-if-a-check-passes).
- **Alerts with choices** (`alert` on a schedule): instead of running directly, show a message over all the other windows, or a system notification, with up to 4 buttons. Each button runs the entry, another entry or a command of its own, with the values of the event (`TC_FILE`…). Fully keyboard driven (arrows, 1–4, Enter, Esc); keys are ignored for half a second after it appears so that typing elsewhere does not answer it. Optional timeout with a default choice, shown as a countdown. Without buttons, an alert simply informs. See [alerts and choices](./guide/schedules#alerts-and-choices).
- The editor has **Only if a check passes** and **Show an alert first** under every schedule; runs chosen in an alert are marked *chosen in an alert* in the activity log.

## 2.3.1 — folder watch fixes, fully tested logic

- Folder watches with sub folders: when a sub folder is emptied, renamed or moved away, its files are now reported as removed (they were missed when the system reported only the folder). A file replaced by a folder with the same name is reported as removed too.
- A folder watch closed by saving the configuration no longer reports a late error from the old watch.
- If the form that asks for values cannot be shown, the run stops with a clear notification instead of failing silently.
- A state check whose command cannot even start counts as OFF instead of being left pending.
- In the editor, a time window with only days shows 00:00–24:00 instead of the office hours it does not use, and choosing every day with no hours keeps the window on.
- The logic of the app (configuration, schedules and time windows, folder watches, shortcuts, search, the engine) is now covered 100% by unit tests, and the build fails if that drops.

## 2.3.0 — folder watches and time windows

- **Run when files change** (`watch` schedule): an entry runs when files appear, change or disappear in a folder, e.g. every new `*.pdf` in `Scans`. Name patterns (`*.txt`, `*.{csv,xlsx}`), sub folders, the files already there, one run per file or one for the whole batch, a quiet time so big files are completely written. The command gets the file in `TC_FILE` (and `TC_FILE_NAME`, `TC_EVENT`, `TC_FILES`…). Runs of an entry happen one after the other; a folder that is missing is watched as soon as it appears. See [when files change](./guide/schedules#when-files-change).
- **Time windows for all schedules** (`between`, `days`): only from 08:00 to 19:00, only Monday to Friday, or across midnight (`"22:00-06:00"`). Outside the window scheduled runs do not happen and file events are ignored. See [time window](./guide/schedules#time-window).
- The editor shows whether each folder watch is active, waiting for its time window or failing; so does the tray tooltip. Runs started by a file are marked *file watch* in the activity log, with the file.
- Shortcuts: the documentation now explains how to remove a shortcut and how to turn off the launcher shortcut (the **×** next to it, or `"launcherHotkey": ""`), and both are covered by tests.

## 2.2.0 — launcher, shortcuts, forms and schedules

- **Launcher**: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> opens a search box in the middle of the screen. Type a few letters (fuzzy, accents ignored, menus included), press <kbd>Enter</kbd>. Recent entries first, <kbd>Tab</kbd> to open a menu, <kbd>Shift</kbd>+<kbd>Enter</kbd> for the right click action, <kbd>Ctrl</kbd>+<kbd>E</kbd> to edit. It stays loaded in the background, so it opens instantly. See [launcher and shortcuts](./guide/launcher).
- **Global shortcuts for any entry** (`hotkey`), recorded in the editor by pressing the keys. On a tray or sub menu without an action, the shortcut opens the launcher on that menu. Shortcuts are shown in the tray menus; shortcuts taken by other applications are reported.
- **Ask for values before running** (`inputs`): text, password, number, choice (also from the output of a script, e.g. the git branches), yes/no, file and folder, with defaults, required fields and formats. The form opens in the middle of the screen and is fully keyboard driven; the last values are proposed again. Values are `${NAME}` in the script and environment variables. Passwords are never stored and are hidden in the activity log. See [asking for values](./guide/inputs).
- **Schedules** (`schedules`): run an entry at set times (cron), at an interval or when TrayCommand starts, turn toggles on or off only when needed, with values for the inputs. The next run is shown in the editor and in the tray tooltip; **Pause schedules** in the tray menu. No Task Scheduler. See [schedules](./guide/schedules).
- **Command line**: `--launcher` opens the launcher, `--run=<id>` runs an entry (also when TrayCommand is already running).
- The activity log shows what started each run (shortcut, launcher, schedule, command line) and the values typed.

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
