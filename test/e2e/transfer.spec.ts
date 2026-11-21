import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeApp, editorWindow } from './support/windows';
import { readZip } from '../../src/main/zip';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let page: Page;
let work: string;

const shot = async (name: string) => {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
};
const config = () => JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
/** The next save / open dialog answers with this file. */
const answerSave = (file: string) => app.evaluate(({ dialog }, f) => void (dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as never), file);
const answerOpen = (file: string | undefined) => app.evaluate(({ dialog }, f) => void (dialog.showOpenDialog = (async () => ({ canceled: !f, filePaths: f ? [f] : [] })) as never), file);

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-transfer-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') },
  });
  page = await editorWindow(app);
  await page.setViewportSize({ width: 1200, height: 860 });
  await page.waitForSelector('[data-testid="tray-list"]');
  await page.getByTestId('tab-settings').click();
});

test.afterAll(async () => {
  await closeApp(app);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    /* still locked by the exiting app */
  }
});

test('export: pick a tray, add what it needs, write a zip with its icons', async () => {
  await page.getByTestId('export-open').click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  // everything is ticked at first
  await expect(page.getByTestId('export-entries-check')).toHaveAttribute('data-state', 'all');
  await page.getByTestId('export-entries-check').click();
  await page.getByTestId('export-variables-check').click();
  // the settings changed from their defaults are ticked too
  await expect(page.getByTestId('export-settings-check')).toHaveAttribute('data-state', 'some');
  await page.getByTestId('export-settings-check').click();
  await expect(page.getByTestId('export-settings-check')).toHaveAttribute('data-state', 'all');
  await page.getByTestId('export-settings-check').click();
  await expect(page.getByTestId('export-save')).toBeDisabled();
  await expect(page.getByTestId('export-summary')).toHaveText('Choose what to export');
  // only the VS Code tray: its two projects come with it
  await page.getByTestId('export-entry').filter({ hasText: 'VS Code' }).locator('input').click();
  await expect(page.getByTestId('export-entry').filter({ hasText: 'Project A' }).locator('input')).toBeChecked();
  // the projects use ${WS}: proposed
  await expect(page.getByTestId('export-deps')).toContainText('${WS}');
  await page.waitForTimeout(400);
  await shot('export');
  await page.getByTestId('export-deps-add').click();
  await expect(page.getByTestId('export-deps')).toBeHidden();
  await expect(page.getByTestId('export-summary')).toHaveText('1 tray, 1 variable, 1 icon · .zip file');
  const file = path.join(work, 'out', 'code.zip');
  await answerSave(file);
  await page.getByTestId('export-save').click();
  await expect(dialog).toBeHidden();
  const files = readZip(fs.readFileSync(file));
  expect(files.map((f) => f.name)).toEqual(['traycommand-export.json', 'icons/code.png']);
  const pack = JSON.parse(files[0]!.data.toString());
  expect(pack.trays.map((t: { id: string }) => t.id)).toEqual(['code']);
  expect(pack.variables).toEqual({ WS: '${configDir}/workspaces' });
  expect(pack.settings).toEqual({});
});

test('export: one tray without icons is a JSON file', async () => {
  await page.getByTestId('export-open').click();
  await page.getByTestId('export-entries-check').click();
  await page.getByTestId('export-variables-check').click();
  // partly ticked: the first click ticks all, the second none
  await page.getByTestId('export-settings-check').click();
  await page.getByTestId('export-settings-check').click();
  await page.getByTestId('export-entry').filter({ hasText: 'Notes' }).locator('input').click();
  await page.getByTestId('export-icons').click();
  await expect(page.getByTestId('export-summary')).toHaveText('1 tray · .json file');
  const file = path.join(work, 'out', 'notes.json');
  await answerSave(file);
  await page.getByTestId('export-save').click();
  await expect(page.getByTestId('export-dialog')).toBeHidden();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).trays).toEqual([{ id: 'notes', label: 'Notes', hidden: true, action: 'echo notes' }]);
});

