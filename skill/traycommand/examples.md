# TrayCommand patterns

Windows examples use the default shell (Windows PowerShell). Adapt the scripts for bash/zsh on Linux and macOS. Each snippet is one item of `trays` (or of a `menu`).

## Launcher with a menu

Left click runs the action, right click opens the menu. GUI programs are started with `Start-Process` so the entry does not stay busy.

```json
{
  "id": "apps",
  "label": "Apps",
  "icon": "icons/apps.png",
  "action": "Start-Process notepad",
  "menu": [
    { "label": "Calculator", "action": "Start-Process calc" },
    { "label": "Downloads", "action": "Start-Process explorer.exe 'shell:Downloads'" },
    { "separator": true },
    { "label": "Intranet", "action": "Start-Process https://intranet.example.com" }
  ]
}
```

## Menu only (no action)

```json
{
  "id": "code",
  "label": "VS Code",
  "icon": "icons/code.png",
  "menu": [
    { "label": "Web app", "action": "code \"${WS}/web.code-workspace\"" },
    { "label": "API", "action": "code \"${WS}/api.code-workspace\"" }
  ]
}
```

with `"variables": { "WS": "${env:USERPROFILE}/workspaces" }`.

## Toggle: Windows service (admin actions, non-admin check)

```json
{
  "id": "spooler",
  "label": "Print spooler",
  "icon": "icons/printer_on.png",
  "state": { "check": "(Get-Service Spooler).Status", "on": "^Running$", "interval": 10, "iconOff": "icons/printer_off.png" },
  "action": { "run": "Start-Service Spooler", "admin": true },
  "offAction": { "run": "Stop-Service Spooler", "admin": true, "confirm": "Stop the print spooler?" }
}
```

Requires `"allowAdminCommands": true` in `settings`.

## Toggle: process running

```json
{
  "id": "nginx",
  "label": "nginx",
  "icon": "icons/server_on.png",
  "state": { "check": "Get-Process nginx -ErrorAction Stop | Out-Null", "interval": 10, "iconOff": "icons/server_off.png" },
  "action": { "run": "Start-Process nginx -WorkingDirectory C:/nginx -WindowStyle Hidden", "notify": "nginx started" },
  "offAction": { "run": "C:/nginx/nginx.exe -p C:/nginx -s quit", "notify": "nginx stopped" },
  "menu": [
    { "label": "Reload configuration", "enabledWhen": "nginx", "action": "C:/nginx/nginx.exe -p C:/nginx -s reload" },
    { "label": "Error log", "action": { "run": "Get-Content C:/nginx/logs/error.log -Tail 50 -Wait", "terminal": true } }
  ]
}
```

The check fails (exit code ≠ 0) when the process does not exist → OFF.

## Toggle: Docker Compose stack

```json
{
  "id": "stack",
  "label": "Dev stack",
  "icon": "icons/docker_on.png",
  "state": { "check": "docker compose --project-directory ${STACK} ps --status running --quiet", "on": "\\S", "interval": 15, "iconOff": "icons/docker_off.png" },
  "action": { "run": "docker compose up -d", "cwd": "${STACK}", "timeout": 300, "notify": "Stack started" },
  "offAction": { "run": "docker compose down", "cwd": "${STACK}", "timeout": 120, "notify": "Stack stopped" }
}
```

`"on": "\\S"` = any output.

## Toggle: a setting in the registry (current user, no admin)

```json
{
  "id": "hidden_files",
  "label": "Show hidden files",
  "state": { "check": "(Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Explorer/Advanced').Hidden", "on": "^1$", "interval": 30 },
  "action": "Set-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Explorer/Advanced' Hidden 1",
  "offAction": "Set-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Explorer/Advanced' Hidden 0"
}
```

## Toggle: dark mode for apps

The value is inverted: `AppsUseLightTheme` = 0 means dark mode ON. A menu adds related commands (right click).

```json
{
  "id": "dark_mode",
  "label": "Dark mode",
  "icon": "icons/dark_on.png",
  "state": { "check": "(Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Themes/Personalize' -ErrorAction Stop).AppsUseLightTheme", "on": "^0$", "interval": 10, "iconOff": "icons/dark_off.png" },
  "action": "Set-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Themes/Personalize' AppsUseLightTheme 0 -Type DWord",
  "offAction": "Set-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Themes/Personalize' AppsUseLightTheme 1 -Type DWord",
  "menu": [
    { "label": "Also for Windows (taskbar)", "action": "Set-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Themes/Personalize' SystemUsesLightTheme 0 -Type DWord" },
    { "label": "Restart Explorer", "action": { "run": "Stop-Process -Name explorer -Force", "confirm": "Restart Windows Explorer? The taskbar disappears for a few seconds." } }
  ]
}
```

