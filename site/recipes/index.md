# Recipes

Ready-made trays to copy into the `trays` array of your configuration (or paste into the **JSON** page of the editor). Adjust names, paths and icons. Windows examples use the default shell, PowerShell.

::: tip
Strings in JSON need `\\` for one backslash and `\"` for a double quote. Forward slashes (`C:/tools`) work in PowerShell too and are easier to read.
:::

## Open an app

A tray that opens an app on click, with a menu of related ones on right click.

```json
{
  "id": "apps",
  "label": "Apps",
  "icon": "icons/apps.png",
  "action": "Start-Process notepad",
  "menu": [
    { "label": "Calculator", "action": "Start-Process calc" },
    { "label": "Downloads folder", "action": "Start-Process \"$env:USERPROFILE/Downloads\"" },
    { "label": "Project site", "action": "Start-Process https://github.com/CristianoCiuti/traycommand" }
  ]
}
```

Because the tray has an `action`, left click opens Notepad and right click opens the menu.

## VS Code workspaces

Define the workspaces folder once as a variable and list each workspace. Without an `action`, a click on the tray opens the menu.

```json
{
  "variables": { "WS": "${env:USERPROFILE}/workspaces" },
  "trays": [
    {
      "id": "code",
      "label": "VS Code",
      "icon": "icons/code.png",
      "menu": [
        { "label": "Web app", "action": "code \"${WS}/web.code-workspace\"" },
        { "label": "API", "action": "code \"${WS}/api.code-workspace\"" },
        { "separator": true },
        { "label": "Open workspaces folder", "action": "Start-Process \"${WS}\"" }
      ]
    }
  ]
}
```

## Windows service toggle

Start and stop a Windows service, with the icon following its state. Starting and stopping services needs administrator rights, so the actions use `"admin": true` (one UAC prompt per click). Reading the state does not.

```json
{
  "id": "spooler",
  "label": "Print spooler",
  "icon": "icons/printer_on.png",
  "state": {
    "check": "(Get-Service Spooler).Status",
    "on": "^Running$",
    "interval": 10,
    "iconOff": "icons/printer_off.png"
  },
  "action": { "run": "Start-Service Spooler", "admin": true },
  "offAction": { "run": "Stop-Service Spooler", "admin": true, "confirm": "Stop the print spooler?" }
}
```

::: warning
Admin actions only run after enabling **Settings → Advanced → Allow commands as administrator** (`"allowAdminCommands": true` in `settings`). See [Administrator](../guide/administrator).
:::

## Docker Compose up / down

A toggle for a Compose project: ON while at least one container of the project is running. The project folder is a variable, used by the check and by the actions.

```json
{
  "variables": { "STACK": "C:/projects/dev-stack" },
  "trays": [
    {
      "id": "stack",
      "label": "Dev stack",
      "icon": "icons/docker_on.png",
      "state": {
        "check": "docker compose --project-directory ${STACK} ps --status running --quiet",
        "on": "\\S",
        "interval": 15,
        "iconOff": "icons/docker_off.png"
      },
      "action": { "run": "docker compose up -d", "cwd": "${STACK}", "timeout": 300, "notify": "Stack started" },
      "offAction": { "run": "docker compose down", "cwd": "${STACK}", "timeout": 120, "notify": "Stack stopped" },
      "menu": [
        { "label": "Logs", "action": { "run": "docker compose logs -f", "cwd": "${STACK}", "terminal": true } }
      ]
    }
  ]
}
```

`docker compose ps --quiet` prints one container id per line; `"on": "\\S"` means "any output", so an empty list is OFF. If Docker is not running the command fails, which is OFF too.

## System proxy with Git and npm

A **Proxy** toggle that switches the Windows system proxy (`ProxyEnable` in the registry, current user, no admin needed) and, at the same time, the Git and npm proxy toggles in its menu. Each child can also be switched on its own.