test('import: its own export is already here', async () => {
  await answerOpen(path.join(work, 'out', 'code.zip'));
  await page.getByTestId('import-open').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('import-entry').first()).toHaveAttribute('data-status', 'identical');
  await expect(page.getByTestId('import-summary')).toContainText('Nothing to import');
  await expect(page.getByTestId('import-apply')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // cancelled file choice: nothing opens
  await answerOpen(undefined);
  await page.getByTestId('import-open').click();
  await expect(dialog).toBeHidden();
});

test('import: new trays, a tray already here, a shortcut and a variable in use', async () => {
  fs.mkdirSync(path.join(work, 'in', 'art'), { recursive: true });
  fs.copyFileSync(path.join(work, 'icons', 'note.png'), path.join(work, 'in', 'art', 'docs.png'));
  const file = path.join(work, 'in', 'shared.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      traycommandExport: 1,
      app: '2.5.0',
      trays: [
        { id: 'server', label: 'Web server', action: 'echo other', menu: [{ id: 'server_logs', label: 'Logs', action: 'echo logs' }] },
        { id: 'docs', label: 'Docs', icon: 'art/docs.png', action: 'echo docs', hotkey: 'Ctrl+Alt+Space' },
        { id: 'notes', label: 'My notes', action: 'echo mine' },
      ],
      variables: { WS: 'D:/elsewhere', NEW_VAR: 'x' },
      settings: { theme: 'dark', allowAdminCommands: true },
    }),
  );
  await answerOpen(file);
  await page.getByTestId('import-open').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  const rows = page.getByTestId('import-entry');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'conflict');
  await expect(rows.nth(0).getByTestId('import-decision')).toHaveValue('merge');
  await expect(rows.nth(2)).toHaveAttribute('data-status', 'new');
  await expect(rows.nth(3)).toContainText('notes_2');
  await expect(page.getByTestId('import-hotkey')).toContainText('used by the launcher');
  await expect(page.getByTestId('import-variable').nth(0)).toHaveAttribute('data-status', 'different');
  await expect(page.getByTestId('import-variable').nth(0).locator('input')).not.toBeChecked();
  await expect(page.getByTestId('import-setting').nth(1)).toContainText('administrator');
  await expect(page.getByTestId('import-setting').nth(1).locator('input')).not.toBeChecked();
  await expect(page.getByTestId('import-summary')).toHaveText('2 new, 1 merged, 1 kept apart, 1 variable, 1 setting');
  await page.waitForTimeout(400); // the window fades in
  await shot('import');
  await expect(rows.nth(3)).toContainText('here: “Notes”');
  // "My notes" is not wanted
  await rows.nth(3).locator('input').click();
  await expect(page.getByTestId('import-summary')).toHaveText('2 new, 1 merged, 1 variable, 1 setting');
  await page.getByTestId('import-apply').click();
  await expect(dialog).toBeHidden();
  const c = config();
  const server = c.trays.find((t: { id: string }) => t.id === 'server');
  expect(server.action).toEqual({ run: 'echo started', notify: 'Server (re)started' });
  expect(server.menu.at(-1)).toEqual({ id: 'server_logs', label: 'Logs', action: 'echo logs' });
  const docs = c.trays.find((t: { id: string }) => t.id === 'docs');
  expect(docs).toEqual({ id: 'docs', label: 'Docs', icon: 'icons/docs.png', action: 'echo docs' });
  expect(fs.existsSync(path.join(work, 'icons', 'docs.png'))).toBe(true);
  expect(c.trays.some((t: { id: string }) => t.id === 'notes_2')).toBe(false);
  expect(c.variables).toEqual({ WS: '${configDir}/workspaces', NEW_VAR: 'x' });
  expect(c.settings.theme).toBe('dark');
  expect(c.settings.allowAdminCommands ?? false).toBe(false);
  // the new tray is in the editor, with its icon
  await page.getByTestId('tab-trays').click();
  await expect(page.getByTestId('tray-row').filter({ hasText: 'Docs' }).locator('img')).toBeVisible();
});

test('import: a file that is not an export says why', async () => {
  const file = path.join(work, 'in', 'other.json');
  fs.writeFileSync(file, '{"hello": 1}');
  await answerOpen(file);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('import-open').click();
  await expect(page.locator('.toast')).toHaveText('Cannot import: This file is not a TrayCommand export or configuration');
  await expect(page.getByTestId('import-dialog')).toBeHidden();
});
