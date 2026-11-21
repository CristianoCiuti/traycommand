# Schedules

Any entry can run by itself: at set times, at an interval, when TrayCommand starts, or when files appear in a folder, optionally only in a time window, only if a check passes, and after asking you with an alert. Schedules live inside TrayCommand: no Task Scheduler, no cron daemon, nothing to clean up.

In the editor, open the entry and click **Add schedule** in the **Schedule** card. The card shows when the next runs are; the tray tooltip shows the next one too.

```json
{
  "id": "cleanup",
  "label": "Clean temp files",
  "action": "Remove-Item \"$env:TEMP\\build-*\" -Recurse -Force",
  "schedules": [
    { "cron": "0 9 * * 1-5" },
    { "every": "4h" },
    { "startup": true }
  ]
}
```

## Kinds of schedule

Each schedule has exactly one of:

| Property | Runs | Examples |
| --- | --- | --- |
| `cron` | At the times of a cron expression, local time | `"0 9 * * 1-5"` 09:00 on weekdays · `"*/15 * * * *"` every 15 minutes · `"30 18 * * 5"` Fridays at 18:30 · `"0 8,13 * * *"` 08:00 and 13:00 |
| `every` | At an interval, counted from when TrayCommand starts | `"30s"`, `"15m"`, `"2h"`, `"1d"`, `"1h30m"` (minimum 5 seconds) |
| `startup` | Once, a few seconds after TrayCommand starts (not when the configuration is reloaded) | `true` |
| `watch` | When files appear, change or disappear in a folder: see [below](#when-files-change) | `{ "path": "C:\\Scans", "files": "*.pdf" }` |

In the editor, **At set times** covers the common case (times and days of the week) and writes the cron expression for you; **Cron expression** accepts any one.

### Cron expressions

Five fields: `minute hour day-of-month month day-of-week`.

| Syntax | Meaning |
| --- | --- |
| `*` | Any value |
| `5` | Exactly 5 |
| `1-5` | From 1 to 5 |
| `1,3,5` | 1, 3 and 5 |
| `*/15` | Every 15 (0, 15, 30, 45) |
| `10-40/10` | 10, 20, 30, 40 |
| `MON-FRI`, `JAN,JUL` | Names for days and months |

Days of the week go from 0 (Sunday) to 6 (Saturday); 7 is Sunday too. As in standard cron, when both day-of-month and day-of-week are set, a day matches if either matches. Shortcuts: `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, `@weekdays` (09:00 Monday to Friday).

## When files change

A `watch` schedule runs the entry when files arrive in a folder: a scanner that saves PDFs, a download, an export from another program, a file dropped by a colleague on a share.

![A folder watch in the editor](/screens/editor-watch.png)

```json
{
  "id": "ocr",
  "label": "OCR new scans",
  "hidden": true,
  "action": "ocrmypdf \"$env:TC_FILE\" \"D:\\Archive\\$env:TC_FILE_NAME\"",
  "schedules": [{ "watch": { "path": "C:\\Scans", "files": "*.pdf" } }]
}
```

| Property | Default | Meaning |
| --- | --- | --- |
| `path` | — | The folder. `${VARIABLES}` work (`"${env:USERPROFILE}\\Downloads"`); a relative path starts from the configuration folder. |
| `files` | every file | Name patterns: `"*.txt"`, `"*.{csv,xlsx}"`, `"report-??.pdf"`, `"[!~]*.docx"` (not starting with `~`). Several patterns: `"*.csv, *.xlsx"` or a list. Case is ignored on Windows and macOS. With a `/` the pattern matches the path inside the folder: `"in/**/*.txt"`. |
| `events` | `["add"]` | `"add"`: a file appears (created, copied, moved or renamed into the folder) · `"change"`: a file is modified · `"remove"`: a file disappears. |
| `subfolders` | `false` | Watch the sub folders too. |
| `existing` | `false` | Also run for the matching files already in the folder when the watch starts: when TrayCommand starts, when the schedule is created or changed, and when its time window opens. |
| `batch` | `false` | One run for all the files that arrive together, instead of one run per file. |
| `settle` | `"2s"` | How long the folder must be quiet before running, so that big files are completely written. Raise it for slow copies (`"10s"`). |

The command gets the file as environment variables (safest for paths with spaces) and as `${...}`:

| Variable | Value |
| --- | --- |
| `TC_FILE` | Full path of the file |
| `TC_FILE_NAME` | Its name, e.g. `scan-001.pdf` |
| `TC_FILE_DIR` | Its folder |
| `TC_EVENT` | `add`, `change` or `remove` (`mixed` for a batch with different events) |
| `TC_FILES` | All the files of the run, one per line (with `batch`) |
| `TC_WATCH_DIR` | The watched folder |

How it behaves:

- Runs for the same entry happen **one after the other**: ten files copied at once start ten runs, in order, never in parallel. A run started by a click in the meantime is waited for.
- A copy of one file produces many events at system level: TrayCommand waits for the quiet time, then compares the folder with what it saw before, so you get one `add` per file, and saving a file without changes starts nothing.
- If the folder does not exist yet (a USB drive, a share, a folder created later), TrayCommand keeps trying every few seconds and starts watching as soon as it appears. The editor and the tray tooltip show the problem meanwhile.
- If the command moves or deletes the file it processes, that is fine: a removal starts a run only with `"events": ["remove"]`.

## Time window

Any schedule can be limited to a time window with `between` and `days`: outside it, scheduled runs do not happen and file events are ignored.

```json
"schedules": [
  { "watch": { "path": "\\\\server\\inbox", "files": "*.xml" }, "between": "08:00-19:00", "days": "mon-fri" },
  { "every": "10m", "between": "22:00-06:00" }
]
```

| Property | Meaning |
| --- | --- |
| `between` | `"HH:MM-HH:MM"`, local time. A range that ends before it starts crosses midnight: `"22:00-06:00"`. `24:00` is the end of the day. |
| `days` | Days of the week as in cron: `"mon-fri"`, `"sat,sun"`, `"mon,wed,fri"`. With `between`, the day the range starts on (Friday `22:00-06:00` lasts until Saturday 06:00). |

With only `days`, the schedule is active the whole day. For `every` and `cron`, the next run shown is the first one inside the window. For a `watch`, files that arrive outside the window are not processed later, unless `existing` is set: then the files waiting in the folder are processed when the window opens. A `startup` schedule outside its window does not run.

In the editor, switch on **Only in a time window** under the schedule.

## Only if a check passes

`if` runs a command first; the schedule goes on only if it succeeds. It follows the rules of the [state of a toggle](./concepts#toggles-state): exit code 0 means yes; with `on` the output must also match, with `off` it must not.

```json
"schedules": [
  { "every": "5m", "if": "Test-Connection build-server -Count 1 -Quiet | Where-Object { $_ }", "run": "on" },
  { "watch": { "path": "C:\\Scans", "files": "*.pdf" }, "if": { "check": "pdfinfo \"$env:TC_FILE\"", "off": "Encrypted:\\s+yes" } }
]
```

| Property | Meaning |
| --- | --- |
| `if` | The check command, or an object: |
| `if.check` | The command. |
| `if.on` / `if.off` | Optional regular expressions on its output: must match / must not match. |
| `if.shell`, `if.timeout` | Shell of the check, and seconds before it is stopped (default 60; a check stopped fails). |

The check gets the same values as the run: for a folder watch `TC_FILE`, `TC_FILE_NAME`… as environment variables and `${...}`. A check that says no is not an error and leaves no trace; a check that cannot even start (or is stopped) is logged and notified.

In the editor: **Only if a check passes** under the schedule.

## Alerts and choices

Instead of running directly, a schedule can show an **alert**: a message, and buttons to choose what runs. It appears in a small window over all the other windows, in the middle of the screen, or as a system notification.

![An alert](/screens/alert.png)

```json
{
  "id": "scans",
  "label": "Scans",
  "hidden": true,
  "action": "ocrmypdf \"$env:TC_FILE\" \"$env:TC_FILE\"",
  "schedules": [
    {
      "watch": { "path": "C:\\Scans", "files": "*.pdf" },
      "alert": {
        "title": "New scan",
        "text": "${TC_FILE_NAME} has arrived. What should I do?",
        "choices": [
          { "label": "OCR", "run": "self" },
          { "label": "Archive", "action": "Move-Item -LiteralPath $env:TC_FILE -Destination D:\\Archive" },
          { "label": "Send by mail", "run": "mail-scan" }
        ],
        "timeout": "10m",
        "default": "Archive"
      }
    }
  ]
}
```

| Property | Default | Meaning |
| --- | --- | --- |
| `style` | `"window"` | `"window"`: over all the other windows, ready for the keyboard. `"notification"`: a system notification; clicking it shows the same window with the buttons. |
| `title` | the label of the entry | `${VALUES}` allowed. |
| `text` | — | The message. `${TC_FILE_NAME}` and the other values allowed. |
| `choices` | — | Up to 4 buttons. Without buttons the alert only informs (an **OK** button). |
| `choices[].label` | — | Text of the button. |
| `choices[].run` | — | `"self"`: what the schedule would run (its `run`: click, on, off, right). Or another entry: `"<id>"`, `"<id>:on"`, `"<id>:off"`, `"<id>:right"`. |
| `choices[].action` | — | A command of its own, like any [action](../reference/#actions) (a string or an object with `run`, `inputs`, `confirm`…). |
| `timeout` | — | Close the alert if nobody answers within this time: `"30s"`, `"10m"`, `"1h"` (5 seconds to 1 day). |
| `default` | — | The label of the choice run when the time is up. Without it nothing runs. |

How it behaves:

- **Keyboard**: <kbd>←</kbd> <kbd>→</kbd> move between the buttons, <kbd>1</kbd>–<kbd>4</kbd> choose directly, <kbd>Enter</kbd> runs the highlighted one (the default, if any), <kbd>Esc</kbd> closes it without running anything. For half a second after it appears keys and clicks are ignored, so that typing in another application does not answer it by mistake.
- The chosen action gets the values of the event (`TC_FILE`…). Since a person chose it, it can ask for [values](./inputs) and confirmations like a click. The default run at the timeout is unattended instead: it never asks.
- If the entry is still running (a click meanwhile, the previous file), the chosen action starts as soon as it finishes.
- `"self"` is decided when you answer: for a toggle with `"run": "on"`, turned on in the meantime, the button only tells you there is nothing to do. A `"self"` button is not even shown when, at that moment, there is nothing to run.
- The window shows the time left and what will happen (*Archive in 9:41*).
- **Repeated schedules** (cron, every): while the window is open, the next runs do not open another one. A newer **notification** replaces the older one, unless you have clicked it and are answering.
- **Folder watches**: every file gets its own alert; they wait in line on screen and the files that follow are not held back.
- Opened over the launcher, after the alert you are back in the list, with your search.
- `if` runs before the alert: the alert appears only if the check passes.
- Saving the configuration closes the alerts on screen; nothing runs.

In the editor: **Show an alert first** under the schedule. The buttons can run the entry itself, another entry (chosen from a list) or a command.

![An alert in the editor](/screens/editor-alert.png)

### Just a notification or a message

An alert without buttons only informs:

```json
"schedules": [{ "cron": "0 13 * * 1-5", "alert": { "text": "Lunch break!", "timeout": "15m" } }]
```

With `"style": "notification"` it is a system notification; with the default style a message over the other windows, closed with <kbd>Enter</kbd> or <kbd>Esc</kbd>. To be told when an action has run, use `notify` on the action instead.

## What runs

| `run` | Does |
| --- | --- |
| `"click"` (default) | What a click does: for a toggle, it switches |
| `"on"` | Turns a toggle on, only if it is OFF |
| `"off"` | Turns a toggle off (its `offAction`), only if it is ON |
| `"right"` | The right click action of a tray |

For toggles, `"on"` and `"off"` are usually what you want: a schedule that connects the VPN every morning does nothing if it is already connected.

## Values and confirmations

Scheduled runs are unattended: they **never ask** (unless you add an [alert](#alerts-and-choices): then you choose, and the action you choose can ask).

- [Values](./inputs) come from the schedule's `values`, then from each input's `default`. A required value without either makes the run fail with a clear message in the activity log.
- `confirm` is skipped.

```json
"schedules": [{ "cron": "0 18 * * 1-5", "values": { "ENV": "test" } }]
```

## Good to know

- A run is skipped (and logged) when the previous one is still going.
- Runs missed while the PC was asleep or off are not recovered: after resuming, TrayCommand computes the next ones.
- Schedules of a **disabled** entry (or one inside a disabled menu) do not run. **Hidden** entries keep running: hide a tray that only exists to run something on a schedule.
- `"disabled": true` on a schedule keeps it in the file without running it.
- **Pause schedules** in the TrayCommand tray menu (also in **Settings**) stops them all on this PC until you resume them; it does not change the configuration.
- Saving the configuration does not restart the countdown of `every` schedules that did not change.
- Every scheduled run is in the [activity log](./editor#activity) marked *scheduled* (*file watch* for folder watches, with the file), with its output.
- **Pause schedules** pauses folder watches too: files that arrive meanwhile are not processed later.
