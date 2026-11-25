# The editor

Open it from the TrayCommand tray icon → **Open TrayCommand**. It has five pages: **Trays**, **Variables**, **Activity**, **Settings** and **JSON**. Everything you change is a draft until you save.

## Trays

The left column lists your trays:

- a live **ON / OFF** pill for toggles (and **running** while an action runs),
- the **eye** button hides or shows a tray without deleting it,
- drag the handle to **reorder** trays (lists whose order matters can be reordered by dragging everywhere: menu entries, **Run before**, **Run after**, the values asked by an action and the buttons of an alert, each by its handle ⋮⋮),
- the search box filters by label or id,
- **+** creates a new tray.

Select a tray to edit it on the right. The header has the icon picker, the label, the `id`, and the **Visible / Hidden**, **Enabled / Disabled** and **Delete** buttons.

### Editor cards

| Card | What it sets |
| --- | --- |
| **Click** | The `action` run on click (on click while OFF, for toggles). Without it, a click opens the menu. |
| **On / Off state** | The switch turns the entry into a toggle: check script, ON/OFF patterns, interval, shell, icon and name when OFF, notifications. |
| **Turn off** | Only for toggles: the `offAction` run on click while ON. |
| **Right click** | Only for trays: the `rightAction`. Without it, right click opens the menu. |
| **Keyboard shortcut** | A global [shortcut](./launcher#shortcuts-for-entries): click it and press the keys. |
| **Schedule** | [Runs at set times](./schedules), at an interval or at startup, with the next run in the card header. |
| **Menu** / **Sub menu** | The entries of the menu: add **Item**, **Sub menu** or **Separator**; move up/down, hide, duplicate, delete. Click an entry to edit it; breadcrumbs bring you back. |
| **Enabled when** | Follow other toggles: clickable only while they are ON or OFF, all of them (**All (and)**), any of them (**Any (or)**) or groups of both. The result is written in words underneath. |

Each action editor has the **Script** box, the values to [ask before running](./inputs) (**Ask for a value**) and, under the advanced options, shell, working folder, timeout, notification, confirmation text and the text of its button, **Run in a visible terminal**, **Run as administrator**, environment variables, and the composed actions **Run before**, **Run together** and **Run after**.

While you edit a script, a folder, a label or a message, the [variables](./variables) it can use appear under it as chips (a click inserts `${NAME}` at the cursor), and a `${NAME}` without a value there is pointed out.

### Test buttons

Every action and every state check has a **Test** button. It runs the script now, with the current (unsaved) values, and shows:

- exit code, duration, standard output and errors,
- for state checks, the resulting **State: ON / OFF** computed with your patterns.

Tests do not ask for confirmation, do not run composed actions and do not change the configuration. If the action asks for values, the form opens first. A state check test stops after 60 seconds. Tests are listed on the Activity page.

### Saving

When there are unsaved changes a bar appears at the bottom: **Discard** or **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>Cmd</kbd>+<kbd>S</kbd> on macOS). If something is wrong (duplicate id, unknown reference, invalid regular expression) the bar shows how many problems there are, the entry shows **Fix before saving**, and saving is blocked. Closing the editor, or **Quit TrayCommand** from the tray, with unsaved changes asks first: **Keep editing** or **Discard and close** (**Discard and quit**).

A backup of the previous file is kept at every save. See [backups](./startup-and-updates#backups).

## Variables

The [variables and secrets](./variables) of the configuration: change a value in place, see where each one is used (and open those entries), add, rename, delete, turn a variable into a secret and back. Renaming asks whether to change the name everywhere it is written, only in the places you tick, or nowhere. The page also lists the `${NAME}` written but not defined, and the built in values.

## Activity

Every action run from a tray, a menu, the launcher, a shortcut, a schedule or a Test button, with result, duration and time (runs not started by a click are marked *shortcut*, *launcher*, *scheduled* or *command line*). Click a row to see the script, the values typed in the form (passwords hidden), the output and the errors. State checks are not listed.

- **Running now** lists scripts still running, with a **Stop** button (also in the tray menu under **Running**).
- **Errors only** filters the list.
- **Log folder** opens `logs/` in the [data folder](../reference/cli#data-folder).

Clicking an error notification opens this page.

## Settings

| Section | Contains |
| --- | --- |
| **Look** | Aurora, Phosphor, Brutal or Neon HUD (see [looks](#looks)). |
| **General** | Start at login, theme (light, dark or as the system), default shell, where the TrayCommand menu appears, notification at startup, the orange badge on the icons of entries while they run. |
| **Configuration file** | Path of the file in use, **Open folder**, **Use another file…**, **Export…** and **Import…** (see [export and import](./sharing)). |
| **Backups** | The latest backups with **Restore**. |
| **Updates** | Current version, **Check now** / **Install**, automatic checks on/off, link to this documentation. |
| **Advanced** | **Allow commands as administrator**, **Start as administrator without prompt** (Windows), data folder. |

Settings are saved in the configuration file, except the choice of file and the administrator start mode, which are stored on this PC only. See [Administrator](./administrator).

## Looks

![The four looks](/screens/home/look-aurora.png)

TrayCommand has four looks, chosen in **Settings → Look** (`"style"` in the [settings](../reference/#settings)):

| Look | Style |
| --- | --- |
| **Aurora** (default) | Frosted glass over an aurora of violet, indigo and teal. |
| **Phosphor** | A terminal: monospace, square corners, cream paper and phosphor green. |
| **Brutal** | Flat colours, thick black outlines, hard shadows. |
| **Neon HUD** | Cyan and magenta lines on night blue, cut corners. |

Each look restyles the whole editor and the launcher, in light and dark (the **Theme** setting), and has its own icon: the window, the taskbar, the TrayCommand tray icon and the Start menu shortcut change with it. The window buttons (minimize, maximize, close) take the colours of the look. A look chosen in the settings is shown at once; save to keep it.

## JSON

The raw configuration file, validated as you type: problems are listed with their path (for example `trays[0].menu[2].enabledWhen`). **Save JSON** writes the file only if it is valid. **Reference** opens the [configuration reference](../reference/).

If the file on disk is invalid (for example after editing it by hand), the editor opens on this page so you can fix it.

::: tip Edit with VS Code
You can also edit the file with any editor: TrayCommand notices the change within a second and reloads it. Keep the `$schema` line to get autocompletion and validation. See the [reference](../reference/#autocompletion-in-vs-code).
:::
