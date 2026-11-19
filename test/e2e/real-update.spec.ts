import { _electron as electron, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Real self update against GitHub releases (manual, not run in CI):
 *   TC_UPDATE_FROM=<folder of an installed build older than the latest release> npx playwright test test/e2e/real-update.spec.ts
 * The folder is replaced by the latest release. Optional TC_UPDATE_PATH_PREFIX is put first
 * on PATH (for example Git for Windows' usr\bin, whose tar broke 2.1.2).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.env.TC_UPDATE_FROM;
test.skip(!from || process.platform !== 'win32', 'set TC_UPDATE_FROM to a TrayCommand folder to update (Windows)');

test('updates itself from GitHub, swaps the folder and relaunches', async () => {
  test.setTimeout(10 * 60 * 1000);
  const exe = path.join(from!, 'TrayCommand.exe');
  const info = () => JSON.parse(execFileSync(exe, ['--info', `--data-dir=${data}`], { encoding: 'utf8' })) as { version: string };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-realupd-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  const data = path.join(work, 'data');
  const before = info().version;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') };
  if (process.env.TC_UPDATE_PATH_PREFIX) env.PATH = `${process.env.TC_UPDATE_PATH_PREFIX};${process.env.PATH}`;
  const app = await electron.launch({ executablePath: exe, args: [`--data-dir=${data}`, `--config=${path.join(work, 'config.json')}`], env });
  const page = await app.firstWindow();
  await page.getByText('Continue').click().catch(() => undefined);
  await page.getByTestId('tab-settings').click();
  await page.getByRole('button', { name: 'Check now' }).click();
  const install = page.getByRole('button', { name: /^Install \d/ });
  await expect(install).toBeVisible({ timeout: 60000 });
  const closed = new Promise((r) => app.process().once('exit', r));
  await install.click();
  await closed; // download, verify, extract, hand over to the runner, quit
  // the runner replaces the folder and relaunches it
  const deadline = Date.now() + 120000;
  let after = before;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      after = info().version;
      if (after !== before) break;
    } catch {
      /* folder being replaced */
    }
  }
  expect(after).not.toBe(before);
  // relaunched from the same folder, with the same data folder
  const running = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='TrayCommand.exe'" | ? { $_.CommandLine -like '*${path.basename(work)}*' -and $_.CommandLine -notlike '*--type=*' } | % ProcessId`], { encoding: 'utf8' }).trim();
  expect(running).not.toBe('');
  for (const pid of running.split(/\s+/)) process.kill(Number(pid));
  expect(fs.existsSync(`${from}.old`)).toBe(false);
  console.log(`updated ${before} → ${after}`);
});