```json
{
  "variables": {
    "INET": "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    "PROXY": "http://proxy.example.com:8080"
  },
  "trays": [
    {
      "id": "proxy",
      "label": "Proxy",
      "icon": "icons/globe_on.png",
      "state": {
        "check": "(Get-ItemProperty '${INET}').ProxyEnable",
        "on": "^1$",
        "interval": 10,
        "iconOff": "icons/globe_off.png",
        "notify": { "on": "Proxy ON", "off": "Proxy OFF" }
      },
      "action": {
        "run": "Set-ItemProperty '${INET}' ProxyServer '${PROXY}'; Set-ItemProperty '${INET}' ProxyEnable 1",
        "parallel": ["git_proxy", "npm_proxy"]
      },
      "offAction": {
        "run": "Set-ItemProperty '${INET}' ProxyEnable 0",
        "parallel": ["git_proxy", "npm_proxy"]
      },
      "menu": [
        {
          "id": "git_proxy",
          "label": "Git proxy",
          "state": { "check": "git config --global --get http.proxy", "interval": 30 },
          "action": "git config --global http.proxy ${PROXY}; git config --global https.proxy ${PROXY}",
          "offAction": "git config --global --unset http.proxy; git config --global --unset https.proxy"
        },
        {
          "id": "npm_proxy",
          "label": "npm proxy",
          "state": { "check": "npm config get proxy", "on": "^https?://", "interval": 30 },
          "action": "npm config set proxy ${PROXY}; npm config set https-proxy ${PROXY}",
          "offAction": "npm config delete proxy; npm config delete https-proxy"
        }
      ]
    }
  ]
}
```

How it works:

- `git config --get` exits with code 1 when the value is not set, so the Git toggle is OFF without any pattern.
- `npm config get proxy` prints `null` when not set, hence the `on` pattern.
- `"parallel": ["git_proxy", "npm_proxy"]` in `action` runs the children's `action`; in `offAction` it runs their `offAction`.

## Restart a process (nginx)

Click to (re)start nginx; the **Stop** item is enabled only while nginx is running.

```json
{
  "id": "nginx",
  "label": "nginx",
  "icon": "icons/server_on.png",
  "state": {
    "check": "Get-Process nginx -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Id",
    "interval": 10,
    "iconOff": "icons/server_off.png"
  },
  "action": {
    "run": "Stop-Process -Name nginx -ErrorAction SilentlyContinue; Start-Process nginx.exe -WorkingDirectory C:/nginx -WindowStyle Hidden",
    "notify": "nginx (re)started"
  },
  "menu": [
    { "id": "nginx_stop", "label": "Stop", "enabledWhen": "nginx", "action": "Stop-Process -Name nginx" },
    { "label": "Reload configuration", "enabledWhen": "nginx", "action": { "run": "./nginx.exe -s reload", "cwd": "C:/nginx" } },
    { "separator": true },
    { "label": "Open error log", "action": "Start-Process notepad C:/nginx/logs/error.log" }
  ]
}
```

There is no `offAction`: clicking while ON runs `action` again, which restarts nginx. `Get-Process ... -ErrorAction Stop` fails (exit code ≠ 0, so OFF) when the process is not running.

## Long script in a visible terminal

For long or interactive scripts, show a terminal window that stays open at the end:

```json
{
  "id": "update_all",
  "label": "Update tools",
  "icon": "icons/update.png",
  "action": {
    "run": "winget upgrade --all; Write-Host 'Done. You can close this window.'",
    "terminal": true
  }
}
```

With `terminal` TrayCommand only knows whether the terminal was opened: the result of the script itself is visible in the window.

## Ask for confirmation

`confirm` shows a **Run / Cancel** dialog before running anything, including the composed actions:

```json
{
  "label": "Reset local database",
  "action": {
    "run": "docker compose down -v; docker compose up -d",
    "cwd": "C:/projects/dev-stack",
    "confirm": "This deletes all local data. Continue?",
    "notify": "Database reset"
  }
}
```

## Check out a branch (form with choices from git)

A menu entry that lists the branches of a repository and checks out the one you pick. Give the tray a shortcut and the whole thing is keyboard only: shortcut, arrows, <kbd>Enter</kbd>.

```json
{
  "label": "Check out branch…",
  "action": {
    "run": "git checkout $env:BRANCH",
    "cwd": "C:/projects/app",
    "notify": "Now on ${BRANCH}",
    "inputs": [
      {
        "name": "BRANCH",
        "label": "Branch",
        "type": "select",
        "optionsCommand": "git branch --format=%(refname:short)"
      }
    ]
  }
}
```

`$env:BRANCH` (instead of `${BRANCH}` in the script) keeps any character of the value safe.

## Deploy with a form

