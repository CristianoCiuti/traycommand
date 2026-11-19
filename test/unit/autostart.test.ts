import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { autostartFile, disableAutostart, enableAutostart, isAutostartEnabled, quoteWindowsArg, syncAutostart, type AutostartEnv, type ShortcutSpec } from '../../src/main/autostart';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-autostart-'));
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function env(platform: NodeJS.Platform, written: { file?: string; spec?: ShortcutSpec } = {}): AutostartEnv {
  return {
    platform,
    home: tmp,
    appData: path.join(tmp, 'Roaming'),
    writeShortcut: (file, spec) => {
      written.file = file;
      written.spec = spec;
      fs.writeFileSync(file, 'lnk');
      return true;
    },
  };
}

const target = { command: 'C:\\Users\\me\\AppData\\Local\\Programs\\TrayCommand\\TrayCommand.exe', args: ['--hidden', '--config=C:\\My Docs\\tc.json'], cwd: 'C:\\x' };

describe('autostart', () => {
  it('uses the Startup folder on Windows, never the registry or scheduler', () => {
    const written: { file?: string; spec?: ShortcutSpec } = {};
    const e = env('win32', written);
    expect(autostartFile(e)).toBe(path.join(tmp, 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'TrayCommand.lnk'));
    enableAutostart(e, target);
    expect(isAutostartEnabled(e)).toBe(true);
    expect(written.spec?.args).toBe('--hidden "--config=C:\\My Docs\\tc.json"');
    expect(written.spec?.target).toBe(target.command);
    disableAutostart(e);
    expect(isAutostartEnabled(e)).toBe(false);
  });

  it('writes a .desktop file on Linux and a LaunchAgent on macOS', () => {
    const linux = env('linux');
    enableAutostart(linux, { command: '/opt/TrayCommand.AppImage', args: ['--hidden'], cwd: '/tmp' });
    expect(fs.readFileSync(autostartFile(linux), 'utf8')).toContain('Exec=/opt/TrayCommand.AppImage --hidden');
    const mac = env('darwin');
    enableAutostart(mac, { command: '/Apps/TrayCommand', args: ['--hidden'], cwd: '/' });
    expect(fs.readFileSync(autostartFile(mac), 'utf8')).toContain('<string>--hidden</string>');
  });

  it('sync removes the entry when not wanted', () => {
    const e = env('linux');
    syncAutostart(e, true, { command: '/a', args: [], cwd: '/' });
    expect(isAutostartEnabled(e)).toBe(true);
    syncAutostart(e, false, { command: '/a', args: [], cwd: '/' });
    expect(isAutostartEnabled(e)).toBe(false);
  });

  it('quotes arguments like CommandLineToArgvW', () => {
    expect(quoteWindowsArg('simple')).toBe('simple');
    expect(quoteWindowsArg('with space')).toBe('"with space"');
    expect(quoteWindowsArg('C:\\dir\\')).toBe('C:\\dir\\');
    expect(quoteWindowsArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg('')).toBe('""');
  });
});
