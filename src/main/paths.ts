import path from 'node:path';
import os from 'node:os';

export const APP_NAME = 'TrayCommand';
export const APP_ID = 'io.github.cristianociuti.traycommand';
export const REPO = 'CristianoCiuti/traycommand';
export const DOCS_URL = 'https://cristianociuti.github.io/traycommand/';

/** Per-user install folder (no admin rights needed). */
export function userInstallDir(platform = process.platform, env = process.env, home = os.homedir()): string {
  switch (platform) {
    case 'win32':
      return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', APP_NAME);
    case 'darwin':
      return path.join(home, 'Applications', `${APP_NAME}.app`);
    default:
      return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), APP_NAME);
  }
}

/** Install folder used by the opt-in "start as administrator" mode (Windows only). */
export function machineInstallDir(env = process.env): string {
  return path.join(env.ProgramFiles ?? 'C:\\Program Files', APP_NAME);
}

/** Executable to launch for a given install folder. */
export function installedExecutable(dir: string, platform = process.platform): string {
  switch (platform) {
    case 'win32':
      return path.join(dir, `${APP_NAME}.exe`);
    case 'darwin':
      return path.join(dir, 'Contents', 'MacOS', APP_NAME);
    default:
      return path.join(dir, `${APP_NAME}.AppImage`);
  }
}

/** Folder (or file, for AppImage / .app) that represents the running installation. */
export function currentInstallRoot(execPath = process.execPath, platform = process.platform, env = process.env): string {
  if (platform === 'linux' && env.APPIMAGE) return path.dirname(env.APPIMAGE);
  if (platform === 'darwin') {
    const idx = execPath.indexOf('.app/');
    if (idx > 0) return execPath.slice(0, idx + 4);
  }
  return path.dirname(execPath);
}

export function samePath(a: string, b: string, platform = process.platform): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return platform === 'win32' || platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}
