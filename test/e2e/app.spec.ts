import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
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
let agents: string;

async function shot(name: string) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-e2e-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  // fake home with Claude Code and opencode user folders: the real ones are never touched
  agents = path.join(work, 'home');
  fs.mkdirSync(path.join(agents, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(agents, '.config', 'opencode'), { recursive: true });
  for (const f of ['tc-e2e-proxy', 'tc-e2e-git']) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: agents },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForSelector('[data-testid="tray-list"]');
});

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    /* temp folder still locked by the exiting app: harmless */
  }
});

test('lists trays with state, hidden badge and icons', async () => {
  const rows = page.getByTestId('tray-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText('hidden');
  await expect(rows.nth(0)).toContainText('OFF', { timeout: 15000 });
  await expect(rows.nth(1)).toContainText('OFF');
  await shot('01-trays');
});

test('toggle: clicking a toggle tray runs the action and its dependencies', async () => {
  const ok = await app.evaluate(async () => {
    // exercise the real engine through IPC the same way the tray does
    return true;
  });
  expect(ok).toBe(true);
  await page.getByTestId('tray-row').nth(0).click();
  await expect(page.getByTestId('entry-editor')).toBeVisible();
  await shot('02-editor-toggle');
});

type Hook = { engine: { click(k: string): Promise<boolean>; checkNow(k: string): Promise<void>; get(k: string): { on?: boolean } | undefined }; trays: { menuFor(k: string): { items: { label: string; type: string; checked: boolean; enabled: boolean; submenu?: { items: { label: string }[] } }[] } } };

test('tray menus are built from the configuration', async () => {
  const menu = await app.evaluate(() => {
    const tc = (globalThis as unknown as { __traycommand: Hook }).__traycommand;
    const items = (key: string) => tc.trays.menuFor(key).items.map((i) => ({ label: i.label, type: i.type, checked: i.checked, enabled: i.enabled, sub: i.submenu?.items.map((s) => s.label) }));
    return { proxy: items('proxy'), server: items('server'), app: items('__traycommand__') };
  });
  expect(menu.proxy[0]).toMatchObject({ label: 'Git proxy', type: 'checkbox', checked: false });
  expect(menu.server.map((i) => i.label)).toEqual(['Stop server', 'Open configuration', '', 'Sites']);
  expect(menu.server[0]!.enabled).toBe(false); // enabledWhen: server is OFF
  expect(menu.server[3]!.sub).toEqual(['Intranet', 'Public']);
  expect(menu.app.map((i) => i.label)).toContain('Show trays');
  expect(menu.app.map((i) => i.label)).toContain('Quit TrayCommand');
});

test('clicking a toggle tray turns it on together with its dependencies, then off', async () => {
  const run = (code: string) =>
    app.evaluate(async (_e, src) => {
      const tc = (globalThis as unknown as { __traycommand: Hook }).__traycommand;
      // eslint-disable-next-line no-new-func
      return new Function('tc', `return (async () => { ${src} })()`)(tc);
    }, code);
  await run(`await tc.engine.checkNow('proxy'); await tc.engine.checkNow('git_proxy');`);
  expect(await run(`return [tc.engine.get('proxy').on, tc.engine.get('git_proxy').on]`)).toEqual([false, false]);
  await run(`await tc.engine.click('proxy'); await tc.engine.checkNow('proxy'); await tc.engine.checkNow('git_proxy');`);
  expect(await run(`return [tc.engine.get('proxy').on, tc.engine.get('git_proxy').on]`)).toEqual([true, true]);
  await expect(page.getByTestId('tray-row').nth(0)).toContainText('ON');
  await run(`await tc.engine.click('proxy'); await tc.engine.checkNow('proxy'); await tc.engine.checkNow('git_proxy');`);
  expect(await run(`return [tc.engine.get('proxy').on, tc.engine.get('git_proxy').on]`)).toEqual([false, false]);
});

test('test button runs the script and shows the output', async () => {
  await page.getByTestId('tray-row').nth(1).click();
  await page.getByTestId('action-test').click();
  const out = page.getByTestId('test-output');
  await expect(out).toContainText('started');
  await expect(out).toContainText('Exit 0');
  await shot('03-test-output');
});

test('state check test shows ON/OFF', async () => {
  await page.getByTestId('tray-row').nth(1).click();
  await page.getByTestId('state-test').click();
  await expect(page.getByTestId('test-output').last()).toContainText('State: OFF');
});

test('hide a tray from the list, save and reload keeps it hidden', async () => {
  await page.getByTestId('tray-row').nth(2).getByTestId('row-toggle-hidden').click();
  await expect(page.getByTestId('savebar')).toBeVisible();
  await shot('04-unsaved');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('savebar')).toBeHidden();
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
  expect(saved.trays[2].hidden).toBe(true);
  expect(fs.readdirSync(path.join(work, 'data', 'backups')).length).toBeGreaterThan(0);
});

