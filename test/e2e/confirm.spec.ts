/* The confirmations of the editor are its own dialogs, never system windows. */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, editorWindow } from './support/windows';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication | undefined;
let page: Page;
let work: string;
const systemDialogs: string[] = [];

const saved = () => JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
const editorOpen = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')));
const closeEditor = () =>
  app!.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('index.html'))
      ?.close();
  });

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-e2e-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  // only OpenCode on this PC: its user folder, and no claude command on the PATH (it may be installed here)
  fs.mkdirSync(path.join(work, 'home', '.config', 'opencode'), { recursive: true });
  const exe = ['claude', 'claude.exe', 'claude.cmd', 'claude.ps1'];
  const PATH = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => !exe.some((f) => fs.existsSync(path.join(dir, f))))
    .join(path.delimiter);
  const env = { ...process.env, PATH, Path: PATH, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') };
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env,
  });
  // a system message box would block the test: fail loudly instead
  await app.evaluate(({ dialog }) => {
    const box = () => {
      throw new Error('system message box shown');
    };
    dialog.showMessageBox = box as never;
    dialog.showMessageBoxSync = box as never;
  });
  page = await editorWindow(app);
  // "beforeunload" is how the page stops a close with unsaved changes: Electron then asks the editor
  // (will-prevent-unload), no window is shown for it; any other page dialog would be a system window
  page.on('dialog', (d) => void (d.type() !== 'beforeunload' && systemDialogs.push(`${d.type()}: ${d.message()}`)));
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForSelector('[data-testid="tray-list"]');
});

test.afterAll(async () => {
  await closeApp(app);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    /* temp folder still locked by the exiting app: harmless */
  }
});

test('only OpenCode on this PC: the banner and the settings name it alone', async () => {
  const banner = page.getByTestId('skill-banner');
  await expect(banner).toContainText('OpenCode is on this PC. Install the TrayCommand skill');
  await expect(banner).not.toContainText('Claude Code');
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('skills-card')).toContainText('Create and change trays by asking Claude Code or OpenCode');
  await expect(page.getByTestId('skill-opencode')).toContainText('OpenCode');
  await expect(page.getByTestId('skill-opencode')).toContainText('Found on this PC, skill not installed');
  await expect(page.getByTestId('skill-claude')).toContainText('Not found on this PC');
  await expect(page.getByTestId('skill-install-claude')).toBeDisabled();
  await expect(page.getByTestId('skill-install-opencode')).toBeEnabled();
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toBeHidden();
  await page.getByTestId('tab-trays').click();
});

test('deleting an entry asks in the editor: Esc and Cancel keep it, Delete removes it', async () => {
  const before = saved().trays.length;
  await page.getByTestId('tray-row').nth(0).click();
  const label = await page.getByTestId('entry-label').inputValue();
  const dialog = page.getByTestId('confirm-dialog');

  await page.getByTestId('delete-entry').click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirm-text')).toContainText(`Delete “${label}”`);
  await expect(page.getByTestId('confirm-ok')).toHaveText('Delete');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, '36-editor-confirm.png') });
  await expect(page.getByTestId('confirm-ok')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('tray-row')).toHaveCount(before);

  await page.getByTestId('delete-entry').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('tray-row')).toHaveCount(before);

  await page.getByTestId('delete-entry').click();
  await expect(page.getByTestId('confirm-ok')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('tray-row')).toHaveCount(before - 1);
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('savebar')).toBeHidden();
  expect(saved().trays).toHaveLength(before - 1);
});

test('restoring a backup asks first', async () => {
  const count = saved().trays.length;
  await page.getByTestId('tab-settings').click();
  const restore = page.getByRole('button', { name: 'Restore' }).first();
  await restore.click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-text')).toContainText('Replace the current configuration with the backup of');
  await page.getByTestId('confirm-cancel').click();
  expect(saved().trays).toHaveLength(count);
  await restore.click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => saved().trays.length).toBe(count + 1); // the backup taken before the delete
  await page.getByTestId('tab-trays').click();
});

test('closing with unsaved changes asks in the editor: Keep editing, then Discard and close', async () => {
  await page.getByTestId('tray-row').nth(0).click();
  await page.getByTestId('entry-label').fill('Changed, not saved');
  await expect(page.getByTestId('savebar')).toBeVisible();

  await closeEditor();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirm-text')).toContainText('unsaved changes');
  await expect(page.getByTestId('confirm-cancel')).toHaveText('Keep editing');
  await expect(page.getByTestId('confirm-ok')).toBeFocused(); // the keys are listened to
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await editorOpen()).toBe(true);
  await expect(page.getByTestId('entry-label')).toHaveValue('Changed, not saved');

  await closeEditor();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(editorOpen).toBe(false);
  expect(saved().trays[0].label).not.toBe('Changed, not saved');
  expect(systemDialogs).toEqual([]);
});

test('"Quit TrayCommand" from the tray with unsaved changes asks in the editor: Keep editing, then Discard and quit', async () => {
  // the editor was closed by the test before: open it again, as the tray does
  const tc = app!;
  const proc = tc.process();
  await tc.evaluate(() => (globalThis as unknown as { __traycommand: { trays: { hooks: { openWindow: () => void } } } }).__traycommand.trays.hooks.openWindow());
  page = await editorWindow(tc);
  await page.waitForSelector('[data-testid="tray-list"]');
  await page.getByTestId('tray-row').nth(0).click();
  await page.getByTestId('entry-label').fill('Changed, not saved');
  await expect(page.getByTestId('savebar')).toBeVisible();
  const quitFromTray = () => tc.evaluate(() => (globalThis as unknown as { __traycommand: { trays: { hooks: { quit: () => void } } } }).__traycommand.trays.hooks.quit());

  await quitFromTray();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Quit TrayCommand');
  await expect(page.getByTestId('confirm-ok')).toHaveText('Discard and quit');
  await expect(page.getByTestId('confirm-ok')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(3500); // longer than the wait for an editor that does not answer
  expect(proc.exitCode).toBeNull();
  await expect(page.getByTestId('entry-label')).toHaveValue('Changed, not saved');

  await quitFromTray();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => proc.exitCode, { timeout: 10000 }).not.toBeNull();
  app = undefined; // gone: nothing to close after the tests
  expect(saved().trays[0].label).not.toBe('Changed, not saved');
  expect(systemDialogs).toEqual([]);
});
