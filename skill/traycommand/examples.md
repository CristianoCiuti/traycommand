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
    { "label": "Downloads", "action": "Start-Process \"$env:USERPROFILE/Downloads\"" },
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
