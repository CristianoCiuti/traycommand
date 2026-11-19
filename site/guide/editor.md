# The editor

Open it from the TrayCommand tray icon → **Open TrayCommand**. It has four pages: **Trays**, **Activity**, **Settings** and **JSON**. Everything you change is a draft until you save.

## Trays

The left column lists your trays:

- a live **ON / OFF** pill for toggles (and **running** while an action runs),
- the **eye** button hides or shows a tray without deleting it,
- drag the handle to **reorder** trays,
- the search box filters by label or id,
- **+** creates a new tray.

Select a tray to edit it on the right. The header has the icon picker, the label, the `id`, and the **Visible / Hidden**, **Enabled / Disabled** and **Delete** buttons.

### Editor cards

| Card | What it sets |
| --- | --- |
| **Click** | The `action` run on click (on click while OFF, for toggles). Without it, a click opens the menu. |
| **On / Off state** | The switch turns the entry into a toggle: check script, ON/OFF patterns, interval, shell, icon when OFF, notifications. |
| **Turn off** | Only for toggles: the `offAction` run on click while ON. |
| **Right click** | Only for trays: the `rightAction`. Without it, right click opens the menu. |
| **Menu** / **Sub menu** | The entries of the menu: add **Item**, **Sub menu** or **Separator**; move up/down, hide, duplicate, delete. Click an entry to edit it; breadcrumbs bring you back. |
| **Enabled when** | Follow another toggle: enabled only while it is ON or OFF. |

Each action editor has the **Script** box and, under the advanced options, shell, working folder, timeout, notification, confirmation text, **Run in a visible terminal**, **Run as administrator**, environment variables, and the composed actions **Run before**, **Run together** and **Run after**.

### Test buttons

Every action and every state check has a **Test** button. It runs the script now, with the current (unsaved) values, and shows:

- exit code, duration, standard output and errors,
- for state checks, the resulting **State: ON / OFF** computed with your patterns.

Tests do not ask for confirmation, do not run composed actions and do not change the configuration. A state check test stops after 60 seconds. Tests are listed on the Activity page.

### Saving

When there are unsaved changes a bar appears at the bottom: **Discard** or **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>Cmd</kbd>+<kbd>S</kbd> on macOS). If something is wrong (duplicate id, unknown reference, invalid regular expression) the bar shows how many problems there are, the entry shows **Fix before saving**, and saving is blocked.

A backup of the previous file is kept at every save. See [backups](./startup-and-updates#backups).

## Activity

Every action run from a tray, a menu or a Test button, with result, duration and time. Click a row to see the script, the output and the errors. State checks are not listed.

- **Running now** lists scripts still running, with a **Stop** button (also in the tray menu under **Running**).
- **Errors only** filters the list.
- **Log folder** opens `logs/` in the [data folder](../reference/cli#data-folder).

Clicking an error notification opens this page.

## Settings

| Section | Contains |
| --- | --- |
| **General** | Start at login, theme, default shell, where the TrayCommand menu appears, notification at startup. |
| **Configuration file** | Path of the file in use, **Open folder**, **Use another file…** |
| **Backups** | The latest backups with **Restore**. |
| **Updates** | Current version, **Check now** / **Install**, automatic checks on/off, link to this documentation. |
| **Advanced** | **Allow commands as administrator**, **Start as administrator without prompt** (Windows), data folder. |

Settings are saved in the configuration file, except the choice of file and the administrator start mode, which are stored on this PC only. See [Administrator](./administrator).

## JSON

The raw configuration file, validated as you type: problems are listed with their path (for example `trays[0].menu[2].enabledWhen`). **Save JSON** writes the file only if it is valid. **Reference** opens the [configuration reference](../reference/).

If the file on disk is invalid (for example after editing it by hand), the editor opens on this page so you can fix it.

::: tip Edit with VS Code
You can also edit the file with any editor: TrayCommand notices the change within a second and reloads it. Keep the `$schema` line to get autocompletion and validation. See the [reference](../reference/#autocompletion-in-vs-code).
:::
