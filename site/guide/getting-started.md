# Getting started

TrayCommand puts icons in the system tray (the notification area) that run your shell commands: open apps, start and stop services, switch a proxy on and off, launch scripts. Everything lives in one JSON file that you edit with the built-in visual editor.

## Download

Get the latest version from the [releases page](https://github.com/CristianoCiuti/traycommand/releases/latest).

| System | File | How to start it |
| --- | --- | --- |
| Windows (x64) | `TrayCommand-<version>-win-x64.zip` | Extract the zip and run `TrayCommand.exe` from the extracted `TrayCommand` folder. |
| Windows (ARM) | `TrayCommand-<version>-win-arm64.zip` | Same as above. |
| Linux | `TrayCommand-<version>-linux-x86_64.AppImage` | `chmod +x` the file and run it. |
| macOS | `TrayCommand-<version>-mac-universal.zip` | Extract and drag `TrayCommand.app` into **Applications**. |

Every release also has a `SHA256SUMS` file to verify the downloads.

::: warning macOS: the app is not signed
The first time, right-click `TrayCommand.app` → **Open**, or remove the quarantine flag:

```sh
xattr -dr com.apple.quarantine /Applications/TrayCommand.app
```
:::

## First start

On Windows and Linux the first start shows a welcome page with two choices:

- **Install for this user** (recommended): copies TrayCommand to your user profile and restarts from there. No administrator rights are needed.
  - Windows: `%LOCALAPPDATA%\Programs\TrayCommand`, plus a **TrayCommand** shortcut in the Start menu.
  - Linux: `~/.local/share/TrayCommand/TrayCommand.AppImage`, plus a launcher in `~/.local/share/applications`.
- **Just run it from here**: nothing is copied. Updates and start at login use the current location, so keep the folder where it is.

On macOS, TrayCommand is "installed" once it is in the Applications folder.

::: tip
Installing for your user is what makes [automatic updates](./startup-and-updates#updates) and [start at login](./startup-and-updates#start-at-login) reliable: the app always lives in the same folder.
:::

The first time, TrayCommand creates a configuration file with a sample tray called **Hello TrayCommand**. On Windows it is `%APPDATA%\TrayCommand\traycommand.json`. You can use [another file](./startup-and-updates#configuration-file) at any time.

## Create your first tray

1. Click the TrayCommand icon in the tray and choose **Open TrayCommand**.
2. On the **Trays** page click **+** (New tray).
3. Give it a name (shown as tooltip) and an `id`, and pick an icon.
4. In the **Click** card click **Add action** and write a script, for example:

   ::: code-group
   ```powershell [Windows (PowerShell)]
   Start-Process notepad
   ```
   ```sh [Linux]
   xdg-open ~/notes.txt
   ```
   ```sh [macOS]
   open -a TextEdit
   ```
   :::

5. Click **Test** to run it right away and see exit code and output.
6. Press **Save** (or <kbd>Ctrl</kbd>+<kbd>S</kbd>). The new icon appears in the tray immediately.

The same tray in the configuration file:

```json
{
  "$schema": "https://cristianociuti.github.io/traycommand/schema/v2/config.schema.json",
  "version": 2,
  "trays": [
    { "id": "notepad", "label": "Notepad", "icon": "icons/notepad.png", "action": "Start-Process notepad" }
  ]
}
```

Next: learn the [concepts](./concepts) (menus, toggles, composed actions) or copy a [recipe](../recipes/).

## The TrayCommand menu

TrayCommand has its own tray icon. Its menu contains:

| Item | What it does |
| --- | --- |
| **Open TrayCommand** | Opens the editor. |
| **Show trays** | One check box per tray: show or hide it without deleting it. |
| **Running (n)** | Only while scripts are running: stop any of them. |
| **Install update x.y.z** | Only when an update is available. |
| **Edit configuration file** | Opens the JSON file in your default editor. Changes are picked up automatically. |
| **Reload configuration** | Reads the file again. |
| **Start at login** | Turns start at login on or off. |
| **Settings** | Opens the Settings page. |
| **Quit TrayCommand** | Stops TrayCommand and removes all its icons. |

::: tip Fewer icons
In **Settings → TrayCommand menu** you can put these items inside one of your trays (as a **TrayCommand** sub menu) instead of having a separate icon. See [`appMenu`](../reference/#settings).
:::

If the configuration file has an error, the TrayCommand icon is always shown and its menu starts with **Configuration error — open editor**. The invalid file is not applied: the trays keep working with the last valid configuration until you fix it.
