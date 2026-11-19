import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ID, APP_NAME } from './paths';

/*
 * Start at login WITHOUT Task Scheduler and WITHOUT registry Run keys:
 *  - Windows: a shortcut in the user's Startup folder (shell:startup)
 *  - Linux:   ~/.config/autostart/traycommand.desktop
 *  - macOS:   ~/Library/LaunchAgents/<id>.plist
 * Same approach as bbpm-sync-app. No Electron import here, so it can be unit tested.
 */

export interface ShortcutSpec {
  target: string;
  args: string;
  cwd: string;
  description: string;
  icon: string;
  appUserModelId: string;
}

export interface AutostartEnv {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  /** Writes a Windows .lnk (Electron shell.writeShortcutLink). */
  writeShortcut: (file: string, spec: ShortcutSpec) => boolean;
}

export interface LaunchTarget {
  command: string;
  args: string[];
  cwd: string;
}

export function defaultAutostartEnv(writeShortcut: AutostartEnv['writeShortcut']): AutostartEnv {
  return { platform: process.platform, home: os.homedir(), appData: process.env.APPDATA, writeShortcut };
}

export function startupFolder(env: Pick<AutostartEnv, 'appData' | 'home'>): string {
  const appData = env.appData ?? path.join(env.home, 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function autostartFile(env: AutostartEnv): string {
  switch (env.platform) {
    case 'win32':
      return path.join(startupFolder(env), `${APP_NAME}.lnk`);
    case 'darwin':
      return path.join(env.home, 'Library', 'LaunchAgents', `${APP_ID}.plist`);
    default:
      return path.join(env.home, '.config', 'autostart', 'traycommand.desktop');
  }
}

/** Quotes one argument following the CommandLineToArgvW rules. */
export function quoteWindowsArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desktopQuote = (s: string) => (/[\s"\\$`]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);

export function isAutostartEnabled(env: AutostartEnv): boolean {
  return fs.existsSync(autostartFile(env));
}

export function enableAutostart(env: AutostartEnv, target: LaunchTarget): void {
  const file = autostartFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  switch (env.platform) {
    case 'win32': {
      const ok = env.writeShortcut(file, {
        target: target.command,
        args: target.args.map(quoteWindowsArg).join(' '),
        cwd: target.cwd,
        description: `${APP_NAME} - run commands from the tray`,
        icon: target.command,
        appUserModelId: APP_ID,
      });
      if (!ok) throw new Error(`Cannot write ${file}`);
      return;
    }
    case 'darwin': {
      const args = [target.command, ...target.args].map((a) => `    <string>${xml(a)}</string>`).join('\n');
      fs.writeFileSync(
        file,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${APP_ID}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xml(target.cwd)}</string>
</dict>
</plist>
`,
      );
      return;
    }
    default:
      fs.writeFileSync(
        file,
        `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Run commands from the tray
Exec=${[target.command, ...target.args].map(desktopQuote).join(' ')}
Path=${target.cwd}
Terminal=false
X-GNOME-Autostart-enabled=true
`,
      );
  }
}

/** Removes the autostart entry, retrying briefly if the file is locked (e.g. by antivirus). */
export function disableAutostart(env: AutostartEnv): void {
  const file = autostartFile(env);
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '') || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/** Makes the autostart entry match the desired state, pointing to the current executable. */
export function syncAutostart(env: AutostartEnv, wanted: boolean, target: LaunchTarget): void {
  if (wanted) enableAutostart(env, target);
  else if (isAutostartEnabled(env)) disableAutostart(env);
}
