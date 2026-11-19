# Start at login and updates

## Start at login

Turn it on from **Settings → General → Start at login**, from the **Start at login** item of the TrayCommand menu, or with `"autostart": true` in the settings. TrayCommand then starts hidden (`--hidden`) when you log in.

It uses the plain, per-user mechanism of each system:

| System | What is created |
| --- | --- |
| Windows | A shortcut `TrayCommand.lnk` in your Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`, open it with <kbd>Win</kbd>+<kbd>R</kbd> → `shell:startup`). |
| Linux | `~/.config/autostart/traycommand.desktop` |
| macOS | `~/Library/LaunchAgents/io.github.cristianociuti.traycommand.plist` |

::: tip No Task Scheduler, no registry
Start at login never uses the Windows Task Scheduler, never writes `Run` keys in the registry and never needs administrator rights. You can see and delete the shortcut yourself, and Windows lists it under **Task Manager → Startup apps**.

The only feature that uses the Task Scheduler is the opt-in [Start as administrator without prompt](./administrator#start-as-administrator-without-prompt), which is off unless you enable it.
:::

The entry always points to the executable that is running, so [install for your user](./getting-started#first-start) first. When you turn the setting off, the file is removed.

If the configuration file is shared between PCs, `autostart` is applied on every PC that uses it.

## Updates

When **Check for updates automatically** is on (the default, `"checkUpdates": true`), TrayCommand checks the [GitHub releases](https://github.com/CristianoCiuti/traycommand/releases) shortly after starting and then every 6 hours. When a newer version exists:

- **Install update x.y.z** appears in the TrayCommand menu, and **Install** on the Settings page.
- Nothing is installed until you click it.

Installing an update:

1. Downloads the file for your system into the `update` folder of the [data folder](../reference/cli#data-folder).
2. Downloads `SHA256SUMS` from the same release and verifies the **SHA-256** checksum. A release without checksums, or a mismatch, is refused.
3. Quits TrayCommand and lets a small helper replace the install folder (Windows), the `.app` (macOS) or the AppImage (Linux). The old version is moved aside first and **put back if the replacement fails**.
4. Relaunches TrayCommand, which shows "Updated to version x.y.z" (or why it failed).

**Check now** on the Settings page checks immediately. Development builds never update themselves.

::: warning
The updater replaces the folder TrayCommand runs from. If you run it from a folder you do not own (or from a read-only location) the update fails: install it for your user.
:::

## Configuration file

TrayCommand uses, in this order:

1. the `--config=<file>` [command line option](../reference/cli),
2. the `TRAYCOMMAND_CONFIG` environment variable,
3. the file chosen in **Settings → Configuration file → Use another file…**,
4. `traycommand.json` in the data folder: `%APPDATA%\TrayCommand\traycommand.json` on Windows, `~/.config/TrayCommand/traycommand.json` on Linux, `~/Library/Application Support/TrayCommand/traycommand.json` on macOS.

The choice made in Settings is stored in `state.json` of the data folder, so **each PC can point to a different file**. If the file does not exist, a starter file is created.

TrayCommand watches the file: when it changes on disk (another editor, a sync tool) it is reloaded within about a second.

### Synced folders (OneDrive, Dropbox…)

To use the same trays on several PCs, put the configuration file and its icons in a synced folder and select it on each PC with **Use another file…**. Use relative paths for icons and `${configDir}` in scripts, so they work wherever the folder is synced:

```json
{ "label": "Backup", "icon": "icons/backup.png", "action": "& \"${configDir}/scripts/backup.ps1\"" }
```

Use `${env:USERPROFILE}` / `${env:HOME}` for paths that differ per user.

## Backups

Before every save from the editor, the current file is copied to `backups/` in the data folder as `traycommand-<date-time>.json`. The newest **30** are kept. Restore one from **Settings → Backups → Restore** (this also makes a backup of the current file first).
