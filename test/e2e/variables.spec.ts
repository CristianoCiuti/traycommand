import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, editorWindow } from './support/windows';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let page: Page;
let work: string;

async function shot(name: string) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}
const saved = () => JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8')) as { variables: Record<string, string>; secrets?: string[]; trays: { label: string; action?: unknown; menu?: { label: string; action?: unknown }[] }[] };
async function save() {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('savebar')).toBeHidden();
}

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-e2e-vars-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') },
  });
  page = await editorWindow(app);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForSelector('[data-testid="tray-list"]');
  page.on('dialog', (d) => void d.accept());
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

test('the Variables page lists the variables and where they are used', async () => {
  await page.getByTestId('tab-variables').click();
  await expect(page.getByTestId('variables-view')).toBeVisible();
  const row = page.locator('[data-testid="variable-row"][data-name="WS"]');
  await expect(row).toContainText('2 uses');
  await expect(page.getByTestId('variable-WS')).toHaveValue('${configDir}/workspaces');
  await page.getByTestId('uses-toggle-WS').click();
  await expect(page.getByTestId('uses-WS')).toContainText('VS Code › Project A');
  await expect(page.getByTestId('uses-WS')).toContainText('VS Code › Project B');
  await shot('20-variables');
});

test('a script shows the variables as chips while it is edited, and a chip writes ${NAME} at the caret', async () => {
  await page.getByTestId('tab-trays').click();
  await page.getByTestId('tray-row').nth(1).click(); // Web server: echo started
  const script = page.getByTestId('action-script');
  await expect(page.getByTestId('action-script-vars')).toHaveCount(0);
  await script.click();
  await script.press('End');
  const chips = page.getByTestId('action-script-vars');
  await expect(chips).toBeVisible();
  await expect(chips.locator('[data-var="WS"]')).toBeVisible();
  await expect(chips.locator('[data-var="configDir"]')).toBeVisible();
  // no folder watch on this entry: no TC_ values
  await expect(chips.locator('[data-var="TC_FILE"]')).toHaveCount(0);
  await shot('21-chips');
  await chips.locator('[data-var="WS"]').click();
  await expect(script).toHaveValue('echo started${WS}');
  // the text kept the focus: typing goes on after the chip
  await page.keyboard.type(' ok');
  await expect(script).toHaveValue('echo started${WS} ok');
});

test('a name without a value is pointed out and can be added as a variable', async () => {
  const script = page.getByTestId('action-script');
  await script.fill('echo ${PROJECT_X}');
  const warn = page.getByTestId('action-script-warn');
  await expect(warn).toContainText('${PROJECT_X} is not a variable');
  await shot('22-undefined');
  await warn.getByRole('button', { name: 'Add variable' }).click();
  await expect(warn).toHaveCount(0);
  await page.getByTestId('tab-variables').click();
  await expect(page.locator('[data-testid="variable-row"][data-name="PROJECT_X"]')).toContainText('1 use');
  await page.getByTestId('variable-PROJECT_X').fill('D:/x');
  await save();
  expect(saved().variables.PROJECT_X).toBe('D:/x');
});

test('rename asks where: only the places ticked change', async () => {
  await page.getByTestId('rename-WS').click();
  const dialog = page.getByTestId('rename-dialog');
  await expect(dialog).toContainText('is written in 2 places');
  await page.getByTestId('rename-name').fill('ROOT');
  await page.getByTestId('rename-pick').click();
  const uses = page.getByTestId('rename-use');
  await expect(uses).toHaveCount(2);
  await uses.filter({ hasText: 'Project B' }).locator('input').uncheck();
  await shot('23-rename');
  await page.getByTestId('rename-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-testid="variable-row"][data-name="ROOT"]')).toContainText('1 use');
  // the place left out keeps ${WS}, which is now written but not defined
  await expect(page.locator('[data-testid="missing-variable"][data-name="WS"]')).toBeVisible();
  await save();
  const c = saved();
  expect(Object.keys(c.variables)).toEqual(['ROOT', 'PROJECT_X']);
  expect(c.trays[2]!.menu!.map((m) => m.action)).toEqual(['echo ${ROOT}/a', 'echo ${WS}/b']);
});

test('rename "nowhere" changes only the name', async () => {
  await page.getByTestId('rename-PROJECT_X').click();
  await page.getByTestId('rename-name').fill('PX');
  await page.getByTestId('rename-none').click();
  await page.getByTestId('rename-apply').click();
  await save();
  const c = saved();
  expect(c.variables.PX).toBe('D:/x');
  expect(JSON.stringify(c.trays)).toContain('${PROJECT_X}');
});

