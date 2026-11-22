# Launcher and keyboard shortcuts

Run any entry without touching the mouse: press a shortcut, type a few letters, press <kbd>Enter</kbd>.

## The launcher

Press <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>Space</kbd> (change it in **Settings → Launcher and shortcuts**, or turn it off with the **×** next to it: `"launcherHotkey": ""` in the file). A search box opens in the middle of the main screen, over any application.

![The launcher](/screens/launcher.png)

- **Type** to filter: the search is fuzzy and ignores case and accents. `dcu` finds *Docker compose up*, and words can match the menu too: `docker up` finds *Up* inside the *Docker* menu.
- With an empty search, the entries you used last are listed first under **Recent**, then all the entries in menu order.
- Hidden trays and entries are listed too (with a crossed eye): hide a tray you use only from the keyboard. Disabled entries are not listed.

| Key | What it does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>PgUp</kbd> <kbd>PgDn</kbd> | Move the selection |
| <kbd>Enter</kbd> | Run the selected entry (for a toggle: turn it on or off, as a click does) |
| <kbd>Shift</kbd> <kbd>Enter</kbd> | Run its right click action, when it has one |
| <kbd>Tab</kbd> or <kbd>→</kbd> | Open the menu of the selected entry, and search only inside it |
| <kbd>Backspace</kbd> (empty search), <kbd>Shift</kbd> <kbd>Tab</kbd>, <kbd>←</kbd> | Back to the parent menu |
| <kbd>Ctrl</kbd> <kbd>E</kbd> | Open the selected entry in the editor |
| <kbd>Esc</kbd> | Clear the search, then close |

Each row shows the icon, the menu the entry belongs to, its ON/OFF state, its shortcut, and an icon when it asks for values. If an entry cannot run right now (it is still running, or its [enabled when](./concepts#enabled-when) condition is not met), the launcher says why instead of closing.

The launcher stays loaded in the background, so it opens instantly; it closes as soon as it loses focus. You can also open it from the TrayCommand tray menu (**Search and run…**) or from the command line with `TrayCommand --launcher` (see [command line](../reference/cli)).

## Shortcuts for entries

Any tray or menu entry can have its own global shortcut: open it in the editor, click **Keyboard shortcut** and press the keys. While the recorder is listening, the existing shortcuts are paused, so you can also record one that is already in use to move it. <kbd>Esc</kbd> stops recording. To remove a shortcut, click the **×** at the end of the field, or press <kbd>Backspace</kbd> or <kbd>Delete</kbd> on it (in the file: delete the `hotkey` key).

- On an entry with an action, the shortcut works like a click (a toggle switches).
- On a tray or sub menu without an action, it opens the launcher on that menu: a shortcut for a whole group of commands.
- If the action [asks for values](./inputs), the form opens first.
- **Ask before running** (under the shortcut in the editor) shows a confirmation first, so that a key pressed by mistake runs nothing: <kbd>Enter</kbd> runs, <kbd>Esc</kbd> cancels. Write your own question and text of the button, or leave them empty for *Run “Deploy”?* / **Run** (*Turn on* / *Turn off* for a toggle). Off by default; clicks, the launcher and schedules never ask it.

In the configuration file:

```json
{ "id": "vpn", "label": "VPN", "hotkey": "Ctrl+Alt+V", "action": "…" }
{ "id": "reset", "label": "Reset DB", "hotkey": "Ctrl+Alt+R", "hotkeyConfirm": { "text": "Reset the local database?", "button": "Reset" }, "action": "…" }
```

`"hotkeyConfirm": true` asks with the default texts; `text` (`${VARIABLES}` allowed) and `button` replace them. It is separate from the `confirm` of the [action](../reference/#actions), which asks on every run started by a person.

Shortcuts are written as keys joined by `+`: modifiers `Ctrl`, `Alt`, `Shift`, `Win` (Windows key, `Cmd` on macOS) or `CommandOrControl`, plus one key: a letter, a digit, `F1`–`F24`, `Space`, `Enter`, `Tab`, `Up`/`Down`/`Left`/`Right`, `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete`, punctuation, `num0`–`num9`. At least one of `Ctrl`, `Alt` or `Win` is needed, so that a shortcut never blocks normal typing (function keys can be used alone).

Shortcuts are shown next to the entries in the tray menus and in the launcher. The tray list in the editor marks trays that contain shortcuts with a keyboard icon.

::: tip Shortcuts that do not work
A shortcut already taken by another application cannot be registered: TrayCommand tells you with a notification and next to the shortcut in the editor (and in **Settings → Launcher and shortcuts**). Choose another one. Two entries with the same shortcut are reported as an error before saving.
:::

::: warning Linux with Wayland
Wayland does not let applications register global shortcuts. Bind a shortcut of your desktop to `traycommand --launcher` or `traycommand --run=<id>` instead. On X11 they work normally.
:::
