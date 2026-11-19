import { describe, expect, it } from 'vitest';
import { runScript, isSuccess } from '../../src/main/runner';
import { shellCommand } from '../../src/main/shell';

const win = process.platform === 'win32';
const shell = win ? 'powershell' : 'bash';

describe('shellCommand', () => {
  it('builds powershell without profile and with utf8 output', () => {
    const cmd = shellCommand('powershell', 'Get-Date', 'win32');
    expect(cmd.file).toBe('powershell.exe');
    expect(cmd.args).toContain('-NoProfile');
    expect(cmd.args.at(-1)).toMatch(/UTF8.*Get-Date$/);
  });
  it('supports custom shells', () => {
    expect(shellCommand({ command: 'node', args: ['-e'] }, 'console.log(1)')).toEqual({ file: 'node', args: ['-e', 'console.log(1)'] });
  });
});

describe('runScript (real shell)', () => {
  it('captures stdout and exit code 0', async () => {
    const r = await runScript('echo hello', { shell });
    expect(r.stdout).toBe('hello');
    expect(isSuccess(r)).toBe(true);
  });

  it('reports non-zero exit codes', async () => {
    const r = await runScript('exit 4', { shell });
    expect(r.code).toBe(4);
    expect(isSuccess(r)).toBe(false);
  });

  it('treats stderr output as information, not failure', async () => {
    const r = await runScript(win ? '[Console]::Error.WriteLine("warn"); echo ok' : 'echo warn 1>&2; echo ok', { shell });
    expect(r.stderr).toContain('warn');
    expect(isSuccess(r)).toBe(true);
  });

  it('kills the process on timeout', async () => {
    const r = await runScript(win ? 'Start-Sleep -Seconds 20' : 'sleep 20', { shell, timeout: 2 });
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(10000);
  });

  it('handles unicode output', async () => {
    const r = await runScript('echo "àèìòù ✓"', { shell });
    expect(r.stdout).toBe('àèìòù ✓');
  });

  it('passes env and cwd', async () => {
    const r = await runScript(win ? 'echo "$env:TC_TEST $((Get-Location).Path)"' : 'echo "$TC_TEST $PWD"', {
      shell,
      env: { TC_TEST: 'xyz' },
      cwd: process.cwd(),
    });
    expect(r.stdout).toContain('xyz');
    expect(r.stdout.toLowerCase()).toContain(process.cwd().toLowerCase());
  });
});
