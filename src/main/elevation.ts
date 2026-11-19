import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Shell } from '../shared/config';
import { runScript, type RunOptions, type RunResult, type Runner } from './runner';
import { shellCommand } from './shell';
import { APP_NAME } from './paths';
import { quoteWindowsArg } from './autostart';

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const UAC_CANCELLED = 'Administrator permission was not granted (UAC cancelled or blocked)';

/* =====================================================================
 * 1) Single commands as administrator: a UAC prompt on every run.
 *    No Task Scheduler, no services, no registry.
 * ===================================================================== */

/** PowerShell script that, once elevated, runs the command and stores output and exit code in `dir`. */
export function elevatedWrapper(shell: Shell, script: string, dir: string): { wrapper: string; files: Record<string, string> } {
  const out = path.join(dir, 'out.txt');
  const err = path.join(dir, 'err.txt');
  const code = path.join(dir, 'code.txt');
  const files: Record<string, string> = {};
  let exe: string;
  let args: string;
  if (shell === 'powershell' || shell === 'pwsh') {
    const inner = path.join(dir, 'command.ps1');
    files[inner] = `﻿$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8
${script}
`;
    exe = shell === 'powershell' ? 'powershell.exe' : 'pwsh.exe';
    args = `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${quoteWindowsArg(inner)}`;
  } else if (shell === 'cmd') {
    const inner = path.join(dir, 'command.cmd');
    files[inner] = `@echo off

chcp 65001 >nul

${script}

`;
    exe = 'cmd.exe';
    args = `/d /c ${quoteWindowsArg(inner)}`;
  } else {
    const cmd = shellCommand(shell, script, 'win32');
    exe = cmd.file;
    args = cmd.args.map(quoteWindowsArg).join(' ');
  }
  const wrapper = path.join(dir, 'elevated.ps1');
  files[wrapper] = `﻿$ErrorActionPreference='Continue'
try {
  $p = Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${psQuote(args)} -NoNewWindow -Wait -PassThru -RedirectStandardOutput ${psQuote(out)} -RedirectStandardError ${psQuote(err)}
  $c = $p.ExitCode
} catch {
  $_ | Out-String | Set-Content -Encoding UTF8 -Path ${psQuote(err)}
  $c = 1
}
Set-Content -Path ${psQuote(code)} -Value $c
`;
  return { wrapper, files };
}

export function createAdminRunner(platform: NodeJS.Platform = process.platform, run: Runner = runScript): Runner {
  if (platform === 'win32') {
    return async (script: string, options: RunOptions): Promise<RunResult> => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traycommand-admin-'));
      const started = Date.now();
      try {
        const { wrapper, files } = elevatedWrapper(options.shell, script, dir);
        for (const [file, content] of Object.entries(files)) fs.writeFileSync(file, content, 'utf8');
        const cwd = options.cwd ? `-WorkingDirectory ${psQuote(options.cwd)} ` : '';
        const launcher = `$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru ${cwd}-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(`"${wrapper}"`)}; exit $p.ExitCode`;
        const result = await run(launcher, { shell: 'powershell', timeout: options.timeout, label: options.label });
        const codeFile = path.join(dir, 'code.txt');
        if (!fs.existsSync(codeFile)) {
          return { ...result, code: null, error: result.error ?? UAC_CANCELLED, durationMs: Date.now() - started };
        }
        const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '').trimEnd() : '');
        return {
          code: Number.parseInt(read('code.txt'), 10),
          stdout: read('out.txt'),
          stderr: read('err.txt'),
          durationMs: Date.now() - started,
          timedOut: result.timedOut,
          killed: result.killed,
        };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
  }
  if (platform === 'darwin') {
    return (script, options) => {
      const cmd = shellCommand(options.shell, script, 'darwin');
      const line = [cmd.file, ...cmd.args].map(shQuote).join(' ');
      const apple = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return run(`do shell script "${apple}" with administrator privileges`, { ...options, shell: { command: 'osascript', args: ['-e'] } });
    };
  }
  return (script, options) => {
    const cmd = shellCommand(options.shell, script, 'linux');
    return run(cmd.args.at(-1) ?? script, { ...options, shell: { command: 'pkexec', args: [cmd.file, ...cmd.args.slice(0, -1)] } });
  };
}

/* =====================================================================
 * 2) OPT-IN "Start as administrator without prompt" (Windows only).
 *    Uses the Task Scheduler. It is never invoked unless the user enables it
 *    from Settings, after reading the risk warning and accepting the UAC prompt.
 * ===================================================================== */

export const ELEVATED_TASK_PATH = `\\${APP_NAME}\\`;
export const ELEVATED_TASK_NAME = 'StartElevated';

/** Elevated script that installs into Program Files and registers the logon task. */
export function enableElevatedScript(sourceDir: string, targetDir: string, user: string, startupLnk: string): string {
  const exe = path.win32.join(targetDir, `${APP_NAME}.exe`);
  return `$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path ${psQuote(targetDir)} | Out-Null
if ((Resolve-Path ${psQuote(sourceDir)}).Path -ne (Resolve-Path ${psQuote(targetDir)}).Path) {
  robocopy ${psQuote(sourceDir)} ${psQuote(targetDir)} /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copy failed ($LASTEXITCODE)" }
}
$action = New-ScheduledTaskAction -Execute ${psQuote(exe)} -Argument '--hidden' -WorkingDirectory ${psQuote(targetDir)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ${psQuote(user)}
$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskPath ${psQuote(ELEVATED_TASK_PATH)} -TaskName ${psQuote(ELEVATED_TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start TrayCommand as administrator at logon (enabled by the user in TrayCommand settings)' -Force | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath ${psQuote(startupLnk)}
exit 0
`;
}

/** Elevated script that removes the logon task (and the Program Files copy when not running from it). */
export function disableElevatedScript(targetDir: string, runningFromTarget: boolean): string {
  return `$ErrorActionPreference='Continue'
Unregister-ScheduledTask -TaskPath ${psQuote(ELEVATED_TASK_PATH)} -TaskName ${psQuote(ELEVATED_TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue
${runningFromTarget ? '' : `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath ${psQuote(targetDir)}`}
exit 0
`;
}

/** Runs a PowerShell script once with a UAC prompt. Resolves false if the user declines. */
export async function runElevatedOnce(script: string, run: Runner = runScript): Promise<{ ok: boolean; message?: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traycommand-setup-'));
  try {
    const file = path.join(dir, 'setup.ps1');
    const log = path.join(dir, 'setup.log');
    fs.writeFileSync(file, `\uFEFFtry {\n${script}\n} catch { $_ | Out-String | Set-Content -Path ${psQuote(log)}; exit 1 }\n`, 'utf8');
    const result = await run(
      `$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(`"${file}"`)}; exit $p.ExitCode`,
      { shell: 'powershell' },
    );
    if (result.code === 0) return { ok: true };
    const detail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : result.stderr || result.error;
    return { ok: false, message: result.code === null || /cancel/i.test(result.stderr) ? UAC_CANCELLED : detail || `Exit code ${result.code}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Starts the elevated task now (no UAC: the task already has the highest privileges). */
export function runElevatedTask(run: Runner = runScript) {
  return run(`schtasks /run /tn ${psQuote(`${ELEVATED_TASK_PATH.slice(1)}${ELEVATED_TASK_NAME}`)}`, { shell: 'powershell' });
}
