import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { disableElevatedScript, elevatedWrapper, enableElevatedScript } from '../../src/main/elevation';
import { runScript } from '../../src/main/runner';

const win = process.platform === 'win32';

describe('elevated command wrapper', () => {
  it.skipIf(!win)('captures stdout, stderr and exit code (run here without elevation)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-elev-'));
    const { wrapper, files } = elevatedWrapper('powershell', 'echo "àè ok"; [Console]::Error.WriteLine("warn"); exit 7', dir);
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(f, c, 'utf8');
    const r = await runScript(`& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${wrapper}'`, { shell: 'powershell' });
    expect(r.code).toBe(0);
    const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '').trim();
    expect(read('out.txt')).toContain('ok');
    expect(read('err.txt')).toContain('warn');
    expect(read('code.txt')).toBe('7');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!win)('works with cmd too', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-elev-'));
    const { wrapper, files } = elevatedWrapper('cmd', 'echo hi & exit /b 3', dir);
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(f, c, 'utf8');
    await runScript(`& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${wrapper}'`, { shell: 'powershell' });
    expect(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8')).toContain('hi');
    expect(fs.readFileSync(path.join(dir, 'code.txt'), 'utf8').replace(/^\uFEFF/, '').trim()).toBe('3');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('opt-in elevated start scripts (generated only, never executed in tests)', () => {
  it('registers a logon task with highest privileges pointing to Program Files', () => {
    const s = enableElevatedScript('C:\\Users\\me\\AppData\\Local\\Programs\\TrayCommand', 'C:\\Program Files\\TrayCommand', 'DOMAIN\\me', 'C:\\x\\TrayCommand.lnk');
    expect(s).toContain("-Execute 'C:\\Program Files\\TrayCommand\\TrayCommand.exe'");
    expect(s).toContain('-RunLevel Highest');
    expect(s).toContain('-AtLogOn');
    expect(s).toContain("Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath 'C:\\x\\TrayCommand.lnk'");
  });
  it('removes the task when disabled', () => {
    expect(disableElevatedScript('C:\\Program Files\\TrayCommand', true)).toContain('Unregister-ScheduledTask');
    expect(disableElevatedScript('C:\\Program Files\\TrayCommand', true)).not.toContain('Remove-Item -Recurse');
  });
});