Icons: `make-icon.ps1 -Glyph moon -Color "#3949ab"` and `-Color "#9e9e9e"`. Windows restarts Explorer by itself after `Stop-Process`; tray icons (TrayCommand's too) disappear briefly.

## Toggle that drives others

Turning `proxy` on or off also switches `git_proxy` at the same time; `git_proxy` can still be switched alone from the menu.

```json
{
  "id": "proxy",
  "label": "Proxy",
  "icon": "icons/globe_on.png",
  "state": { "check": "(Get-ItemProperty '${INET}').ProxyEnable", "on": "^1$", "interval": 5, "iconOff": "icons/globe_off.png", "notify": { "on": true, "off": true } },
  "action": { "run": "Set-ItemProperty '${INET}' ProxyEnable 1", "parallel": ["git_proxy"] },
  "offAction": { "run": "Set-ItemProperty '${INET}' ProxyEnable 0", "parallel": ["git_proxy"] },
  "menu": [
    {
      "id": "git_proxy",
      "label": "Git proxy",
      "state": { "check": "git config --global --get http.proxy", "interval": 30 },
      "action": "git config --global http.proxy ${PROXY}",
      "offAction": "git config --global --unset http.proxy"
    }
  ]
}
```

with `"variables": { "INET": "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "PROXY": "http://proxy.example.com:8080" }`.

`git config --get` exits 1 when the key is missing → OFF.

## Sequence: run other entries first or after

```json
{ "label": "Restart all", "action": { "run": "echo restarting", "before": ["stack:off", "nginx:off"], "after": ["nginx:on", "stack:on"] } }
```

## Script in another shell

```json
{ "label": "Cleanup (bash)", "action": { "run": "rm -rf ~/tmp/cache/*", "shell": "bash" } }
```

```json
{ "label": "Old batch file", "action": { "run": "call C:/tools/build.bat", "shell": "cmd", "terminal": true } }
```

## Linux / macOS

```json
{
  "id": "vpn",
  "label": "VPN",
  "state": { "check": "nmcli -t -f NAME connection show --active", "on": "^office-vpn$", "interval": 10 },
  "action": "nmcli connection up office-vpn",
  "offAction": "nmcli connection down office-vpn"
}
```

```json
{ "label": "Open project", "action": "open -a 'Visual Studio Code' ~/projects/app" }
```

## Disabled or hidden entries

```json
{ "id": "old_tool", "label": "Old tool", "hidden": true, "action": "Start-Process C:/old/tool.exe" }
```

```json
{ "label": "Deploy (only with VPN on)", "enabledWhen": "vpn", "action": { "run": "./deploy.ps1", "cwd": "C:/projects/app", "confirm": "Deploy now?", "terminal": true } }
```

## Ask for values before running (form)

```json
{
  "label": "Check out branch…",
  "action": {
    "run": "git checkout $env:BRANCH",
    "cwd": "C:/projects/app",
    "notify": "Now on ${BRANCH}",
    "inputs": [{ "name": "BRANCH", "label": "Branch", "type": "select", "optionsCommand": "git branch --format=%(refname:short)" }]
  }
}
```

```json
{
  "label": "New ticket branch…",
  "action": {
    "run": "git switch -c \"feature/$env:TICKET-$env:SLUG\" $env:BASE",
    "cwd": "C:/projects/app",
    "inputs": [
      { "name": "TICKET", "label": "Ticket", "pattern": "[A-Z]+-\\d+", "placeholder": "ABC-123" },
      { "name": "SLUG", "label": "Short name", "placeholder": "login-page" },
      { "name": "BASE", "label": "From", "type": "select", "options": ["develop", "main"] }
    ]
  }
}
```

## Keyboard shortcuts

```json
{ "id": "terminal_here", "label": "Terminal in projects", "hotkey": "Ctrl+Alt+T", "action": "Start-Process wt -ArgumentList '-d', 'C:/projects'" }
```

A tray with only a menu and a shortcut: the shortcut opens the launcher on that menu.

```json
{ "id": "docker", "label": "Docker", "hotkey": "Ctrl+Alt+D", "menu": [ { "label": "Up", "action": "docker compose up -d" }, { "label": "Down", "action": "docker compose down" } ] }
```

## Schedules

```json
{
  "id": "vpn",
  "label": "VPN",
  "state": { "check": "(Get-VpnConnection -Name Work).ConnectionStatus", "on": "Connected", "interval": 15 },
  "action": "rasdial Work",
  "offAction": "rasdial Work /disconnect",
  "schedules": [{ "cron": "50 8 * * 1-5", "run": "on" }, { "cron": "0 19 * * 1-5", "run": "off" }]
}
```

```json
{
  "id": "report",
  "label": "Daily report",
  "hidden": true,
  "action": { "run": "./report.ps1 -Env $env:ENV", "cwd": "C:/tools", "inputs": [{ "name": "ENV", "type": "select", "options": ["dev", "prod"] }] },
  "schedules": [{ "cron": "0 7 * * 1-5", "values": { "ENV": "prod" } }, { "every": "4h", "values": { "ENV": "dev" } }]
}
```

## Folder watch

"When a PDF lands in Scans during office hours, move it to the archive with the date in the name":

```json
{
  "id": "archive-scans",
  "label": "Archive scans",
  "icon": "icons/folder.png",
  "hidden": true,
  "action": "Move-Item -LiteralPath $env:TC_FILE -Destination (Join-Path 'D:\\Archive' ((Get-Date -Format 'yyyy-MM-dd_') + $env:TC_FILE_NAME))",
  "schedules": [{ "watch": { "path": "${env:USERPROFILE}\\Scans", "files": "*.pdf", "existing": true }, "between": "08:00-19:00", "days": "mon-fri" }]
}
```

All the CSV files of an export at once, at night only:

```json
"schedules": [{ "watch": { "path": "\\\\server\\exports", "files": "*.csv", "batch": true, "settle": "10s" }, "between": "22:00-06:00" }]
```
