/*
 * Detached update runner. Started with ELECTRON_RUN_AS_NODE=1 from a copy in a temp
 * folder, so it does not lock the installation it replaces.
 *
 *   1. waits for TrayCommand to exit
 *   2. moves the current installation aside (<target>.old)
 *   3. moves the new version in place (rolls back on failure)
 *   4. writes the result and relaunches TrayCommand
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { RunnerJob } from './update';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function retry<T>(fn: () => T, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(code) || Date.now() > deadline) throw error;
      await sleep(250);
    }
  }
}

function move(from: string, to: string, kind: RunnerJob['kind']) {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.cpSync(from, to, { recursive: kind === 'dir' });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

export async function applyUpdate(job: RunnerJob): Promise<{ ok: boolean; message?: string }> {
  const deadline = Date.now() + 60000;
  while (alive(job.pid) && Date.now() < deadline) await sleep(200);
  if (alive(job.pid)) return { ok: false, message: 'TrayCommand did not exit' };

  const backup = `${job.target}.old`;
  await retry(() => fs.rmSync(backup, { recursive: true, force: true }));
  const hadTarget = fs.existsSync(job.target);
  if (hadTarget) await retry(() => move(job.target, backup, job.kind));
  try {
    await retry(() => move(job.source, job.target, job.kind));
    if (job.kind === 'file') fs.chmodSync(job.target, 0o755);
  } catch (error) {
    if (hadTarget) await retry(() => move(backup, job.target, job.kind)).catch(() => undefined);
    return { ok: false, message: (error as Error).message };
  }
  await retry(() => fs.rmSync(backup, { recursive: true, force: true }), 5000).catch(() => undefined);
  return { ok: true };
}

async function main() {
  const jobFile = process.argv[2];
  if (!jobFile) process.exit(2);
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as RunnerJob;
  let result: { ok: boolean; message?: string };
  try {
    result = await applyUpdate(job);
  } catch (error) {
    result = { ok: false, message: (error as Error).message };
  }
  fs.writeFileSync(job.resultFile, JSON.stringify({ ...result, version: job.version, time: Date.now() }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(job.relaunch.command, job.relaunch.args, { cwd: job.relaunch.cwd, detached: true, stdio: 'ignore', env }).unref();
}

if (process.env.TRAYCOMMAND_UPDATE_RUNNER === '1') void main();
