# Schedules

Any entry can run by itself: at set times, at an interval, or when TrayCommand starts. Schedules are timers inside TrayCommand: no Task Scheduler, no cron daemon, nothing to clean up.

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

## What runs

| `run` | Does |
| --- | --- |
| `"click"` (default) | What a click does: for a toggle, it switches |
| `"on"` | Turns a toggle on, only if it is OFF |
| `"off"` | Turns a toggle off (its `offAction`), only if it is ON |
| `"right"` | The right click action of a tray |

For toggles, `"on"` and `"off"` are usually what you want: a schedule that connects the VPN every morning does nothing if it is already connected.

## Values and confirmations

Scheduled runs are unattended: they **never ask**.

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
- Every scheduled run is in the [activity log](./editor#activity) marked *scheduled*, with its output.
