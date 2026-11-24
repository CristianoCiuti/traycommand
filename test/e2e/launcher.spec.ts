import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeApp } from './support/windows';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let editor: Page;
let launcher: Page;
let work: string;
let out: string;

const read = (name: string) => {
  try {
    return fs.readFileSync(path.join(out, name), 'utf8').replace(/^﻿/, '').trim();
  } catch {
    return undefined; // not written yet, or being written by the scheduled command (EBUSY): the poll retries
  }
};
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
  await closeApp(app);
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
  // the pointer resting where the rows appear must not change the selection when the launcher opens
  await launcher.mouse.move(300, 200);
  await hook('await tc.launcher.open()');
  await launcher.mouse.move(300, 200);
  // the entry used last is in "Recent"
  await expect(launcher.locator('.lx-section').first()).toHaveText('Recent');
  await expect(launcher.getByTestId('launcher-item').first()).toContainText('Deploy app');
  await expect(launcher.getByTestId('launcher-item').first()).toHaveAttribute('aria-selected', 'true');
  await launcher.keyboard.press('Enter');
  await expect(launcher.getByTestId('launcher-field-BRANCH')).toHaveValue('feature/x');
  await expect(launcher.getByTestId('launcher-field-ENV')).toHaveValue('prod');
  await launcher.keyboard.press('Escape');
  await expect(launcher.getByTestId('launcher-list')).toBeVisible();
  await expect(launcher.getByTestId('launcher-input')).toBeFocused();
  // a real mouse movement over a row selects it
  const row = launcher.getByTestId('launcher-item').nth(2);
  const box = (await row.boundingBox())!;
  await launcher.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 3 });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('launcher: the arrow keys scroll the list under a resting pointer without the pointer taking the selection', async () => {
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  const list = launcher.locator('.lx-list');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 40), 'the list scrolls').toBe(true);
  // the pointer rests on the second visible row (a real move selects it)
  const rows = launcher.getByTestId('launcher-item');
  const box = (await rows.nth(1).boundingBox())!;
  await launcher.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 3 });
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(list).not.toHaveClass(/lx-arrows/);
  // every row that is ever selected, in order: nothing in between may flash selected
  await list.evaluate((el) => {
    const w = window as unknown as { picked: string[] };
    w.picked = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        const t = m.target as HTMLElement;
        if (t.getAttribute('aria-selected') === 'true') w.picked.push(t.dataset.index!);
      }
    }).observe(el, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    // at every frame, just before it is drawn: the selected row is inside the visible part of the list
    const v = window as unknown as { hidden: string[]; watch: boolean };
    v.hidden = [];
    v.watch = true;
    const frame = () => {
      const row = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (row) {
        const r = row.getBoundingClientRect();
        const l = el.getBoundingClientRect();
        if (r.top < l.top - 1 || r.bottom > l.bottom + 1) v.hidden.push(row.dataset.index!);
      }
      if (v.watch) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const count = await rows.count();
  const down = Math.min(count - 2, 14);
  for (let i = 0; i < down; i++) {
    await launcher.keyboard.press('ArrowDown');
    await expect(rows.nth(2 + i)).toHaveAttribute('aria-selected', 'true');
    // let the scroll land and the mouse events it causes arrive
    await launcher.waitForTimeout(60);
  }
  await expect(list).toHaveClass(/lx-arrows/);
  expect(await list.evaluate((el) => el.scrollTop), 'the list scrolled').toBeGreaterThan(0);
  for (let i = down; i > 0; i--) {
    await launcher.keyboard.press('ArrowUp');
    await expect(rows.nth(i)).toHaveAttribute('aria-selected', 'true');
    await launcher.waitForTimeout(60);
  }
  const picked = await launcher.evaluate(() => (window as unknown as { picked: string[] }).picked);
  const expected = [...Array.from({ length: down }, (_, i) => String(2 + i)), ...Array.from({ length: down }, (_, i) => String(down - i))];
  expect(picked).toEqual(expected);
  const hidden = await launcher.evaluate(() => {
    const v = window as unknown as { hidden: string[]; watch: boolean };
    v.watch = false;
    return v.hidden;
  });
  expect(hidden, 'frames drawn with the selected row out of view').toEqual([]);
  // moving the pointer again gives it the selection back
  await launcher.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 3 });
  await expect(list).not.toHaveClass(/lx-arrows/);
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('settings: how often updates are checked, only while the automatic check is on', async () => {
  await editor.bringToFront();
  await editor.getByTestId('tab-settings').click();
  const auto = editor.getByTestId('setting-check-updates');
  await expect(auto).toContainText('every 6 hours');
  // "Check now" changes the version line, never this one
  await expect(editor.getByTestId('update-state')).not.toContainText('6 hours');
  await auto.locator('label.switch').click();
  await expect(auto).not.toContainText('6 hours');
  await expect(auto).toContainText('Check now');
  await auto.locator('label.switch').click();
  await expect(auto).toContainText('every 6 hours');
  await editor.getByTestId('tab-trays').click();
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

test('launcher can be moved and opens again where it was left', async () => {
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('launcher.html'))!.getBounds());
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  // the search bar and the footer drag the window; the field stays a field
  const region = (sel: string) => launcher.locator(sel).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || (getComputedStyle(el) as unknown as Record<string, string>).webkitAppRegion);
  expect(await region('.lx-search')).toBe('drag');
  expect(await region('.lx-foot')).toBe('drag');
  expect(await region('[data-testid="launcher-input"]')).toBe('no-drag');
  const before = await bounds();
  // a move made by the person (as a drag does)
  await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('launcher.html'))!.setPosition(p.x, p.y), { x: before.x - 150, y: before.y - 60 });
  await launcher.waitForTimeout(500);
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  const after = await bounds();
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x - 150, y: before.y - 60 });
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
  // Settings → Launcher position → Reset: centred again
  await editor.getByTestId('tab-settings').click();
  await editor.getByTestId('reset-launcher-position').click();
  await expect.poll(() => hook('return tc.launcherStore.position')).toBeUndefined();
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  expect((await bounds()).x).toBe(before.x);
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
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

