# Changelog

Full release notes and downloads are on the [GitHub releases page](https://github.com/CristianoCiuti/traycommand/releases).

## 2.13.0 — steps that depend on the result, command line export, import and update

- **Run after only on some results**: an item of `after` can be `{ "run": "id", "when": "success" }` (only if the script succeeds), `"failed"` (only if it fails) or `{ "run": "id", "exitCodes": [3] }` (only with those exit codes). A plain reference still always runs. Steps left out are listed in the **Activity** as *Skipped*, with the reason. In the editor, **Run after** under **Options** of the action has one row per entry: the entry, which of its actions, and when it runs. Docs: [run after only on some results](./guide/concepts#run-after-only-on-some-results).
- The entry clicked shows **running** until its whole chain ends (`before`, `parallel`, `after`), not only its own script; a second click meanwhile is refused, and schedules and alert buttons wait for it.
- **Command line**:
  - `--export=<file> [--entries=id,id]` writes an export as **Export…** does;
  - `--import=<file>` shows what an import would do, `--import=<file> --apply` does it (a backup is kept);
  - `--update` checks for a new version, `--update=install` downloads, verifies and installs it (a running TrayCommand installs it itself and restarts).
  See the [command line](./reference/cli#tools-for-scripts-and-ai-agents).
- The AI skill knows conditional `after`, the confirmation button and the new command line options (export and import through TrayCommand, with a dry run first).
- Steadier end-to-end tests: the editor dialogs listen to their keys as soon as they appear, the colours of the window buttons are sent again after a theme change even when no frame is drawn, and the first state check of a cold machine has the time it needs.

## 2.12.0 — confirmations in TrayCommand's own window

- `confirm` of an action now asks in a **TrayCommand window**, with the look and theme of the app, like the confirmation of a shortcut: <kbd>Enter</kbd> runs, <kbd>Esc</kbd> cancels. It was a system dialog with the buttons *Run / Cancel*. Every run started by a person asks (click, menu, launcher, shortcut, alert choice, notification click); scheduled runs still skip it.
- The text of the confirm button can be your own: `"confirm": { "text": "Restart the VDI?", "button": "Restart" }`. A plain string works as before, with the **Run** button. In the editor: **Confirm button**, next to the confirmation text under **Options** of the action. Both texts allow `${VARIABLES}` and the values asked by the action, and are listed on the Variables page.
- The confirmations of the editor are dialogs of the editor too, no longer system windows: deleting an entry, restoring a backup, deleting a variable still in use, making a secret a plain variable, and closing the editor with unsaved changes (**Keep editing** / **Discard and close**). <kbd>Enter</kbd> confirms, <kbd>Esc</kbd> cancels. The windows to choose a file or a folder stay those of the system.
- **Quit TrayCommand** from the tray no longer loses the unsaved changes of the editor: it brings the editor to the front and asks (**Keep editing** / **Discard and quit**). Without unsaved changes it quits at once, as before.
- Docs: [ask for confirmation](./recipes/#ask-for-confirmation).

## 2.11.0 — clickable notifications

- The notification of an action can **run another entry when it is clicked**: `"notify": { "text": "VDI ready: click to show it", "click": "vdi:on" }`. `"id"` does what a click on that entry does, `"id:on"`, `"id:off"` and `"id:right"` choose. `true` and a plain text work as before.
- Failures too: `"notifyError": { "text"?, "click"? }`. `text` replaces the first line `Failed: <reason>`, the last lines of the output still follow; without `click` a failure still opens the activity log when clicked.
- In the editor, under **Options** of the action: **Clicking the notification runs** and the text and click of the error notification. Unknown ids are errors, an entry without that action is a warning, imported entries with a new id keep their notification clicks, and the texts are listed on the Variables page.
- The activity log shows these runs as started by a *notification click*.
- Docs: [clicking a notification](./guide/concepts#clicking-a-notification).

## 2.10.0 — faster check marks for toggles

- Toggles can show the new state **as soon as the action succeeds**: `"optimistic": true` in `state` (**Show the new state at once** in the editor). ON after `action`, OFF after `offAction`; the check that follows still runs and corrects it if the action changed nothing. The state notifications are shown once, at the change. `rightAction` and the choices of an alert do not change the state. Needs both `action` and `offAction` (`--validate` warns otherwise).
- How long to wait before that check is now up to you: `"recheckDelay"` in `state`, in milliseconds (**Check after an action (ms)**). Default 700 as before; `0` checks at once.
- A check that was already running when an action ended no longer shows an outdated state and no longer swallows the check after the action: it runs again at once.
- Docs: [faster check marks](./guide/concepts#faster-check-marks).

## 2.9.1 — quoted paths in cmd scripts

- Scripts with the `cmd` shell that contain double quotes work: `type nul > "C:\Users\Mario Rossi\x.flag"`, `if exist "C:\a b\f" (echo yes) else (echo no)`, quoted programs with spaces in their path. The quotes reached cmd as `\"`, which cmd does not understand ("The filename, directory name, or volume label syntax is incorrect", `if exist` always false). The script now reaches cmd exactly as written, also with **Run in a visible terminal** and with a custom shell whose `command` is `cmd.exe` (as administrator too).
- Docs: [cmd scripts](./guide/platforms#cmd-scripts), and why `echo on` / `echo off` print nothing in a cmd state check.

## 2.9.0 — variables page, variable chips, secrets

- New **Variables** page in the editor: every variable with its value (changed in place), how many times it is used and where (each place opens its entry). Add, rename, delete. See [variables and secrets](./guide/variables).
- **Rename** asks what to do where the variable is written: everywhere, only in the places you tick, or nowhere (only the name changes).
- **Chips to insert variables** under every text that can use them (scripts, folders, environment variables, labels, confirmation and notification texts, the shortcut question, the state check and its notifications, the folder of a watch, the check of a schedule, the title, message and buttons of an alert, the label and choices script of an asked value): the values of the action and, for a folder watch, `TC_FILE` and the others first, then the variables and secrets, then `${configDir}` and `${env:…}`. A click writes `${NAME}` where the cursor is.
- **Names without a value are pointed out** under the text: a name that is not a variable (with **Add variable**), a `TC_…` value outside a folder watch, a secret with no value on this PC. The Variables page lists them all, and `--validate` reports them as warnings.
- **Secrets** for passwords and tokens: used as `${NAME}` like any variable, but the file only lists their names (`"secrets"`). Values are typed on the Variables page, kept encrypted on this PC for your account, shown as `••••` in the activity log, notifications, labels, alerts and test output, and never exported (only the name travels). A variable can become a secret and back.

## 2.8.0 — shortcuts that ask first, notifications that run on click

- Keyboard shortcuts can ask before running: **Ask before running** under the shortcut in the editor (`hotkeyConfirm` in the file). The question and the text of the confirm button can be your own; <kbd>Enter</kbd> runs, <kbd>Esc</kbd> cancels. Off by default, and only the shortcut asks: clicks, the launcher and schedules run as before.
- Alerts of schedules shown as a notification: **Clicking the notification** can run one of the buttons directly, without opening the window with the choices (`click` in the alert). The notification says what the click does.
- Alerts: the key hint of an alert with a single button says *Enter run* instead of *Enter OK*.

## 2.7.4 — no flash in the launcher, quieter skill updates

- Launcher: no more flash when the arrow keys go past the first or last visible row. The list now scrolls in the same frame in which the selection moves, so the selected row is never drawn out of view for an instant.
- The skill for AI assistants is updated, and the notification shown, only when the skill really changes, not at every new version of TrayCommand. The notifications about the skill no longer name a specific assistant. The first start of 2.7.4 still updates it once, as the version number is no longer written in it.

## 2.7.3 — launcher arrow keys

- Launcher: with the mouse pointer resting over the list, the arrow keys no longer jump back to the row under the pointer each time the list scrolls. Only a real movement of the mouse selects a row.
- Launcher: no more flash of the rows coming into view when the arrow keys scroll the list (the row under the pointer was selected for an instant, and highlighted as hovered).
- Settings → Updates: **Check for updates automatically** says how often the check runs (shortly after start, then every 6 hours) only while it is on, and the text stays there after **Check now**.

## 2.7.2 — launcher without the shadow

- Aurora, Phosphor and Neon HUD: the launcher, its forms and the alerts of schedules no longer have a soft shadow around them, which showed cut off at the edges of the window. The window is now exactly the panel, so it covers nothing beyond it. Brutal keeps its hard offset shadow. Forms and alerts move like the list, by their header or footer.
- Docs: why macOS and Linux have no "Start as administrator without prompt", and how to run a few chosen commands without a password there (a `sudoers` rule and `sudo -n`).

## 2.7.1 — launcher search bar

- The launcher shortcut is back at the end of the search bar in Aurora, Brutal and Neon HUD (it sat in the middle).
- Phosphor: the text typed in the launcher can be selected with the mouse again (the search bar, which moves the window since 2.7.0, covered it).

## 2.7.0 — the launcher can be moved, macOS fixes

- The launcher can be moved: drag it by its search bar, the header of a form or its footer. It opens again where you left it (back in the centre if that screen is gone). **Settings → Launcher position → Reset position** brings it back to the centre.
- macOS: notifications arrive (the app is now signed ad hoc; macOS asks once whether TrayCommand may send them).
- macOS: the menu bar icon is the TrayCommand icon of the look in use; **Monochrome menu bar icon** in the TrayCommand menu brings back the black-and-white symbol in the style of the other menu bar icons. The app icon in Finder, Launchpad and notifications follows the look too.
- macOS: **Start at login** adds TrayCommand.app itself to **Open at Login**, with its name and icon, instead of a background item with a generic "exec" icon (the old item is replaced at the next start).

## 2.6.6 — the editor opens in its look

- With a look other than Aurora, opening the editor window could show the Aurora background with a loader for a moment; the window now opens straight in the look chosen, from its very first frame.

## 2.6.5 — skill for AI agents up to date

- The TrayCommand skill for Claude Code and opencode now lists every check the validator does (alerts and their buttons, time limits, default choice) and its warnings, gives the right shortest alert timeout (5 seconds) and is picked by agents also for checks, alerts, looks and export/import. Installed skills update with the app.

## 2.6.4 — window buttons always in step

- When light and dark changed several times in a row (for example saving with "same as system"), the window buttons could stay in the previous colours; they now always end up with the colours of the page.

## 2.6.3 — update status in the look

- The update status in **Settings → Updates** ("Downloading… 100%", a new version, an error) is now drawn as a state in each look's own face instead of a plain description: a yellow label in Brutal, cyan monospace in Neon HUD, amber in Phosphor, the accent colour in Aurora.

## 2.6.2 — readable Save shortcut

- The **Ctrl+S** shortcut inside the Save button was unreadable in the Brutal look (dark keycap on yellow); every look now draws it in its own way, readable in light and dark. A test measures its contrast in all four looks.

## 2.6.1 — Start menu icon

- The Start menu shortcut now really takes the icon of the look chosen (the icon files were missing from the package).

## 2.6.0 — four looks

- **Looks** (**Settings → Look**, `"style"`): **Aurora** (frosted glass over an aurora, the new default), **Phosphor** (a terminal), **Brutal** (flat colours, thick outlines, hard shadows) and **Neon HUD** (cyan and magenta on night blue). Each restyles every part of the editor and the launcher, light and dark, and has its own icon: window, taskbar, TrayCommand tray icon and Start menu shortcut. See [looks](./guide/editor#looks).
- The window buttons (minimize, maximize, close) now always take the colours of the page, light or dark, instead of a fixed pair.
- The documentation site has the Aurora look, with pictures of the app on the home page.
- New app icon (Aurora).

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
