import { _electron as electron, expect, test } from '@playwright/test';
import { editorWindow } from './support/windows';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.env.TC_EXE ?? path.resolve(here, '../../packages/win-unpacked/TrayCommand.exe');

test.skip(!fs.existsSync(exe), 'packaged app not built (npm run package)');

test('packaged app starts, loads the config and shows the welcome page', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pkg-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  const agents = path.join(work, 'home');
  fs.mkdirSync(path.join(agents, '.claude'), { recursive: true });
  const app = await electron.launch({
    executablePath: exe,
    args: [`--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_AGENTS_HOME: agents },
  });
  const page = await editorWindow(app);
  await page.setViewportSize({ width: 1200, height: 800 });
  // not installed in %LOCALAPPDATA%\Programs → welcome page offering the per-user install
  await expect(page.getByTestId('install')).toBeVisible({ timeout: 20000 });
  fs.mkdirSync(path.resolve(here, '../../test-results/screens'), { recursive: true });
  await page.screenshot({ path: path.resolve(here, '../../test-results/screens/11-welcome-packaged.png') });
  await page.getByText('Continue').click();
  await expect(page.getByTestId('tray-row')).toHaveCount(4);
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  // the skill ships in resources/skill and is rendered with the packaged executable
  await page.getByTestId('skill-banner-install').click();
  const skill = fs.readFileSync(path.join(agents, '.claude', 'skills', 'traycommand', 'SKILL.md'), 'utf8');
  expect(skill).toContain(exe.replace(/\\/g, '/'));
  expect(fs.existsSync(path.join(agents, '.claude', 'skills', 'traycommand', 'scripts', 'make-icon.ps1'))).toBe(true);
  // every look ships its icon: PNG for the window and the tray, ICO for the Start menu shortcut
  const assets = path.join(path.dirname(exe), 'resources', 'assets');
  for (const look of ['aurora', 'terminal', 'brutal', 'neon']) {
    for (const ext of ['png', 'ico']) expect(fs.existsSync(path.join(assets, `icon-${look}.${ext}`)), `icon-${look}.${ext}`).toBe(true);
  }
  await app.evaluate(({ app }) => app.exit(0));
});
