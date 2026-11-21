import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let editor: Page;
let launcher: Page;
let work: string;
let out: string;

const read = (name: string) => (fs.existsSync(path.join(out, name)) ? fs.readFileSync(path.join(out, name), 'utf8').replace(/^﻿/, '').trim() : undefined);
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
};
const launcherVisible = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('launcher.html'))?.isVisible() ?? false);
type Hook = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hook = <T,>(fn: string) =>
  app.evaluate(async (_e, src) => {
    const tc = (globalThis as unknown as { __traycommand: Hook }).__traycommand;
    return new Function('tc', `return (async () => { ${src} })()`)(tc);
  }, fn) as Promise<T>;

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-launcher-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  out = path.join(work, 'out');
  fs.mkdirSync(out);
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'launcher.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home'), TC_OUT: out },
  });
  // the editor window (the launcher window is created hidden at startup, maybe first)
  await expect.poll(() => app.windows().some((w) => w.url().includes('index.html')), { timeout: 30000 }).toBe(true);
  editor = app.windows().find((w) => w.url().includes('index.html'))!;
  await editor.setViewportSize({ width: 1200, height: 860 });
  await editor.waitForSelector('[data-testid="tray-list"]');
  // the launcher window is created hidden at startup
  await expect.poll(() => app.windows().some((w) => w.url().includes('launcher.html'))).toBe(true);
  launcher = app.windows().find((w) => w.url().includes('launcher.html'))!;
  await launcher.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    /* still locked by the exiting app */
  }
});