```json
{
  "id": "deploy",
  "label": "Deploy",
  "hotkey": "Ctrl+Alt+D",
  "action": {
    "run": "./deploy.ps1 -Branch $env:BRANCH -Target $env:TARGET -DryRun:$([bool]::Parse($env:DRY))",
    "cwd": "C:/projects/app",
    "confirm": "Deploy ${BRANCH} to ${TARGET}?",
    "inputs": [
      { "name": "BRANCH", "label": "Branch", "default": "main" },
      { "name": "TARGET", "label": "Environment", "type": "select", "options": ["dev", "test", { "value": "prod", "label": "Production" }] },
      { "name": "DRY", "label": "Dry run", "type": "checkbox", "default": true },
      { "name": "TICKET", "label": "Ticket", "pattern": "[A-Z]+-\\d+", "optional": true }
    ]
  }
}
```

## Every morning: start the VPN, open the day

```json
{
  "id": "vpn",
  "label": "VPN",
  "state": { "check": "(Get-VpnConnection -Name Work).ConnectionStatus", "on": "Connected", "interval": 15 },
  "action": "rasdial Work",
  "offAction": "rasdial Work /disconnect",
  "schedules": [
    { "cron": "50 8 * * 1-5", "run": "on" },
    { "cron": "0 19 * * 1-5", "run": "off" }
  ]
}
```

`"run": "on"` does nothing when the VPN is already connected.

## Clean up every few hours

A hidden tray that only exists for its schedule:

```json
{
  "id": "cleanup",
  "label": "Clean build folders",
  "hidden": true,
  "action": "Get-ChildItem C:/projects -Directory -Recurse -Filter node_modules -Depth 2 | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item -Recurse -Force",
  "schedules": [{ "every": "6h" }, { "startup": true }]
}
```

## When a file arrives: process it

Convert every new `.docx` dropped in a folder to PDF, during office hours only. The file is in `$env:TC_FILE`; runs happen one after the other.

```json
{
  "id": "to-pdf",
  "label": "Word to PDF",
  "hidden": true,
  "action": "soffice --headless --convert-to pdf --outdir \"$env:TC_FILE_DIR\\pdf\" \"$env:TC_FILE\"",
  "schedules": [
    {
      "watch": { "path": "${env:USERPROFILE}\\Documents\\To convert", "files": "[!~]*.docx", "existing": true },
      "between": "08:00-19:00",
      "days": "mon-fri"
    }
  ]
}
```

`[!~]*.docx` skips the `~$` lock files Word creates while a document is open. With `"existing": true` the files left in the folder overnight are converted when the window opens at 08:00. See [when files change](../guide/schedules#when-files-change).

## Timeout

Stop a script that hangs. After `timeout` seconds the process and its children are killed and an error is notified.

```json
{
  "label": "Ping gateway",
  "action": {
    "run": "Test-Connection 192.168.1.1 -Count 4 | Format-Table -AutoSize | Out-String",
    "timeout": 15,
    "notify": "Gateway reachable"
  }
}
```

Running scripts can also be stopped by hand from **Running** in the TrayCommand menu or from the Activity page.

## Linux and macOS with bash

On Linux and macOS the default shell is your login shell. Set `shell` explicitly when a script relies on bash features.

```json
{
  "id": "dev",
  "label": "Dev",
  "icon": "icons/terminal.png",
  "state": {
    "check": "systemctl --user is-active syncthing",
    "shell": "bash",
    "on": "^active$",
    "interval": 20
  },
  "action": { "run": "systemctl --user start syncthing", "shell": "bash", "notify": true },
  "offAction": { "run": "systemctl --user stop syncthing", "shell": "bash" },
  "menu": [
    { "label": "Home folder", "action": { "run": "xdg-open \"$HOME\"", "shell": "bash" } },
    { "label": "Disk usage", "action": { "run": "df -h; echo; du -sh ~/* 2>/dev/null | sort -h | tail", "shell": "bash", "terminal": true } },
    { "label": "Clean caches", "action": { "run": "rm -rf ~/.cache/thumbnails/*", "shell": "bash", "confirm": "Delete thumbnail cache?" } }
  ]
}
```

On macOS use `open` instead of `xdg-open`, and `brew services start|stop <name>` with `brew services list` as check for Homebrew services.

::: tip Linux tray clicks
On Linux the tray click always opens the menu: the toggle action appears as the first item (**Run Dev** / **Turn off Dev**). See [platforms](../guide/platforms#linux).
:::