test('a secret is kept encrypted outside the file and hidden in what is shown', async () => {
  await page.getByTestId('add-variable-name').fill('TOKEN');
  await page.getByTestId('add-variable-secret').click();
  await page.getByTestId('add-variable-value').fill('tok-123-secret');
  await page.getByTestId('add-variable-button').click();
  const row = page.locator('[data-testid="variable-row"][data-name="TOKEN"]');
  await expect(row).toHaveAttribute('data-secret', 'true');
  await save();
  const raw = fs.readFileSync(path.join(work, 'config.json'), 'utf8');
  expect(JSON.parse(raw).secrets).toEqual(['TOKEN']);
  expect(raw).not.toContain('tok-123-secret');
  const store = fs.readFileSync(path.join(work, 'data', 'secrets.json'), 'utf8');
  expect(Object.keys(JSON.parse(store).values)).toEqual(['TOKEN']);
  expect(store).not.toContain('tok-123-secret');
  // the field never shows it, unless asked
  await expect(page.getByTestId('secret-TOKEN')).toHaveValue('');
  await page.getByTestId('secret-TOKEN-show').click();
  await expect(page.getByTestId('secret-TOKEN')).toHaveValue('tok-123-secret');
  await page.getByTestId('secret-TOKEN-show').click();
  await shot('24-secret');

  // used in a script: the run gets the value, the output shows ••••
  await page.getByTestId('tab-trays').click();
  await page.getByTestId('tray-row').nth(1).click();
  const script = page.getByTestId('action-script');
  await script.fill('echo "token=${TOKEN}"');
  await script.click();
  await expect(page.getByTestId('action-script-vars').locator('[data-var="TOKEN"]')).toBeVisible();
  await page.getByTestId('action-test').click();
  const out = page.getByTestId('test-output').first();
  await expect(out).toContainText('token=••••', { timeout: 30000 });
  await expect(out).not.toContainText('tok-123');
  await shot('25-secret-masked');
  await save();
  const label = await app.evaluate(async () => {
    const tc = (globalThis as unknown as { __traycommand: { engine: { expandText(t: string): string } } }).__traycommand;
    return tc.engine.expandText('${TOKEN}');
  });
  expect(label).toBe('tok-123-secret');
  // the JSON view shows the file: the name, never the value
  await page.getByTestId('tab-json').click();
  await expect(page.locator('textarea').first()).toHaveValue(/"secrets": \[\s*"TOKEN"\s*\]/);
  await expect(page.locator('textarea').first()).not.toHaveValue(/tok-123/);
});

test('a secret can be renamed (its value follows) and turned back into a plain variable', async () => {
  await page.getByTestId('tab-variables').click();
  await page.getByTestId('rename-TOKEN').click();
  await page.getByTestId('rename-name').fill('API_TOKEN');
  await page.getByTestId('rename-apply').click();
  await save();
  expect(saved().secrets).toEqual(['API_TOKEN']);
  expect(JSON.stringify(saved().trays)).toContain('${API_TOKEN}');
  await page.getByTestId('secret-API_TOKEN-show').click();
  await expect(page.getByTestId('secret-API_TOKEN')).toHaveValue('tok-123-secret');
  // plain again: the value goes in the file (after the confirmation), the store forgets it
  await page.getByTestId('plain-API_TOKEN').click();
  await expect(page.getByTestId('variable-API_TOKEN')).toHaveValue('tok-123-secret');
  await save();
  const c = saved();
  expect(c.variables.API_TOKEN).toBe('tok-123-secret');
  expect(c.secrets).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(path.join(work, 'data', 'secrets.json'), 'utf8')).values).toEqual({});
});

test('a secret without a value on this PC is pointed out', async () => {
  await page.getByTestId('secret-make-API_TOKEN').click();
  await page.getByTestId('secret-API_TOKEN-clear').click();
  await expect(page.getByTestId('secrets-unset')).toContainText('${API_TOKEN}');
  await page.getByTestId('tab-trays').click();
  await page.getByTestId('tray-row').nth(1).click();
  await expect(page.getByTestId('action-script-warn')).toContainText('secret without a value on this PC');
  // Discard brings back the plain variable, and its value
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('savebar')).toBeHidden();
  await page.getByTestId('tab-variables').click();
  await expect(page.getByTestId('variable-API_TOKEN')).toHaveValue('tok-123-secret');
});