test('startup and interval schedules run unattended', async () => {
  await expect.poll(() => read('boot.txt'), { timeout: 10000 }).toBe('scheduler');
  await expect.poll(() => read('tick.txt')?.split(/\r?\n/).length ?? 0, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
});

test('global shortcuts are registered', async () => {
  const status = await hook<{ path: string; ok: boolean; error?: string }[]>('return tc.hotkeys.status()');
  expect(status.map((s) => s.path).sort()).toEqual(['settings.launcherHotkey', 'trays[0]', 'trays[1]']);
  // on CI runners the desktop may not allow global shortcuts: only check them on a real desktop
  if (!process.env.CI) for (const s of status) expect(s, `${s.path}: ${s.error}`).toMatchObject({ ok: true });
});

test('launcher: search, run with a form, values in script and environment', async () => {
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  const input = launcher.getByTestId('launcher-input');
  await expect(input).toBeFocused();
  await expect(launcher.getByTestId('launcher-item').first()).toBeVisible();
  await shot(launcher, '20-launcher');
  await launcher.keyboard.type('dep');
  await expect(launcher.getByTestId('launcher-item').first()).toContainText('Deploy app');
  await shot(launcher, '21-launcher-search');
  await launcher.keyboard.press('Enter');
  const form = launcher.getByTestId('launcher-form');
  await expect(form).toBeVisible();
  await expect(launcher.getByTestId('launcher-field-BRANCH')).toBeFocused();
  await expect(launcher.getByTestId('launcher-field-BRANCH')).toHaveValue('main');
  await launcher.keyboard.type('feature/x');
  await launcher.getByTestId('launcher-field-ENV').selectOption('prod');
  await launcher.getByTestId('launcher-field-FORCE').check({ force: true });
  await shot(launcher, '22-launcher-form');
  await launcher.getByTestId('launcher-field-BRANCH').press('Enter');
  await expect.poll(() => read('deploy.txt'), { timeout: 15000 }).toBe('feature/x|prod|feature/x|true');
  await expect.poll(launcherVisible).toBe(false);
  // the file is written before the process ends: wait until the entry is no longer running
  await expect.poll(() => hook<boolean>("return tc.engine.get('deploy').busy"), { timeout: 15000 }).toBe(false);
});

test('launcher: last values are proposed, Esc goes back to the list, then closes', async () => {
  await hook('await tc.launcher.open()');
  // the entry used last is in "Recent"
  await expect(launcher.locator('.lx-section').first()).toHaveText('Recent');
  await expect(launcher.getByTestId('launcher-item').first()).toContainText('Deploy app');
  await launcher.keyboard.press('Enter');
  await expect(launcher.getByTestId('launcher-field-BRANCH')).toHaveValue('feature/x');
  await expect(launcher.getByTestId('launcher-field-ENV')).toHaveValue('prod');
  await launcher.keyboard.press('Escape');
  await expect(launcher.getByTestId('launcher-list')).toBeVisible();
  await expect(launcher.getByTestId('launcher-input')).toBeFocused();
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('launcher: shortcut of a menu opens it as scope; sub menus with Tab; options from a script', async () => {
  await hook("tc.hotkeyFired('trays[1]')");
  await expect.poll(launcherVisible).toBe(true);
  await expect(launcher.locator('.lx-scope')).toContainText('Tools');
  await expect(launcher.getByTestId('launcher-item')).toHaveText([/Say hello/, /Check out a branch/, /Docker/]);
  await shot(launcher, '23-launcher-scope');
  // Tab on "Docker" opens its menu, Backspace goes back
  await launcher.keyboard.press('ArrowDown');
  await launcher.keyboard.press('ArrowDown');
  await launcher.keyboard.press('Tab');
  await expect(launcher.getByTestId('launcher-item')).toHaveText([/Compose up/, /Compose down/]);
  await launcher.keyboard.press('Backspace');
  await expect(launcher.getByTestId('launcher-item')).toHaveCount(3);
  await launcher.keyboard.type('check');
  await launcher.keyboard.press('Enter');
  const select = launcher.getByTestId('launcher-field-B');
  await expect(select).toBeVisible({ timeout: 15000 });
  await expect(select.locator('option')).toHaveText(['alpha', 'beta', 'gamma']);
  await select.selectOption('gamma');
  await shot(launcher, '24-launcher-dynamic-options');
  await launcher.getByTestId('launcher-submit').click();
  await expect.poll(() => read('pick.txt'), { timeout: 15000 }).toBe('gamma');
});

test('launcher: fuzzy search across menus runs without a form', async () => {
  await hook('await tc.launcher.open()');
  // typed right away: nothing may be lost
  await launcher.keyboard.type('dock up');
  await expect(launcher.getByTestId('launcher-item').first()).toContainText('Compose up');
  await launcher.keyboard.press('Enter');
  await expect.poll(() => read('up.txt'), { timeout: 15000 }).toBe('up');
  await expect.poll(launcherVisible).toBe(false);
});

test('a real global shortcut opens the launcher (Windows)', async () => {
  test.skip(process.platform !== 'win32' || !!process.env.CI, 'SendKeys needs an interactive Windows desktop');
  // Ctrl+Alt+Shift+F11 through the Windows input queue, as if typed on the keyboard
  execFileSync('powershell.exe', ['-NoProfile', '-Command', "$w = New-Object -ComObject WScript.Shell; $w.SendKeys('^%+{F11}')"]);
  await expect.poll(launcherVisible, { timeout: 5000 }).toBe(true);
  await expect(launcher.getByTestId('launcher-input')).toBeFocused();
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('editor: inputs, shortcut and schedule of an entry', async () => {
  await editor.bringToFront();
  await editor.getByTestId('tray-row').nth(0).click();
  await expect(editor.getByTestId('action-inputs')).toBeVisible();
  await expect(editor.getByTestId('input-name-0')).toHaveValue('BRANCH');
  await expect(editor.getByTestId('entry-hotkey')).toContainText('F10');
  await shot(editor, '25-editor-inputs');
  // record a new shortcut with the keyboard
  await editor.getByTestId('entry-hotkey').click();
  await editor.keyboard.press('Control+Alt+Shift+F8');
  await expect(editor.getByTestId('entry-hotkey')).toContainText('F8');
  await expect(editor.getByTestId('savebar')).toBeVisible();
  // add a schedule at set times
  await editor.getByTestId('add-schedule').click();
  await expect(editor.getByTestId('schedule')).toHaveCount(1);
  await editor.getByTestId('card-schedule').scrollIntoViewIfNeeded();
  await shot(editor, '26-editor-schedule');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].hotkey).toBe('Ctrl+Alt+Shift+F8');
  expect(saved.trays[0].schedules).toEqual([{ cron: '0 9 * * 1-5' }]);
  await expect
    .poll(async () => (await hook<{ path: string; hotkey: string }[]>('return tc.hotkeys.status()')).find((s) => s.path === 'trays[0]')?.hotkey)
    .toBe('Ctrl+Alt+Shift+F8');
  // the ticker row shows the schedule badge, the editor the next run
  await editor.getByTestId('tray-row').nth(2).click();
  await expect(editor.getByTestId('card-schedule')).toContainText('Next run');
});

test('settings: launcher shortcut', async () => {
  await editor.getByTestId('tab-settings').click();
  await expect(editor.getByTestId('launcher-hotkey')).toContainText('F11');
  await editor.getByTestId('launcher-card').scrollIntoViewIfNeeded();
  await shot(editor, '27-settings-launcher');
});

test('launcher in dark mode', async () => {
  await launcher.emulateMedia({ colorScheme: 'dark' });
  await hook('await tc.launcher.open()');
  await launcher.keyboard.type('o');
  await shot(launcher, '28-launcher-dark');
  await launcher.keyboard.press('Escape');
  await launcher.keyboard.press('Escape');
  await launcher.emulateMedia({ colorScheme: 'light' });
});

test('tray menus show shortcuts, the launcher entry and the schedules pause', async () => {
  const menus = await hook<{ tools: { label: string; accelerator?: string }[]; app: { label: string; accelerator?: string; checked: boolean }[] }>(`
    const items = (key) => tc.trays.menuFor(key).items.map((i) => ({ label: i.label, accelerator: i.accelerator, checked: i.checked }));
    return { tools: items('tools'), app: items('__traycommand__') };
  `);
  const app = menus.app.map((i) => i.label);
  expect(app).toContain('Search and run…');
  expect(menus.app.find((i) => i.label === 'Search and run…')!.accelerator).toBe('Ctrl+Alt+Shift+F11');
  expect(menus.app.find((i) => i.label === 'Pause schedules')).toMatchObject({ checked: false });
  // pausing from the tray menu hides the next run and is remembered on this PC
  await hook(`tc.engine.setSchedulesPaused(true)`);
  expect(await hook<number | undefined>(`return tc.engine.status(tc.engine.get('ticker')).nextRun`)).toBeUndefined();
  await hook(`tc.engine.setSchedulesPaused(false)`);
  expect(await hook<number>(`return tc.engine.status(tc.engine.get('ticker')).nextRun`)).toBeGreaterThan(Date.now());
  expect(menus.tools.map((i) => i.label)).toEqual(['Say hello', 'Check out a branch', 'Docker']);
});
