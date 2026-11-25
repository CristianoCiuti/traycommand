import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { closeApp, editorWindow } from './support/windows';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lists whose order matters can be reordered by dragging; "Run after" looks like "Run before";
// "Enabled when" combines toggles with and / or, also in groups.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let page: Page;
let work: string;

const toggle = (id: string, label: string) => ({ id, label, state: { check: 'exit 1', interval: 3600 }, action: 'echo on', offAction: 'echo off' });

const config = {
  version: 2,
  settings: { shell: 'powershell', theme: 'system', appMenu: 'own' },
  trays: [
    {
      id: 'work',
      label: 'Work',
      action: {
        run: 'echo ${FIRST} ${SECOND}',
        before: ['vpn', 'proxy'],
        parallel: ['notepad'],
        after: ['vpn', { run: 'proxy', when: 'failed' }, { run: 'server:on', exitCodes: [0, 3] }],
        inputs: [{ name: 'FIRST' }, { name: 'SECOND' }],
      },
      enabledWhen: { all: ['vpn', { any: ['proxy', '!server'] }] },
      schedules: [{ cron: '0 9 * * 1-5', alert: { text: 'Start working?', choices: [{ label: 'Yes', run: 'self' }, { label: 'No', action: 'echo no' }, { label: 'Later', action: 'echo later' }] } }],
      menu: [toggle('vpn', 'VPN'), toggle('proxy', 'Proxy'), toggle('server', 'Server'), { id: 'notepad', label: 'Notepad', action: 'echo notepad' }],
    },
    {
      id: 'vdi',
      label: 'VDI',
      menu: [
        // a title that tells the state: no action, its text follows ON / OFF
        { id: 'vdi_status', label: 'VDI started and running', state: { check: 'exit 1', interval: 3600, labelOff: 'VDI not started' } },
        { separator: true },
        // exit 3 = "not started": goes on with the portal, without an error
        { id: 'vdi_show', label: 'Show the VDI', action: { run: 'exit 3', after: [{ run: 'vdi_portal', exitCodes: [3] }] } },
        { id: 'vdi_portal', label: 'Open from the portal', action: { run: 'echo portal', confirm: { text: 'Download a new .ica?', button: 'Open' } } },
        // an exit code nobody takes over: still an error
        { id: 'vdi_broken', label: 'Broken step', action: 'exit 5' },
      ],
    },
  ],
};
/** What TrayCommand would notify (an isolated run writes its notifications to its output). */
const notifications: string[] = [];

const saved = () => JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8')).trays[0];
async function save() {
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('savebar')).toBeHidden();
}
async function shot(target: Locator, name: string) {
  fs.mkdirSync(shots, { recursive: true });
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: path.join(shots, `${name}.png`) });
}
/** Run before, Run together and Run after, from the first label to the last hint (in a tall window, so all of it is in view). */
async function shotLists(name: string) {
  fs.mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1200, height: 3000 });
  const first = (await page.getByTestId('action-before').locator('xpath=..').boundingBox())!;
  const last = (await page.getByTestId('action-after').locator('xpath=..').boundingBox())!;
  await page.screenshot({ path: path.join(shots, `${name}.png`), clip: { x: first.x - 10, y: first.y - 10, width: first.width + 20, height: last.y + last.height - first.y + 20 } });
  await page.setViewportSize({ width: 1200, height: 900 });
}

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-e2e-lists-'));
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(config, null, 2));
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') },
  });
  app.process().stdout?.on('data', (d: Buffer) => notifications.push(...String(d).split(/\r?\n/).filter((l) => l.startsWith('[notification]'))));
  page = await editorWindow(app);
  // light or dark comes from the system theme, as in the app (Playwright forces light otherwise)
  await page.emulateMedia({ colorScheme: 'no-override' as never });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForSelector('[data-testid="tray-list"]');
  const notNow = page.getByRole('button', { name: 'Not now' }); // the banner of the AI skill would cover the pictures
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await page.getByTestId('tray-row').nth(0).click();
  const action = page.getByTestId('action');
  if (!(await action.getByTestId('action-after').isVisible())) await action.getByRole('button', { name: /^Options/ }).click();
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

