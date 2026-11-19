import fs from 'node:fs';
import path from 'node:path';
import { runScript } from './runner';

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Windows' own tar.exe by absolute path: a bare "tar" may be another tar on PATH (Git for
 * Windows puts GNU tar in usr/bin, which does not understand "C:\..." paths). Without it
 * (Windows older than 10 1803) PowerShell's Expand-Archive, slower but always there.
 */
export function windowsTar(env = process.env): string | undefined {
  const tar = path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(tar) ? tar : undefined;
}

export async function extractZipWindows(file: string, dir: string) {
  const tar = windowsTar();
  if (tar) {
    const r = await runScript(`& ${psq(tar)} -xf ${psq(file)} -C ${psq(dir)}`, { shell: 'powershell', timeout: 600 });
    if (r.code === 0) return r;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  return runScript(`Expand-Archive -LiteralPath ${psq(file)} -DestinationPath ${psq(dir)} -Force`, { shell: 'powershell', timeout: 600 });
}
