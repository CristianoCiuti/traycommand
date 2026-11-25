# AI assistants

TrayCommand can teach [Claude Code](https://claude.com/claude-code) and [OpenCode](https://opencode.ai) how to create and change your trays. Once the **TrayCommand skill** is installed, ask the agent in plain words:

> add a tray that starts and stops my Docker stack in C:\projects\dev-stack, with a green icon when it is running

> put "Open logs" in the menu of the Web server tray

> hide the VPN tray

The agent finds your configuration file, writes and tests the scripts, creates icons if needed, validates the result and saves it. TrayCommand applies the change right away; you can review it in the editor.

## Install the skill

When TrayCommand finds Claude Code or OpenCode on your PC (their user folder, or the `claude` / `opencode` command), it proposes the skill:

- a bar at the top of the editor: **Install**, **Not now** (asks again at the next start), **Don't ask again**;
- if TrayCommand starts hidden, one notification per version; click it to open the settings.

You can also manage it at any time from **Settings → AI assistants**: install, update, open the folder or remove it for each agent.

| Agent | Skill folder |
| --- | --- |
| Claude Code | `~/.claude/skills/traycommand` |
| OpenCode | `~/.config/opencode/skills/traycommand` |

(`~` is your user folder, `%USERPROFILE%` on Windows.) Only that folder is written: no other file of the agent is changed.

## Updates

The skill ships with TrayCommand and contains the paths of this PC (the TrayCommand executable and its data folder). When a new version of TrayCommand brings a newer skill, or TrayCommand moved:

- **Update automatically** (default, `"skillUpdates": "auto"` in [settings](../reference/#settings)): the skill is replaced at the next start, with a notification;
- **Ask me first** (`"ask"`): the bar at the top of the editor proposes the update.

A new version of TrayCommand whose skill is the same as the installed one changes nothing and shows no notification.

If you edited the skill files yourself, TrayCommand never replaces them silently: it asks first and tells you that your changes will be lost.

Removing the skill from **Settings** also stops TrayCommand from proposing it again for that agent; **Install** brings it back.

## What the skill contains

| File | Content |
| --- | --- |
| `SKILL.md` | What TrayCommand is and the procedure: find the configuration, choose action or toggle, test the scripts, back up, edit, validate, report. |
| `reference.md` | Every property of the [configuration file](../reference/). |
| `examples.md` | Common patterns: launchers, menus, toggles for services, processes, Docker, registry, Linux and macOS. |
| `scripts/make-icon.ps1` | Windows: creates a PNG icon, a coloured square or circle with a pictogram (printer, globe, cloud, play, lock…) or up to 3 letters. |

The agent uses the [command line options](../reference/cli#tools-for-scripts-and-ai-agents) of TrayCommand: `--info` to find the configuration file, `--validate` to check it before you see it, `--export` / `--import` to share trays or bring them in when you ask, `--update` to check for a new version.

## Safety

- The agent edits only the configuration file, after copying it into the `backups` folder (restore it from **Settings → Backups**).
- Scripts are tested by the agent only when they are harmless or after asking you.
- A broken file is never applied: TrayCommand keeps the previous configuration and shows the error.
- Administrator actions still need **Allow commands as administrator** and a UAC prompt on every run.