test('shortcuts can be removed: an entry and the launcher', async () => {
  const status = () => hook<{ path: string }[]>('return tc.hotkeys.status()').then((s) => s.map((x) => x.path).sort());
  const saved = () => JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  await editor.bringToFront();
  await editor.getByTestId('tab-trays').click();
  await editor.getByTestId('tray-row').nth(0).click();
  // the × button removes the shortcut of the entry
  await editor.getByTestId('entry-hotkey').locator('.hotkey-clear').click();
  await expect(editor.getByTestId('entry-hotkey')).not.toContainText('F8');
  // Delete on the focused field removes the shortcut of the menu tray
  await editor.getByTestId('tray-row').nth(1).click();
  await editor.getByTestId('entry-hotkey').focus();
  await editor.keyboard.press('Delete');
  await expect(editor.getByTestId('entry-hotkey')).not.toContainText('F9');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  expect(saved().trays[0]).not.toHaveProperty('hotkey');
  expect(saved().trays[1]).not.toHaveProperty('hotkey');
  await expect.poll(status).toEqual(['settings.launcherHotkey']);

  // the launcher shortcut: turned off, the launcher still opens from the tray menu
  await editor.getByTestId('tab-settings').click();
  await editor.getByTestId('launcher-hotkey').locator('.hotkey-clear').click();
  await expect(editor.getByTestId('launcher-hotkey')).toContainText('No shortcut');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  expect(saved().settings.launcherHotkey).toBe('');
  await expect.poll(status).toEqual([]);
  const item = await hook<{ label: string; accelerator?: string }>(
    `const i = tc.trays.menuFor('__traycommand__').items.find((i) => i.label === 'Search and run…'); return { label: i.label, accelerator: i.accelerator };`,
  );
  expect(item.accelerator ?? undefined).toBeUndefined();
  await hook('await tc.launcher.open()');
  await expect.poll(launcherVisible).toBe(true);
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('editor: run an entry when files appear in a folder, in a time window', async () => {
  const inbox = path.join(out, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const ticks = () => (read('tick.txt') ?? '').split(/\r?\n/).filter(Boolean).length;
  const watches = () => hook<{ state: string; path: string }[] | undefined>(`return tc.engine.status(tc.engine.get('ticker')).watches`);
  await editor.bringToFront();
  await editor.getByTestId('tab-trays').click();
  await editor.getByTestId('tray-row').nth(2).click();
  await editor.getByTestId('card-schedule').scrollIntoViewIfNeeded();
  await editor.getByTestId('schedule-mode-0').selectOption('watch');
  await editor.getByTestId('watch-path-0').fill('${env:TC_OUT}/inbox');
  await expect(editor.getByTestId('watch-files-0')).toHaveValue('*.txt');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[2].schedules[0]).toEqual({ watch: { path: '${env:TC_OUT}/inbox', files: '*.txt' } });
  await expect.poll(async () => (await watches())?.[0]?.state).toBe('watching');
  await expect(editor.getByTestId('watch-state')).toHaveText('watching now');
  // for the documentation image: a neutral folder instead of this machine's temp path
  await editor.evaluate(() => {
    (document.querySelector('[data-testid="watch-path-0"]') as HTMLInputElement).value = 'C:\\Scans\\Inbox';
    const first = document.querySelector('[data-testid="watch-summary"]')!.firstChild!;
    first.textContent = first.textContent!.replace(/ in .*$/, ' in C:\\Scans\\Inbox');
  });
  await editor.getByTestId('card-schedule').screenshot({ path: path.join(shots, '29-editor-watch.png') });

  const before = ticks();
  fs.writeFileSync(path.join(inbox, 'skip.csv'), 'x');
  fs.writeFileSync(path.join(inbox, 'order.txt'), 'x');
  await expect.poll(ticks, { timeout: 10_000 }).toBe(before + 1);
  await editor.getByTestId('tab-activity').click();
  await expect(editor.getByText('file watch').first()).toBeVisible();
  await editor.getByTestId('tab-trays').click();
  await editor.getByTestId('tray-row').nth(2).click();
  await editor.getByTestId('card-schedule').scrollIntoViewIfNeeded();

  // a time window that is closed now: the watch waits
  await editor.getByTestId('schedule-window-toggle-0').click();
  const h = new Date().getHours();
  await editor.getByTestId('schedule-from-0').fill(`${String((h + 2) % 24).padStart(2, '0')}:00`);
  await editor.getByTestId('schedule-to-0').fill(`${String((h + 3) % 24).padStart(2, '0')}:00`);
  await editor.getByTestId('schedule-window-days-0').getByRole('button', { name: 'Sat' }).click();
  await editor.getByTestId('schedule-window-days-0').getByRole('button', { name: 'Sun' }).click();
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  const windowed = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8')).trays[2].schedules[0];
  expect(windowed.between).toMatch(/^\d\d:00-\d\d:00$/);
  expect(windowed.days).toBeUndefined(); // every day again
  await expect.poll(async () => (await watches())?.[0]?.state).toBe('waiting');
  await expect(editor.getByTestId('watch-state')).toContainText('not now');
  await editor.getByTestId('card-schedule').screenshot({ path: path.join(shots, '30-editor-watch-window.png') });
  const now = ticks();
  fs.writeFileSync(path.join(inbox, 'later.txt'), 'x');
  await editor.waitForTimeout(3500);
  expect(ticks()).toBe(now);
});

test('alert of a schedule: a window over the others, chosen with the keyboard', async () => {
  for (const f of ['alert.txt', 'hello.txt']) fs.rmSync(path.join(out, f), { force: true });
  const fire = (alert: object) =>
    hook(`
      const e = tc.engine.get('tools');
      tc.lastAlert = tc.engine.fireSchedule(e, { every: '1h', alert: ${JSON.stringify(alert)} }, { TC_FILE: 'scan.pdf' });
    `);
  const choices = [
    { label: 'Say hello', run: 'hello' },
    { label: 'Save', action: 'Set-Content -Path "$env:TC_OUT/alert.txt" -Value "$env:TC_FILE"' },
  ];
  await fire({ title: 'New ${TC_FILE}', text: '${TC_FILE} has arrived.\nWhat should I do?', choices });
  await expect.poll(launcherVisible).toBe(true);
  const box = launcher.getByTestId('launcher-alert');
  await expect(box).toBeVisible();
  await expect(launcher.getByTestId('launcher-alert-title')).toHaveText('New scan.pdf');
  await expect(launcher.getByTestId('launcher-alert-text')).toHaveText('scan.pdf has arrived.\nWhat should I do?');
  // keys right after it appears are ignored (typing in another window must not answer it)
  await launcher.keyboard.press('Enter');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('data-armed', 'true');
  await shot(launcher, '30-alert');
  await launcher.keyboard.press('ArrowRight');
  await expect(launcher.getByTestId('launcher-alert-choice-1')).toBeFocused();
  await launcher.keyboard.press('2');
  await expect.poll(() => read('alert.txt')).toBe('scan.pdf');
  await expect.poll(launcherVisible).toBe(false);
  expect(read('hello.txt')).toBeUndefined();

  // Esc dismisses: nothing runs
  await fire({ text: 'Again', choices });
  await expect(box).toHaveAttribute('data-armed', 'true');
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
  expect(read('hello.txt')).toBeUndefined();

  // nobody answers: the default runs when the time is up, the window closes
  await fire({ text: 'Timer', choices, timeout: '5s', default: 'Say hello' });
  await expect(launcher.getByTestId('launcher-alert-timer')).toContainText('Say hello in 0:0');
  await expect.poll(() => read('hello.txt'), { timeout: 10_000 }).toBe('hello');
  await expect.poll(launcherVisible).toBe(false);

  // an alert without choices only informs: OK closes it
  await fire({ text: 'Just so you know' });
  await expect(launcher.getByTestId('launcher-alert-choice-0')).toHaveText('OK');
  await expect(box).toHaveAttribute('data-armed', 'true');
  await launcher.keyboard.press('Enter');
  await expect.poll(launcherVisible).toBe(false);
});

test('alert as a notification: its click shows the choices', async () => {
  fs.rmSync(path.join(out, 'alert.txt'), { force: true });
  await hook(`
    tc.lastAlert = tc.engine.fireSchedule(tc.engine.get('tools'), { every: '1h', alert: { style: 'notification', text: 'Click me', choices: [
      { label: 'Save', action: 'Set-Content -Path "$env:TC_OUT/alert.txt" -Value note' }, { label: 'Hello', run: 'hello' } ] } }, {});
  `);
  // the notification is waiting; nothing on screen yet
  await expect.poll(async () => hook<number>('return tc.alerts.notifications.size')).toBe(1);
  expect(await launcherVisible()).toBe(false);
  await hook('for (const n of tc.alerts.notifications.values()) n.emit("click")');
  await expect.poll(launcherVisible).toBe(true);
  await expect(launcher.getByTestId('launcher-alert')).toHaveAttribute('data-armed', 'true');
  await launcher.keyboard.press('Enter');
  await expect.poll(() => read('alert.txt')).toBe('note');
});

test('alert as a notification whose click runs a choice directly', async () => {
  fs.rmSync(path.join(out, 'alert.txt'), { force: true });
  await hook(`
    tc.lastAlert = tc.engine.fireSchedule(tc.engine.get('tools'), { every: '1h', alert: { style: 'notification', text: 'Click me', click: 'Save', choices: [
      { label: 'Hello', run: 'hello' }, { label: 'Save', action: 'Set-Content -Path "$env:TC_OUT/alert.txt" -Value direct' } ] } }, {});
  `);
  await expect.poll(async () => hook<number>('return tc.alerts.notifications.size')).toBe(1);
  await hook('for (const n of tc.alerts.notifications.values()) n.emit("click")');
  await expect.poll(() => read('alert.txt')).toBe('direct');
  expect(await launcherVisible()).toBe(false); // no window with the choices
});

test('shortcut with a confirmation: its own texts, Esc cancels, the button runs', async () => {
  fs.rmSync(path.join(out, 'hello.txt'), { force: true });
  const key = await hook<string>("const e = tc.engine.get('hello'); e.entry.hotkeyConfirm = { text: 'Say it ${NOPE}?', button: 'Say it' }; return e.key");
  try {
    await hook(`tc.hotkeyFired('${key}')`);
    await expect.poll(launcherVisible).toBe(true);
    const box = launcher.getByTestId('launcher-alert');
    await expect(box).toHaveAttribute('data-armed', 'true');
    await expect(launcher.getByTestId('launcher-alert-title')).toHaveText('Say hello');
    await expect(launcher.getByTestId('launcher-alert-text')).toContainText('Say it');
    await expect(launcher.getByTestId('launcher-alert-choice-0')).toHaveText('Say it');
    await shot(launcher, '31-hotkey-confirm');
    await launcher.keyboard.press('Escape');
    await expect.poll(launcherVisible).toBe(false);
    await launcher.waitForTimeout(800);
    expect(read('hello.txt')).toBeUndefined();

    await hook(`tc.hotkeyFired('${key}')`);
    await expect(box).toHaveAttribute('data-armed', 'true');
    await launcher.keyboard.press('Enter');
    await expect.poll(() => read('hello.txt')).toBe('hello');
    await expect.poll(launcherVisible).toBe(false);
  } finally {
    await hook("delete tc.engine.get('hello').entry.hotkeyConfirm");
  }
});

test('action confirm: a click asks in the TrayCommand window with its own button, Esc cancels', async () => {
  fs.rmSync(path.join(out, 'hello.txt'), { force: true });
  const before = await hook<unknown>("return tc.engine.get('hello').entry.action");
  const key = await hook<string>(`const e = tc.engine.get('hello'); const a = e.entry.action;
    e.entry.action = { ...(typeof a === 'string' ? { run: a } : a), confirm: { text: 'Riavviare la VDI?', button: 'Riavvia' } }; return e.key`);
  try {
    await hook(`tc.engine.click('${key}')`);
    await expect.poll(launcherVisible).toBe(true);
    const box = launcher.getByTestId('launcher-alert');
    await expect(box).toHaveAttribute('data-armed', 'true');
    await expect(launcher.getByTestId('launcher-alert-title')).toHaveText('Say hello');
    await expect(launcher.getByTestId('launcher-alert-text')).toContainText('Riavviare la VDI?');
    await expect(launcher.getByTestId('launcher-alert-choice-0')).toHaveText('Riavvia');
    await shot(launcher, '34-action-confirm');
    await launcher.keyboard.press('Escape');
    await expect.poll(launcherVisible).toBe(false);
    await launcher.waitForTimeout(800);
    expect(read('hello.txt')).toBeUndefined();

    // the string form: the "Run" button; Enter runs
    await hook(`tc.engine.get('${key}').entry.action.confirm = 'Say it?'`);
    await hook(`tc.engine.click('${key}')`);
    await expect(box).toHaveAttribute('data-armed', 'true');
    await expect(launcher.getByTestId('launcher-alert-choice-0')).toHaveText('Run');
    await launcher.keyboard.press('Enter');
    await expect.poll(() => read('hello.txt')).toBe('hello');
    await expect.poll(launcherVisible).toBe(false);
  } finally {
    await hook(`tc.engine.get('hello').entry.action = ${JSON.stringify(before)}`);
  }
});

test('alert over the open launcher: back to the list after it; Space runs a button once', async () => {
  fs.rmSync(path.join(out, 'space.txt'), { force: true });
  await hook('await tc.launcher.open()');
  await launcher.keyboard.type('hel');
  await expect(launcher.getByTestId('launcher-input')).toHaveValue('hel');
  await hook(`
    tc.lastAlert = tc.engine.fireSchedule(tc.engine.get('tools'), { every: '1h', alert: { text: 'Count', choices: [
      { label: 'Add a line', action: 'Add-Content -Path "$env:TC_OUT/space.txt" -Value x' } ] } }, {});
  `);
  const box = launcher.getByTestId('launcher-alert');
  await expect(box).toHaveAttribute('data-armed', 'true');
  await launcher.keyboard.press('Space');
  await expect.poll(() => read('space.txt')).toBe('x');
  // back to the list, with the search as it was
  await expect(launcher.getByTestId('launcher-input')).toBeVisible();
  await expect(launcher.getByTestId('launcher-input')).toHaveValue('hel');
  await launcher.waitForTimeout(1500);
  expect(read('space.txt')).toBe('x'); // one line: the button ran once
  await launcher.keyboard.press('Escape');
  await launcher.keyboard.press('Escape');
  await expect.poll(launcherVisible).toBe(false);
});

test('editor: only if a check passes, and an alert with buttons', async () => {
  await editor.bringToFront();
  await editor.getByTestId('tab-trays').click();
  await editor.getByTestId('tray-row').nth(2).click();
  await editor.getByTestId('card-schedule').scrollIntoViewIfNeeded();
  const before = await editor.getByTestId('schedule').count();
  await editor.getByTestId('add-schedule').click();
  const i = before;
  await editor.getByTestId(`schedule-mode-${i}`).selectOption('watch');
  await editor.getByTestId(`watch-path-${i}`).fill('C:\\Scans');
  await editor.getByTestId(`schedule-if-toggle-${i}`).click();
  await editor.getByTestId(`schedule-if-check-${i}`).fill('(Get-Item $env:TC_FILE).Length -gt 0');
  await editor.getByTestId(`schedule-alert-toggle-${i}`).click();
  await editor.getByTestId(`alert-text-${i}`).fill('${TC_FILE_NAME} has arrived');
  await editor.getByTestId(`alert-add-choice-${i}`).click();
  const second = editor.getByTestId(`alert-choice-${i}-1`);
  await second.getByLabel('Text of the button').fill('Archive');
  await second.getByLabel('What the button does').selectOption('command');
  await second.getByLabel('Command').fill('Move-Item $env:TC_FILE D:\\Archive');
  await editor.getByTestId(`alert-timeout-${i}`).fill('2');
  await editor.getByTestId(`alert-default-${i}`).selectOption('Archive');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  await editor.getByTestId(`schedule-alert-${i}`).scrollIntoViewIfNeeded();
  await editor.getByTestId(`schedule-alert-${i}`).screenshot({ path: path.join(shots, '31-editor-alert.png') });
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8')).trays[2].schedules[i];
  expect(saved).toEqual({
    watch: { path: 'C:\\Scans', files: '*.txt' },
    if: '(Get-Item $env:TC_FILE).Length -gt 0',
    alert: {
      text: '${TC_FILE_NAME} has arrived',
      choices: [
        { label: 'Run', run: 'self' },
        { label: 'Archive', action: 'Move-Item $env:TC_FILE D:\\Archive' },
      ],
      timeout: '2m',
      default: 'Archive',
    },
  });
  // the timeout typed in seconds keeps the digits typed (no unit change while typing)
  await editor.getByTestId(`schedule-alert-${i}`).getByLabel('Unit').selectOption('s');
  await editor.getByTestId(`alert-timeout-${i}`).fill('');
  await editor.getByTestId(`alert-timeout-${i}`).pressSequentially('605');
  await expect(editor.getByTestId(`alert-timeout-${i}`)).toHaveValue('605');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  const again = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8')).trays[2].schedules[i];
  expect(again.alert.timeout).toBe('605s');
  expect(again.alert.default).toBe('Archive');
});

test('editor: a notification whose click runs a button; a shortcut that asks first', async () => {
  const i = (JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8')).trays[2].schedules as unknown[]).length - 1;
  // the click choice is offered only for notifications
  await expect(editor.getByTestId(`alert-click-${i}`)).toHaveCount(0);
  await editor.getByTestId(`alert-style-${i}`).selectOption('notification');
  await editor.getByTestId(`alert-click-${i}`).selectOption('Archive');
  await editor.getByTestId(`schedule-alert-${i}`).screenshot({ path: path.join(shots, '32-editor-alert-click.png') });
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  let saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[2].schedules[i].alert).toMatchObject({ style: 'notification', click: 'Archive' });
  // back to a window: the click choice goes away
  await editor.getByTestId(`alert-style-${i}`).selectOption('window');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[2].schedules[i].alert.click).toBeUndefined();

  // the shortcut of "Deploy app" asks first, with its own texts
  await editor.getByTestId('tray-row').nth(0).click();
  await editor.getByTestId('card-hotkey').scrollIntoViewIfNeeded();
  // a shortcut of its own (an earlier test may have removed it)
  await editor.getByTestId('entry-hotkey').click();
  await editor.keyboard.press('Control+Alt+Shift+F7');
  await expect(editor.getByTestId('entry-hotkey')).toContainText('F7');
  await expect(editor.getByTestId('hotkey-confirm-text')).toHaveCount(0);
  await editor.getByTestId('hotkey-confirm').click();
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].hotkeyConfirm).toBe(true);
  await editor.getByTestId('hotkey-confirm-text').fill('Deploy now?');
  await editor.getByTestId('hotkey-confirm-button').fill('Deploy');
  await editor.getByTestId('card-hotkey').screenshot({ path: path.join(shots, '33-editor-hotkey-confirm.png') });
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].hotkeyConfirm).toEqual({ text: 'Deploy now?', button: 'Deploy' });

  // the confirmation of the action: the question, then the text of its button
  const action = editor.getByTestId('action');
  if (!(await action.getByTestId('action-confirm').isVisible())) await action.getByRole('button', { name: /^Options/ }).click();
  await action.getByTestId('action-confirm').fill('Riavviare la VDI?');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].action.confirm).toBe('Riavviare la VDI?');
  await action.getByTestId('action-confirm-button').fill('Riavvia');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].action.confirm).toEqual({ text: 'Riavviare la VDI?', button: 'Riavvia' });
  // no button text: back to the plain question
  await action.getByTestId('action-confirm-button').fill('');
  await editor.keyboard.press('Control+S');
  await expect(editor.getByTestId('savebar')).toBeHidden();
  saved = JSON.parse(fs.readFileSync(path.join(work, 'launcher.json'), 'utf8'));
  expect(saved.trays[0].action.confirm).toBe('Riavviare la VDI?');
});
