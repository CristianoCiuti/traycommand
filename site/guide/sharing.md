# Export and import

Share some trays with a colleague, copy your schedules to another PC, or bring in entries from another configuration file: **Settings → Configuration file → Export… / Import…**. You can also drop an export (or a configuration file) on the editor window to import it.

## Export

![Export window](/screens/export.png)

The window lists what your configuration contains, in four sections:

| Section | What it holds |
| --- | --- |
| **Trays and menus** | Every tray with its menu entries and sub menus. |
| **Schedules** | Every schedule, with the entry it belongs to. |
| **Variables** | The `${NAME}` values of the configuration, and the names of its secrets (never their values). |
| **Settings** | Theme, default shell, launcher shortcut and the other settings. |

- Tick a section to take all of it, or open it and tick single items. A tray or sub menu takes everything inside it; untick the entries you want to leave out. Ticking a menu entry alone also takes the trays and sub menus it is in, so it ends up in the same place on import.
- At first everything is ticked, except the settings left at their default value.
- The schedules of an entry go with it. A schedule ticked without its entry travels alone: on import it is added to the entry with the same id (so the entry needs an id).
- **What you export uses things left out**: when an exported entry runs another one (before, together, after, *enabled when*, the buttons of an alert) or uses a `${VARIABLE}` that is not ticked, the window lists them; **Include them** ticks them.
- **Include icons** (on by default) puts the icon files in the export. Without them, entries are exported without their icons.

**Export…** asks where to save. A single item without icons is saved as a `.json` file; anything more is a `.zip` file. Icons that cannot be found are left out, and you are told how many.

### What is inside

A zip holds `traycommand-export.json` and an `icons` folder. The JSON file looks like this:

```json
{
  "traycommandExport": 1,
  "app": "2.5.0",
  "created": "2026-11-21T10:30:00.000Z",
  "trays": [ { "id": "code", "label": "VS Code", "icon": "icons/code.png", "menu": [ … ] } ],
  "schedules": [ { "entry": "backup", "label": "Tools › Backup", "schedule": { "cron": "0 18 * * 1-5" } } ],
  "variables": { "WS": "${configDir}/workspaces" },
  "settings": { "theme": "dark" }
}
```

Trays and entries use the same format as the [configuration file](../reference/); `schedules` holds the schedules exported without their entry.

::: tip Secrets
An export contains your commands as they are written. If a script contains a password or a token, remove it before sharing the file (or keep it in an environment variable and use `${env:NAME}`).
:::

## Import

![Import window](/screens/import.png)

**Import…** opens a `.zip` or `.json` file: an export, a whole configuration file (`traycommand.json` from another PC), or a zip that contains one of them, also inside a folder (for example an export unzipped and zipped again). The icons of an export are taken only from the file itself (or the folder of a `.json` export); a configuration file may use icons anywhere on this PC. Icons on network paths are never opened.

Before anything changes, the window shows what the file contains and what will happen to each item:

| Shown as | Means | Proposed |
| --- | --- | --- |
| **new** | Nothing here has its id. | Added. |
| **already here** | The same entry is already here. | Left alone. |
| **already here, different** | An entry here has the same id. | See below. |
| **not imported** | The tray or menu it is in is not imported. | — |

For an entry already here but different, choose what to do:

- **Add to it** (trays and menus): keep the one here as it is and add the entries of the file to its menu. Each of them is shown on its own row, with its own choice. This is proposed when the file brings menu entries.
- **Replace it**: the one from the file takes its place, with its menu. Proposed when both have the same name.
- **Keep both**: the one from the file is added with a new id (shown, e.g. `→ notes_2`), with its whole menu; entries inside it whose id is taken get a new id too, and the one here is not touched. The other imported entries that refer to it follow the new id. Proposed when the names differ.

Entries with an **admin** badge run a command as administrator: read them before importing.

Untick anything you do not want. The other sections work the same way:

- **Shortcuts used twice**: when an imported entry has a shortcut already used here, the one here keeps it unless you choose to move it. A shortcut used by the launcher is never taken.
- **Schedules** exported alone are added to the entry with the same id; one that is already there is not added twice. If no entry has that id, it cannot be imported.
- **Variables**: new ones are added; a variable that exists here with another value keeps its value unless you tick it. A **secret** comes as a name only: after the import, give it your own value on the Variables page.
- **Settings**: the settings that differ are shown as *now → imported* and applied when ticked. **Allow administrator commands** and the **default shell** are never ticked for you, not even when you tick the whole section: tick them one by one after checking.

**Import** adds everything to the configuration and saves it (a [backup](./startup-and-updates#backups) of the previous file is kept, so you can undo it from **Settings → Backups**). Icons are copied into the `icons` folder next to the configuration file; an icon with the same name but different content gets a new name. If you have unsaved changes in the editor, they are saved together with the import.

If the result would not be valid, for example an imported entry runs one you left out, the window says which entry and why, and **Import** stays disabled until you change the choices.
