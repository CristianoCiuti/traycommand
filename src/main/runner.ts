import { spawn, type ChildProcess } from 'node:child_process';
import type { Shell } from '../shared/config';
import { shellCommand, terminalCommand } from './shell';

export interface RunOptions {
  shell: Shell;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // seconds
  terminal?: boolean;
  label?: string;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  error?: string;
}

export interface RunningProcess {
  id: number;
  label: string;
  script: string;
  startedAt: number;
  kill: () => void;
}

const MAX_OUTPUT = 256 * 1024;

export type Runner = (script: string, options: RunOptions) => Promise<RunResult>;

const running = new Map<number, RunningProcess>();
let nextId = 1;
const listeners = new Set<() => void>();

export function runningProcesses(): RunningProcess[] {
  return [...running.values()];
}
export function onRunningChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emitRunning() {
  for (const l of listeners) l();
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** Runs a script with the given shell. Never rejects: failures are reported in the result. */
export const runScript: Runner = (script, options) => {
  const started = Date.now();
  const cmd = options.terminal ? terminalCommand(options.shell, script) : shellCommand(options.shell, script);
  return new Promise<RunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let settled = false;
    let child: ChildProcess;
    let timer: NodeJS.Timeout | undefined;
    const id = nextId++;

    const finish = (code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      running.delete(id);
      emitRunning();
      resolve({ code, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), durationMs: Date.now() - started, timedOut, killed, error });
    };

    try {
      child = spawn(cmd.file, cmd.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: !options.terminal,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(null, (error as Error).message);
      return;
    }

    if (options.timeout)
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, options.timeout * 1000);

    running.set(id, {
      id,
      label: options.label ?? script.slice(0, 60),
      script,
      startedAt: started,
      kill: () => {
        killed = true;
        killTree(child);
      },
    });
    emitRunning();

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));
  });
};

export function isSuccess(result: RunResult): boolean {
  return result.code === 0 && !result.timedOut && !result.killed && !result.error;
}