test('pictures of every changed part, in every look, light and dark', async () => {
  test.setTimeout(240_000);
  const setDark = async (dark: boolean) => {
    await app.evaluate(({ nativeTheme }, d) => (nativeTheme.themeSource = d ? 'dark' : 'light'), dark);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(dark);
  };
  for (const dark of [false, true]) {
    await setDark(dark);
    for (const look of ['aurora', 'terminal', 'brutal', 'neon']) {
      await page.getByTestId('tab-settings').click();
      await page.getByTestId(`look-${look}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-style', look);
      await page.getByTestId('tab-trays').click();
      await save(); // the look is a setting: saved, so the bar of unsaved changes is not in the pictures
      await setDark(dark); // saving applies the theme setting ("same as system")
      await expect(page.locator('.toast')).toBeHidden({ timeout: 15_000 });
      const tag = `${look}-${dark ? 'dark' : 'light'}`;
      await shotLists(`50-lists-${tag}`);
      await shot(page.getByTestId('action-inputs'), `51-inputs-${tag}`);
      await shot(page.getByTestId('card-schedule'), `52-alert-${tag}`);
      await shot(page.getByTestId('card-menu'), `53-menu-${tag}`);
      await shot(page.getByTestId('card-enabled-when'), `54-enabled-when-${tag}`);
    }
  }
  // while dragging: the place under the pointer is marked (released back on itself: nothing moves)
  const from = page.getByTestId('action-after-0-grip');
  await from.scrollIntoViewIfNeeded();
  await from.hover();
  await page.mouse.down();
  await page.getByTestId('action-after-2-grip').hover();
  await page.getByTestId('action-after-2-grip').hover({ position: { x: 4, y: 4 } });
  await shotLists('55-dragging');
  await from.hover();
  await from.hover({ position: { x: 4, y: 4 } });
  await page.mouse.up();
  // an exit code missing: the chip of the codes is marked
  await page.getByTestId('action-after-2-codes').fill('');
  await shotLists('56-codes-missing');
  await page.getByTestId('action-after-2-codes').fill('0, 3');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('look-aurora').click();
  await page.getByTestId('tab-trays').click();
  await setDark(false);
  await save();
});

test('run after uses the same chips as run before, and its conditions sit beside them', async () => {
  const after = page.getByTestId('action-after');
  await expect(after.getByTestId('action-after-0-entry')).toContainText('vpn');
  await expect(after.getByTestId('action-after-1-when')).toHaveValue('failed');
  await expect(after.getByTestId('action-after-2-entry').locator('select')).toHaveValue('on');
  await expect(after.getByTestId('action-after-2-codes')).toHaveValue('0, 3');
  await shotLists('40-run-before-together-after');

  await after.getByTestId('action-after-1-entry').getByRole('button', { name: 'Remove' }).click();
  await save();
  expect(saved().action.after).toEqual(['vpn', { run: 'server:on', exitCodes: [0, 3] }]);
  await after.getByTestId('action-after-add').selectOption('proxy');
  await after.getByTestId('action-after-2-when').selectOption('failed');
  await save();
  expect(saved().action.after).toEqual(['vpn', { run: 'server:on', exitCodes: [0, 3] }, { run: 'proxy', when: 'failed' }]);
});

test('drag to reorder: run before, run after, inputs, alert buttons and menu entries', async () => {
  await page.getByTestId('action-before-1-entry').dragTo(page.getByTestId('action-before-0-entry'), { sourcePosition: { x: 12, y: 10 }, targetPosition: { x: 12, y: 10 } });
  await save();
  expect(saved().action.before).toEqual(['proxy', 'vpn']);

  await page.getByTestId('action-after-2-grip').dragTo(page.getByTestId('action-after-0-grip'));
  await save();
  expect(saved().action.after).toEqual([{ run: 'proxy', when: 'failed' }, 'vpn', { run: 'server:on', exitCodes: [0, 3] }]);
  // each row shows the item now in its place
  await expect(page.getByTestId('action-after-0-when')).toHaveValue('failed');
  await expect(page.getByTestId('action-after-2-codes')).toHaveValue('0, 3');

  await shot(page.getByTestId('action-inputs'), '45-inputs-handles');
  await page.getByTestId('input-grip-1').dragTo(page.getByTestId('input-grip-0'));
  await save();
  expect(saved().action.inputs.map((x: { name: string }) => x.name)).toEqual(['SECOND', 'FIRST']);

  await page.getByTestId('card-schedule').scrollIntoViewIfNeeded();
  await page.getByTestId('alert-choice-grip-0-2').dragTo(page.getByTestId('alert-choice-grip-0-0'));
  await save();
  expect(saved().schedules[0].alert.choices.map((x: { label: string }) => x.label)).toEqual(['Later', 'Yes', 'No']);

  const grips = page.getByTestId('card-menu').getByTestId('menu-grip');
  await grips.nth(3).dragTo(grips.nth(0));
  await shot(page.getByTestId('card-menu'), '44-menu-handles');
  await save();
  expect(saved().menu.map((x: { label: string }) => x.label)).toEqual(['Notepad', 'VPN', 'Proxy', 'Server']);
});

test('enabled when: all / any of several toggles, with groups', async () => {
  const card = page.getByTestId('card-enabled-when');
  const summary = card.getByTestId('enabled-when-summary');
  await expect(summary).toContainText('VPN is ON and (Proxy is ON or Server is OFF)');
  // the group: Server ON instead of OFF, then "all" instead of "any"
  await card.getByTestId('enabled-when-root-1-1-state').selectOption('on');
  await card.getByTestId('enabled-when-root-1-all').click();
  await save();
  expect(saved().enabledWhen).toEqual({ all: ['vpn', { all: ['proxy', 'server'] }] });
  await expect(summary).toContainText('VPN is ON and (Proxy is ON and Server is ON)');

  // removing the group's toggles removes the group; one toggle left is saved as just its id
  await card.getByTestId('enabled-when-root-1-1-remove').click();
  await card.getByTestId('enabled-when-root-1-0-remove').click();
  await save();
  expect(saved().enabledWhen).toBe('vpn');

  // any of: VPN or a new group of "and"
  await card.getByTestId('enabled-when-root-any').click();
  await card.getByTestId('enabled-when-root-add-group').click();
  await card.getByTestId('enabled-when-root-1-add').selectOption('proxy');
  await card.getByTestId('enabled-when-root-1-add').selectOption('server');
  await card.getByTestId('enabled-when-root-1-1-state').selectOption('off');
  await save();
  expect(saved().enabledWhen).toEqual({ any: ['vpn', { all: ['proxy', '!server'] }] });
  await expect(summary).toContainText('VPN is ON or (Proxy is ON and Server is OFF)');
  await shot(card, '43-enabled-when-any');

  // everything removed: always clickable
  await card.getByTestId('enabled-when-root-1-remove').click();
  await card.getByTestId('enabled-when-root-0-remove').click();
  await save();
  expect(saved().enabledWhen).toBeUndefined();
  await expect(summary).toContainText('Always clickable');
});

type MenuHook = { __traycommand: { trays: { menuFor(k: string): { items: { label: string; type: string; enabled: boolean }[] } }; engine: { click(k: string): Promise<boolean> } } };

test('state.labelOff: a title at the top of the menu tells the state, greyed out; the editor sets its text', async () => {
  const title = () => app.evaluate(() => {
    const i = (globalThis as unknown as MenuHook).__traycommand.trays.menuFor('vdi').items[0]!;
    return { label: i.label, type: i.type, enabled: i.enabled };
  });
  // every save reloads the configuration and checks all the states again (PowerShell, slow on a busy PC)
  await expect.poll(title, { timeout: 60_000 }).toEqual({ label: 'VDI not started', type: 'checkbox', enabled: false });

  await page.getByTestId('tray-row').nth(1).click();
  await page.getByTestId('card-menu').getByText('VDI started and running').click();
  const field = page.getByTestId('state-label-off');
  await expect(field).toHaveValue('VDI not started');
  await shot(page.getByTestId('card-state'), '57-state-label-off');
  await field.fill('VDI is off');
  await save();
  expect(JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8')).trays[1].menu[0].state.labelOff).toBe('VDI is off');
  await expect.poll(async () => (await title()).label, { timeout: 60_000 }).toBe('VDI is off');
});

test('an exit code routed by after is not an error: no error notification, "Exit 3 ↪" in the activity, the next entry asks its confirmation', async () => {
  const launcher = app.windows().find((w) => w.url().includes('launcher.html'))!;
  const clicked = app.evaluate(() => (globalThis as unknown as MenuHook).__traycommand.engine.click('vdi_show'));
  await expect(launcher.getByTestId('launcher-alert-text')).toHaveText('Download a new .ica?');
  await expect(launcher.getByTestId('launcher-alert-choice-0')).toHaveText('Open');
  await expect(launcher.getByTestId('launcher-alert')).toHaveAttribute('data-armed', 'true');
  await launcher.getByTestId('launcher-alert-choice-0').click();
  await clicked;
  await page.getByTestId('tab-activity').click();
  const routed = page.getByTestId('log-table').locator('tr', { hasText: 'Show the VDI' }).first();
  await expect(routed).toContainText('Exit 3 ↪');
  await expect(page.getByTestId('log-table').locator('tr', { hasText: 'Open from the portal' }).first()).toContainText('OK');
  await routed.click();
  await expect(page.getByTestId('log-table')).toContainText('Exit code 3: goes on with “Open from the portal”');
  await shot(page.getByTestId('log-table'), '58-activity-routed');
  expect(notifications.filter((n) => n.includes('Show the VDI'))).toEqual([]);
  // an exit code nobody takes over is still notified as an error (and the notifications are really seen here)
  await app.evaluate(() => (globalThis as unknown as MenuHook).__traycommand.engine.click('vdi_broken'));
  await expect.poll(() => notifications.filter((n) => n.includes('Broken step'))).toEqual(['[notification] Broken step: Failed: Exit code 5']);

  // the new parts in every look
  for (const look of ['terminal', 'brutal', 'neon', 'aurora']) {
    await page.getByTestId('tab-settings').click();
    await page.getByTestId(`look-${look}`).click();
    await save();
    await expect(page.locator('.toast')).toBeHidden({ timeout: 15_000 });
    await page.getByTestId('tab-activity').click();
    await page.getByTestId('log-table').locator('tr', { hasText: 'Show the VDI' }).first().click();
    await shot(page.getByTestId('log-table'), `59-activity-routed-${look}`);
    await page.getByTestId('tab-trays').click();
    await page.getByTestId('tray-row').nth(1).click();
    await page.getByTestId('card-menu').getByText('VDI started and running').click();
    await shot(page.getByTestId('card-state'), `59-state-label-off-${look}`);
  }
  await page.getByTestId('tab-trays').click();
});