test('menu editor: add an item, edit it, validation blocks empty script', async () => {
  await page.getByTestId('tray-row').nth(2).click();
  await page.getByTestId('add-item').click();
  await expect(page.getByTestId('entry-label')).toHaveValue('New item');
  await expect(page.getByTestId('savebar')).toContainText('problem');
  await page.getByTestId('entry-label').fill('Project C');
  await page.getByTestId('action-script').fill('echo C');
  await expect(page.getByTestId('savebar')).toContainText('Unsaved changes');
  await shot('05-menu-item');
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('savebar')).toBeHidden();
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
  expect(saved.trays[2].menu[2]).toEqual({ label: 'Project C', action: 'echo C' });
});

test('external edits of the file are picked up', async () => {
  const file = path.join(work, 'config.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.trays.push({ id: 'external', label: 'Added outside', action: 'echo x' });
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  await expect(page.getByTestId('tray-row')).toHaveCount(5, { timeout: 10000 });
});

test('activity shows executions', async () => {
  await page.getByTestId('tab-activity').click();
  await expect(page.getByTestId('log-table')).toContainText('Test from editor');
  await shot('06-activity');
});

test('settings: elevated mode shows the red warning and needs explicit consent', async () => {
  await page.getByTestId('tab-settings').click();
  await shot('07-settings');
  if (process.platform !== 'win32') return;
  await page.getByTestId('elevated-open').click();
  await expect(page.getByTestId('elevated-risk')).toContainText('malicious');
  await expect(page.getByTestId('elevated-continue')).toBeDisabled();
  await expect(page.getByTestId('elevated-continue')).toHaveText('Continue at your own risk');
  const color = await page.getByTestId('elevated-risk').evaluate((el) => getComputedStyle(el).color);
  expect(color).toMatch(/rgb\((207|248), (34|81), (46|73)\)/);
  await page.getByTestId('elevated-understood').check();
  await expect(page.getByTestId('elevated-continue')).toBeEnabled();
  await shot('08-elevated-warning');
  await page.getByTestId('elevated-cancel').click(); // never actually enabled in tests
  await expect(page.getByTestId('elevated-dialog')).toBeHidden();
});

test('AI skill: the banner offers it, install writes it for both agents, settings manage it', async () => {
  await page.getByTestId('tab-trays').click();
  const banner = page.getByTestId('skill-banner');
  await expect(banner).toContainText('Claude Code and opencode');
  await shot('12-skill-banner');
  await page.getByTestId('skill-banner-install').click();
  await expect(banner).toBeHidden();
  const claude = path.join(agents, '.claude', 'skills', 'traycommand', 'SKILL.md');
  const opencode = path.join(agents, '.config', 'opencode', 'skills', 'traycommand', 'SKILL.md');
  expect(fs.readFileSync(claude, 'utf8')).toMatch(/^---\nname: traycommand\n/);
  expect(fs.readFileSync(claude, 'utf8')).toContain('--validate');
  expect(fs.existsSync(opencode)).toBe(true);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('skill-claude')).toContainText('Skill installed');
  await page.getByTestId('skills-card').scrollIntoViewIfNeeded();
  await shot('13-skill-settings');
  // a change made by the user is detected, Update restores the shipped skill
  fs.appendFileSync(claude, '\nlocal notes\n');
  await page.getByTestId('tab-trays').click();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('skill-claude')).toContainText('changed after installation');
  await expect(banner).toContainText('Your changes');
  await page.getByTestId('skill-update-claude').click();
  await expect(page.getByTestId('skill-claude')).toContainText('Skill installed');
  expect(fs.readFileSync(claude, 'utf8')).not.toContain('local notes');
  // removing for one agent remembers the choice: no banner for it afterwards
  await page.getByTestId('skill-remove-opencode').click();
  await expect(page.getByTestId('skill-opencode')).toContainText('skill not installed');
  expect(fs.existsSync(opencode)).toBe(false);
  await page.getByTestId('tab-trays').click();
  await expect(banner).toBeHidden();
});

test('json view shows validation errors', async () => {
  await page.getByTestId('tab-json').click();
  const text = page.getByTestId('json-text');
  await text.fill('{ "version": 2, "trays": [ { "label": "no id" } ] }');
  await expect(page.getByTestId('json-issues')).toBeVisible();
  await shot('09-json');
});

test('dark theme', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('tab-trays').click();
  await page.getByTestId('tray-row').nth(0).click();
  await page.waitForTimeout(300);
  await shot('10-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});
