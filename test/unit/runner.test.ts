import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { runScript, isSuccess } from '../../src/main/runner';
import { escapeForOuterCmd, isCmdExe, shellCommand, terminalCommand } from '../../src/main/shell';

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
  it('passes cmd scripts verbatim inside one pair of quotes (cmd.exe does not understand \\")', () => {
    expect(shellCommand('cmd', 'if exist "C:\\a b" echo si', 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"if exist "C:\\a b" echo si"'],
      verbatim: true,
    });
  });
  it('treats a custom shell that is cmd.exe like cmd, on Windows only', () => {
    expect(isCmdExe('cmd')).toBe(true);
    expect(isCmdExe('C:\\Windows\\System32\\CMD.EXE')).toBe(true);
    expect(isCmdExe('C:/Windows/System32/cmd')).toBe(true);
    expect(isCmdExe('cmdx.exe')).toBe(false);
    expect(shellCommand({ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c'] }, 'echo "x"', 'win32')).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', '"echo "x""'],
      verbatim: true,
    });
    expect(shellCommand({ command: 'cmd', args: ['/c'] }, 'echo 1', 'linux')).toEqual({ file: 'cmd', args: ['/c', 'echo 1'] });
  });
  it('escapes for an outer cmd only what is inside the quotes of the script', () => {
    expect(escapeForOuterCmd('echo "a & b (c)" & echo (d) > x')).toBe('echo "a ^& b ^(c^)" & echo (d) > x');
    expect(escapeForOuterCmd('echo "^" ^')).toBe('echo "^^" ^');
  });
  it('opens cmd in a terminal with the script verbatim', () => {
    expect(terminalCommand('cmd', 'type "a b" & pause', 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"start "" cmd.exe /d /s /k "type "a b" & pause""'],
      verbatim: true,
    });
  });
});

describe.runIf(win)('cmd scripts with quotes (real cmd.exe)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc cmd quotes '));
  const flag = path.join(dir, 'Mario Rossi', 'x.flag');
  fs.mkdirSync(path.dirname(flag));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes and checks quoted paths with spaces', async () => {
    const write = await runScript(`type nul > "${flag}"`, { shell: 'cmd' });
    expect(write.stderr).toBe('');
    expect(isSuccess(write)).toBe(true);
    expect(fs.existsSync(flag)).toBe(true);
    const check = await runScript(`if exist "${flag}" (echo si) else (echo no)`, { shell: 'cmd' });
    expect(check.stdout).toBe('si');
    const missing = await runScript(`if exist "${path.join(dir, 'nope')}" (echo si) else (echo no)`, { shell: 'cmd' });
    expect(missing.stdout).toBe('no');
  });

  it('keeps &, &&, || and parentheses as cmd operators, and literal inside quotes', async () => {
    const r = await runScript('echo one & (echo two && echo "a & b | (c)") || echo never', { shell: 'cmd' });
    expect(r.stdout.split(/\r?\n/).map((l) => l.trim())).toEqual(['one', 'two', '"a & b | (c)"']);
  });

  it('captures output and exit codes', async () => {
    const r = await runScript(`echo out & echo err 1>&2 & dir /b "${path.dirname(flag)}" & exit /b 3`, { shell: 'cmd' });
    expect(r.stdout.split(/\r?\n/).map((l) => l.trim())).toEqual(['out', 'x.flag']);
    expect(r.stderr.trim()).toBe('err');
    expect(r.code).toBe(3);
  });

  it('runs quoted programs with spaces in their path', async () => {
    const r = await runScript(`"${process.execPath}" -e "console.log(process.argv[1])" "a b"`, { shell: 'cmd' });
    expect(r.stdout).toBe('a b');
  });

  it('works with a custom shell pointing at cmd.exe', async () => {
    const r = await runScript(`if exist "${flag}" (echo si) else (echo no)`, { shell: { command: 'cmd.exe', args: ['/d', '/c'] } });
    expect(r.stdout).toBe('si');
  });

  it('builds a terminal line that the outer cmd passes on unchanged', () => {
    // same line as the terminal, with "cmd.exe /c" instead of "start cmd.exe /k" so it runs here without opening a window
    const t = terminalCommand('cmd', `if exist "${flag}" (echo "si & (ok)") else (echo no)`, 'win32');
    const line = t.args.at(-1)!.replace('"start "" cmd.exe /d /s /k', '"cmd.exe /d /s /c');
    const r = spawnSync(t.file, [...t.args.slice(0, -1), line], { windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true });
    expect(r.stdout.trim()).toBe('"si & (ok)"');
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
