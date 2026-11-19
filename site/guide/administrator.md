# Administrator

TrayCommand runs as a normal user. Two separate features deal with administrator rights:

| | Run as administrator (per action) | Start as administrator without prompt |
| --- | --- | --- |
| Scope | Single actions marked `"admin": true` | The whole app, every login |
| Prompt | UAC prompt **at every run** | One UAC prompt when you enable it |
| Systems | Windows, macOS, Linux | Windows only |
| Uses the Task Scheduler | No | **Yes** |
| Recommended | Yes, when you need it | Only on a PC you fully control |

## Run as administrator

Mark an action with `"admin": true` to run it elevated:

```json
{
  "label": "Restart print spooler",
  "action": { "run": "Restart-Service Spooler", "admin": true, "notify": true }
}
```

1. Enable **Settings → Advanced → Allow commands as administrator** (`"allowAdminCommands": true`). While it is off, admin actions fail with a notification instead of running.
2. In the editor, switch on **Run as administrator** in the action options.

Every time the action runs, the system asks for permission:

- **Windows**: the UAC prompt. The output and the exit code are captured as usual, so notifications, the Activity page and the toggle state work normally. Cancelling the prompt is reported as an error.
- **macOS**: the administrator password dialog (`osascript ... with administrator privileges`).
- **Linux**: `pkexec`.

`admin` is not available for state checks: they run every few seconds and would prompt each time. Most state checks do not need it anyway (for example `Get-Service` works without elevation). See the [service recipe](../recipes/#windows-service-toggle).

::: tip
No Task Scheduler, services or registry are involved: each run is a regular elevation request.
:::

## Start as administrator without prompt

On Windows you can make TrayCommand itself start elevated at login, so that **all** its actions run as administrator without any UAC prompt. This is opt-in and off by default.

::: danger Read this before enabling it
This creates a task in the **Windows Task Scheduler** that starts a program **with the highest privileges at every logon**, without asking. Antivirus and corporate security software (EDR) commonly treat this pattern (persistence plus privilege elevation) as **malicious behaviour**. They may:

- block or **quarantine** TrayCommand,
- raise an alert and **report your PC to the IT/security department**,
- in managed environments, trigger an investigation.

**Do not enable it on a company-managed PC**, or if you are not absolutely sure you are allowed to. Prefer [Run as administrator](#run-as-administrator) on the few actions that need it.
:::

### Enabling it

**Settings → Advanced → Start as administrator without prompt → Enable…** shows the warning above; you must tick **I understand the risks** and click **Continue at your own risk**. Then, after **one** UAC prompt, TrayCommand:

1. copies itself to `C:\Program Files\TrayCommand`, a folder normal programs cannot modify (so the elevated executable cannot be replaced by something else);
2. registers the task `\TrayCommand\StartElevated`: at logon of your user, run `C:\Program Files\TrayCommand\TrayCommand.exe --hidden` with highest privileges;
3. removes the normal Startup shortcut, since the task replaces it.

The setting is stored in `state.json` on that PC only, never in the configuration file, so a shared or edited configuration cannot turn it on. **Restart as administrator** starts the task immediately.

While this mode is **off**, TrayCommand never reads, creates or changes anything in the Task Scheduler.

### Turning it off

**Settings → Advanced → Start as administrator without prompt → Turn off**. After one UAC prompt TrayCommand deletes the task and the copy in `C:\Program Files\TrayCommand` (if it is not running from there), then restores the normal [start at login](./startup-and-updates#start-at-login) shortcut if that setting is on.

If TrayCommand is no longer available (for example it was quarantined), remove the task by hand from an elevated PowerShell:

```powershell
Unregister-ScheduledTask -TaskPath '\TrayCommand\' -TaskName 'StartElevated' -Confirm:$false
Remove-Item -Recurse -Force 'C:\Program Files\TrayCommand'
```
