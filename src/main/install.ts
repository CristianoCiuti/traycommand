import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ID, APP_NAME, currentInstallRoot, installedExecutable, machineInstallDir, samePath, userInstallDir } from './paths';
import type { ShortcutSpec } from './autostart';

/*
 * Per-user installation without installer and without admin rights
 * : the app copies itself to
 *   Windows: %LOCALAPPDATA%\Programs\TrayCommand  (+ Start menu shortcut)
 *   Linux:   ~/.local/share/TrayCommand/TrayCommand.AppImage (+ .desktop launcher)
 * On macOS the user drags TrayCommand.app to Applications as usual.
 */

export function isInstalled(execPath = process.execPath, platform = process.platform, env = process.env): boolean {
  const root = currentInstallRoot(execPath, platform, env);
  if (platform === 'darwin') return /\/Applications\//.test(root);
  return samePath(root, userInstallDir(platform, env), platform) || (platform === 'win32' && samePath(root, machineInstallDir(env), platform));
}

export function startMenuShortcut(env = process.env, home = os.homedir()): string {
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`);
}

export interface InstallResult {
  ok: boolean;
  executable?: string;
  message?: string;
}

export function installForUser(writeShortcut: (file: string, spec: ShortcutSpec) => boolean, execPath = process.execPath, platform = process.platform, env = process.env): InstallResult {
  try {
    if (platform === 'darwin') return { ok: false, message: 'On macOS, drag TrayCommand.app into the Applications folder.' };
    const target = userInstallDir(platform, env);
    if (platform === 'win32') {
      const source = currentInstallRoot(execPath, platform, env);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.rmSync(`${target}.new`, { recursive: true, force: true });
      fs.cpSync(source, `${target}.new`, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(`${target}.new`, target);
      const exe = installedExecutable(target, platform);
      writeShortcut(startMenuShortcut(env), {
        target: exe,
        args: '',
        cwd: target,
        description: 'Run commands from the tray',
        icon: exe,
        appUserModelId: APP_ID,
      });
      return { ok: true, executable: exe };
    }
    const appImage = env.APPIMAGE;
    if (!appImage) return { ok: false, message: 'Not running from an AppImage.' };
    fs.mkdirSync(target, { recursive: true });
    const exe = installedExecutable(target, platform);
    fs.copyFileSync(appImage, exe);
    fs.chmodSync(exe, 0o755);
    const apps = path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'applications');
    fs.mkdirSync(apps, { recursive: true });
    fs.writeFileSync(
      path.join(apps, 'traycommand.desktop'),
      `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nComment=Run commands from the tray\nExec="${exe}"\nIcon=traycommand\nTerminal=false\nCategories=Utility;\n`,
    );
    return { ok: true, executable: exe };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
