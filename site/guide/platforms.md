# Windows, Linux, macOS

The configuration format is the same everywhere; scripts and some tray behaviours differ.

## Default shell

| System | Default shell | How it runs |
| --- | --- | --- |
| Windows | `powershell` (Windows PowerShell 5.1) | `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <script>`, output in UTF-8 |
| Linux | `$SHELL` if it is bash, zsh or sh, otherwise `bash` | `bash -lc <script>` (login shell) |
| macOS | `$SHELL` if it is bash, zsh or sh, otherwise `zsh` | `zsh -lc <script>` (login shell) |

Change it for everything with `settings.shell`, or per action / state check with `shell`:

| Value | Runs |
| --- | --- |
| `"powershell"` | `powershell.exe` with the options above (your profile is **not** loaded). |
| `"pwsh"` | PowerShell 7 (`pwsh`), same options. |
| `"cmd"` | `cmd.exe /d /s /c <script>` |
| `"bash"`, `"zsh"` | Login shell (`-lc`), so the `PATH` from your profile is available. On Windows `bash` is `bash.exe` (Git Bash or WSL, whichever is first in `PATH`). |
| `"sh"` | `sh -c <script>` |
| `{ "command": "node", "args": ["-e"] }` | Any executable: the script is appended as the last argument. |

```json
"settings": { "shell": { "command": "python", "args": ["-c"] } }
```

### Visible terminal

With `"terminal": true` the script runs in a visible window that stays open after it ends (useful for long or interactive scripts): a new console on Windows, **Terminal.app** on macOS, `x-terminal-emulator` on Linux. The exit code is that of the terminal launcher, not of your script.

## Windows

- Left click runs the tray's action; with no action it opens the menu. Right click runs `rightAction`, otherwise opens the menu.
- Left or right click on the TrayCommand icon opens its menu.
- Windows may hide new icons in the overflow area (^). Drag them to the taskbar, or turn them on in **Settings → Personalization → Taskbar → Other system tray icons**.
- Data folder: `%APPDATA%\TrayCommand`. Install folder: `%LOCALAPPDATA%\Programs\TrayCommand`.

## Linux

::: warning Tray clicks
On most Linux desktops tray icons cannot receive clicks: a click always opens the menu. TrayCommand therefore adds the click actions as the **first items** of the tray menu:

- **Run &lt;label&gt;** (or **Turn off &lt;label&gt;** for a toggle that is ON) for `action` / `offAction`,
- **&lt;label&gt; (alternate)** for `rightAction`,

followed by a separator and the normal menu.
:::

- GNOME needs the *AppIndicator and KStatusNotifierItem Support* extension to show tray icons.
- Global shortcuts work on X11. Wayland does not allow them: bind a key of your desktop to `traycommand --launcher` or `traycommand --run=<id>` (see [launcher](./launcher)).
- The AppImage may need FUSE (`libfuse2`) on recent distributions.
- Admin actions use `pkexec`.
- Data folder: `~/.config/TrayCommand`.

## macOS

- When a tray has a **menu and no action**, a click opens the menu. When it has an action, a click runs it and right click (or <kbd>Ctrl</kbd>+click) opens the menu.
- TrayCommand does not show a Dock icon.
- Admin actions show the standard administrator password dialog.
- Data folder: `~/Library/Application Support/TrayCommand`.

::: warning Unsigned app
TrayCommand is not signed with an Apple Developer ID, so Gatekeeper blocks the first start. Right-click `TrayCommand.app` → **Open** → **Open**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/TrayCommand.app
```
:::

## Writing portable scripts

If you share one configuration file between systems, set the shell explicitly where it matters and keep platform-specific trays [hidden](./concepts#hidden-vs-disabled) on the systems where they do not apply. Paths with forward slashes (`C:/tools/app.exe`) work in PowerShell and in the configuration file.
