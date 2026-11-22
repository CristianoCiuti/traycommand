/*
 * Every look, chosen from the settings: the editor shows it at once, the launcher after saving, the window
 * buttons take its title bar colours (light and dark). Screenshots of each look go to test-results/looks/<look>.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeApp, editorWindow } from './support/windows';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shotsRoot = path.join(root, 'test-results', 'looks');
const ALL_LOOKS = ['aurora', 'terminal', 'brutal', 'neon'] as const;
/** LOOK=<name> checks a single look (used while working on it). */
const LOOKS = process.env.LOOK ? ALL_LOOKS.filter((l) => l === process.env.LOOK) : ALL_LOOKS;
let app: ElectronApplication;
let page: Page;
let launcher: Page;
let work: string;

type Hook = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hook = (src: string) =>
  app.evaluate(async (_e, s) => {
    const tc = (globalThis as unknown as { __traycommand: Hook }).__traycommand;
    return new Function('tc', `return (async () => { ${s} })()`)(tc);
  }, src);
const shot = async (p: Page, look: string, name: string) => {
  fs.mkdirSync(path.join(shotsRoot, look), { recursive: true });
  await p.waitForTimeout(450);
  await p.screenshot({ path: path.join(shotsRoot, look, `${name}.png`) });
};
const launcherVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('launcher.html'))?.isVisible() ?? false);

/**
 * The launcher window (list, form or alert) is exactly its panel: no shadow cut by the window edges,
 * nothing covered around it (Brutal keeps its hard offset shadow). Its header and footer move the window.
 */
async function panelFits(look: string) {
  const fit = await launcher.evaluate(() => {
    // layout size (not the box on screen, which the opening animation scales for a moment)
    const lx = document.querySelector('.lx:not([style*="display: none"])') as HTMLElement;
    const shadow = getComputedStyle(lx).boxShadow;
    const region = (sel: string) => {
      const el = lx.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') || (getComputedStyle(el) as unknown as Record<string, string>).webkitAppRegion : 'drag';
    };
    return {
      w: window.innerWidth, h: window.innerHeight, lw: lx.offsetWidth, lh: lx.offsetHeight,
      outer: shadow.split(/,(?![^(]*\))/).filter((s) => s !== 'none' && !s.includes('inset')),
      head: region('.lx-head'), foot: region('.lx-foot'), search: region('.lx-search'),
    };
  });
  if (look !== 'brutal') {
    expect(Math.abs(fit.w - fit.lw), `window as wide as the panel ${JSON.stringify(fit)}`).toBeLessThanOrEqual(2);
    expect(Math.abs(fit.h - fit.lh), `window as tall as the panel ${JSON.stringify(fit)}`).toBeLessThanOrEqual(2);
    expect(fit.outer, 'no shadow outside the panel').toEqual([]);
  }
  expect([fit.head, fit.foot, fit.search], 'header, footer and search bar move the window').toEqual(['drag', 'drag', 'drag']);
}
const savedChrome = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(work, 'data', 'state.json'), 'utf8')).chrome as { bg: string; fg: string } | undefined;
  } catch {
    return undefined;
  }
};
const pageChrome = (p: Page) =>
  p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { bg: cs.getPropertyValue('--chrome-bg').trim(), fg: cs.getPropertyValue('--chrome-fg').trim() };
  });
/** Light or dark for the whole app, as the system theme would; waits until the editor shows it. */
const setDark = async (dark: boolean) => {
  await app.evaluate(({ nativeTheme }, d) => (nativeTheme.themeSource = d ? 'dark' : 'light'), dark);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(dark);
};

test.setTimeout(240_000);

test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-looks-'));
  fs.cpSync(path.join(here, 'fixtures'), work, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
  const server = cfg.trays.find((t: { id: string }) => t.id === 'server');
  server.hotkey = 'Ctrl+Alt+W';
  // shown at the end of the launcher search bar
  cfg.settings.launcherHotkey = 'Ctrl+Alt+Shift+F10';
  server.schedules = [
    {
      watch: { path: '${env:USERPROFILE}\\Scans', files: ['*.pdf'], events: ['add'] },
      between: '08:00-19:00',
      days: 'mon-fri',
      if: 'Test-Path "$env:TC_FILE"',
      alert: { title: 'New scan', text: '${TC_FILE_NAME} has arrived', choices: [{ label: 'Archive', run: 'self' }, { label: 'Open', action: 'Start-Process "$env:TC_FILE"' }], timeout: '2m', default: 'Archive' },
    },
  ];
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(cfg, null, 2));
  fs.writeFileSync(
    path.join(work, 'shared.json'),
    JSON.stringify({
      traycommandExport: 1,
      app: '2.6.0',
      trays: [
        { id: 'server', label: 'Web server', action: 'echo other', menu: [{ id: 'server_logs', label: 'Logs', action: 'echo logs' }] },
        { id: 'docs', label: 'Docs', icon: 'icons/note.png', action: { run: 'echo docs', admin: true }, hotkey: 'Ctrl+Alt+Space' },
        { id: 'notes', label: 'My notes', action: 'echo mine' },
      ],
      variables: { WS: 'D:/elsewhere', NEW_VAR: 'x' },
      settings: { allowAdminCommands: true },
    }),
  );
  app = await electron.launch({
    args: [root, `--data-dir=${path.join(work, 'data')}`, `--config=${path.join(work, 'config.json')}`],
    env: { ...process.env, TRAYCOMMAND_E2E: '1', TRAYCOMMAND_AGENTS_HOME: path.join(work, 'home') },
  });
  page = await editorWindow(app);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForSelector('[data-testid="tray-list"]');
  await expect.poll(() => app.windows().some((w) => w.url().includes('launcher.html'))).toBe(true);
  launcher = app.windows().find((w) => w.url().includes('launcher.html'))!;
  await launcher.waitForLoadState('domcontentloaded');
  // Playwright forces "light" on the pages by default: drop it, so that light or dark comes from the system theme, as in the app
  for (const p of [page, launcher]) await p.emulateMedia({ colorScheme: 'no-override' as never });
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await app.evaluate(({ dialog }, f) => void (dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never), path.join(work, 'shared.json'));
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

test('Aurora is the look at first', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-style', 'aurora');
  await expect(launcher.locator('html')).toHaveAttribute('data-style', 'aurora');
});

for (const look of LOOKS) {
  test(`look: ${look}`, async () => {
    await setDark(false);
    // chosen in the settings: shown at once, kept with Save
    await page.getByTestId('tab-settings').click();
    await page.getByTestId(`look-${look}`).click();
    await expect(page.locator('html')).toHaveAttribute('data-style', look);
    await expect(page.getByTestId(`look-${look}`)).toHaveAttribute('aria-checked', 'true');
    if (look !== 'aurora') {
      await page.getByTestId('save').click();
      await expect(page.getByTestId('savebar')).toBeHidden();
      // saving applies the theme setting ("same as system"): back to light for the pictures
      await setDark(false);
    }
    await expect(launcher.locator('html')).toHaveAttribute('data-style', look);
    // the window buttons take the title bar colours of the look
    await expect.poll(async () => JSON.stringify(savedChrome())).toBe(JSON.stringify(await pageChrome(page)));
    // the TrayCommand logo of the editor is the icon of the look
    await expect(page.locator('.brand img')).toHaveAttribute('src', `./icon-${look}.png`);
    await page.locator('.page').first().evaluate((e) => e.scrollTo(0, 0));
    await shot(page, look, '07-settings');

    await page.getByTestId('tab-trays').click();
    await page.getByTestId('tray-row').first().click();
    // saving reloads the configuration: wait for the toggles to show their state again
    await expect(page.getByTestId('tray-row').first()).toContainText('OFF', { timeout: 20000 });
    await shot(page, look, '01-trays');
    await page.getByTestId('tray-row').nth(1).click();
    await page.locator('.schedule').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await shot(page, look, '02-schedules');
    await page.getByTestId('schedule-alert-0').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await shot(page, look, '02b-schedule-alert');

    await hook('await tc.launcher.open()');
    await expect.poll(launcherVisible).toBe(true);
    await launcher.getByTestId('launcher-input').fill('se');
    // the launcher shortcut sits at the end of the search bar, the field takes the room before it
    const bar = await launcher.evaluate(() => {
      const box = (el: Element | null) => el?.getBoundingClientRect();
      const search = box(document.querySelector('.lx-search'))!;
      const keys = box(document.querySelector('.lx-search .keys'))!;
      const field = box(document.querySelector('.lx-line'))!;
      // nothing over the typed text may be a window drag area, or the mouse cannot select it
      const region = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || (getComputedStyle(el) as unknown as Record<string, string>).webkitAppRegion;
      const overText = [...document.querySelectorAll('.lx-line, .lx-line *')].map(region);
      return { gap: search.right - keys.right, fieldEnd: field.right, keysStart: keys.left, overText };
    });
    expect(bar.gap, 'shortcut at the end of the bar').toBeLessThan(40);
    expect(bar.keysStart - bar.fieldEnd, 'field up to the shortcut').toBeLessThan(30);
    expect(bar.overText.every((r) => r === 'no-drag'), `drag areas over the text: ${bar.overText}`).toBe(true);
    await panelFits(look);
    await shot(launcher, look, '03-launcher');
    await launcher.keyboard.press('Escape');
    await launcher.keyboard.press('Escape');
    await expect.poll(launcherVisible).toBe(false);

    await hook(`
      const e = tc.engine.get('server');
      tc.lastAlert = tc.engine.fireSchedule(e, { every: '1h', alert: { title: 'New scan', text: 'invoice-2026-11.pdf has arrived.\\nWhat should I do?', timeout: '2m', default: 'Archive', choices: [{ label: 'Archive', action: 'echo a' }, { label: 'Open', action: 'echo o' }, { label: 'Ignore', action: 'echo i' }] } }, { TC_FILE: 'invoice.pdf' });
    `);
    await expect.poll(launcherVisible).toBe(true);
    await expect(launcher.getByTestId('launcher-alert')).toHaveAttribute('data-armed', 'true');
    await panelFits(look);
    await shot(launcher, look, '04-alert');
    await launcher.getByTestId('launcher-alert-choice-2').click();
    await expect.poll(launcherVisible).toBe(false);

    await page.getByTestId('tab-settings').click();
    await page.getByTestId('export-open').click();
    await page.getByTestId('export-entry').filter({ hasText: 'Notes' }).locator('input').click();
    await shot(page, look, '05-export');
    await page.keyboard.press('Escape');
    await page.getByTestId('import-open').click();
    await expect(page.getByTestId('import-dialog')).toBeVisible();
    await shot(page, look, '06-import');
    await page.keyboard.press('Escape');

    // dark: the page and the window buttons switch together
    const light = await pageChrome(page);
    await setDark(true);
    await expect.poll(async () => (await pageChrome(page)).bg).not.toBe(light.bg);
    await expect.poll(async () => JSON.stringify(savedChrome())).toBe(JSON.stringify(await pageChrome(page)));
    await setDark(false);
    await expect.poll(async () => (await pageChrome(page)).bg).toBe(light.bg);
    await expect.poll(async () => JSON.stringify(savedChrome())).toBe(JSON.stringify(light));
    // light and dark flipped quickly several times (as when saving re-applies "same as system"): the buttons end with the page
    for (const d of [true, false, true, false, true, false]) await app.evaluate(({ nativeTheme }, dark) => (nativeTheme.themeSource = dark ? 'dark' : 'light'), d);
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(false);
    await expect.poll(async () => JSON.stringify(savedChrome())).toBe(JSON.stringify(light));
    await setDark(true);
    await expect.poll(async () => (await pageChrome(page)).bg).not.toBe(light.bg);
    await page.getByTestId('tab-trays').click();
    await page.getByTestId('tray-row').first().click();
    await shot(page, look, '08-dark');
    await page.getByTestId('tray-row').nth(1).click();
    await page.locator('.schedule').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await shot(page, look, '11-schedules-dark');
    await page.getByTestId('tab-settings').click();
    await page.locator('.page').first().evaluate((e) => e.scrollTo(0, 0));
    await shot(page, look, '10-settings-dark');
    await page.getByTestId('import-open').click();
    await expect(page.getByTestId('import-dialog')).toBeVisible();
    await shot(page, look, '13-import-dark');
    await page.keyboard.press('Escape');
    await hook('await tc.launcher.open()');
    await expect.poll(launcherVisible).toBe(true);
    await launcher.getByTestId('launcher-input').fill('se');
    await shot(launcher, look, '09-launcher-dark');
    await launcher.keyboard.press('Escape');
    await launcher.keyboard.press('Escape');
    await expect.poll(launcherVisible).toBe(false);
    await hook(`
      const e = tc.engine.get('server');
      tc.lastAlert = tc.engine.fireSchedule(e, { every: '1h', alert: { title: 'New scan', text: 'invoice-2026-11.pdf has arrived.\\nWhat should I do?', timeout: '2m', default: 'Archive', choices: [{ label: 'Archive', action: 'echo a' }, { label: 'Open', action: 'echo o' }, { label: 'Ignore', action: 'echo i' }] } }, { TC_FILE: 'invoice.pdf' });
    `);
    await expect.poll(launcherVisible).toBe(true);
    await expect(launcher.getByTestId('launcher-alert')).toHaveAttribute('data-armed', 'true');
    await shot(launcher, look, '12-alert-dark');
    await launcher.getByTestId('launcher-alert-choice-2').click();
    await expect.poll(launcherVisible).toBe(false);

    // unsaved changes: the shortcut inside the Save button is readable, dark and light
    await page.getByTestId('tab-settings').click();
    await page.locator('.page select').first().selectOption('light');
    await expect(page.getByTestId('savebar')).toBeVisible();
    const contrast: Record<string, number> = {};
    for (const dark of [true, false]) {
      await setDark(dark);
      await page.waitForTimeout(300);
      await page.getByTestId('savebar').screenshot({ path: path.join(shotsRoot, look, `14-savebar-${dark ? 'dark' : 'light'}.png`) });
      contrast[dark ? 'dark' : 'light'] = await saveShortcutContrast();
    }
    for (const [mode, ratio] of Object.entries(contrast)) expect(ratio, `Ctrl+S in the Save button, ${look} ${mode}`).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('savebar')).toBeHidden();

    // an update downloading: the status is written in the look's own face for states, not as a plain description
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update', { state: 'downloading', current: '2.6.2', latest: '2.6.3', progress: 1 });
    });
    const state = page.getByTestId('update-state');
    await expect(state).toHaveText('Downloading… 100%');
    await expect.soft(state).toHaveCSS('font-family', STATE_FACE[look]);
    await state.locator('xpath=ancestor::section[1]').screenshot({ path: path.join(shotsRoot, look, '15-update.png') });
  });
}

/** The face each look uses for live states (the update status). */
const STATE_FACE: Record<(typeof ALL_LOOKS)[number], RegExp> = {
  aurora: /Segoe UI Variable Text/,
  terminal: /Cascadia Mono/,
  brutal: /Bahnschrift/,
  neon: /Cascadia Mono/,
};

/**
 * Contrast (WCAG) of the "Ctrl+S" shortcut in the Save button, measured on the pixels as drawn: the lightest and the
 * darkest point of the keycap are its text and what is behind it (each look paints buttons its own way, with layers,
 * gradients or cut corners, so the CSS colours alone do not tell).
 */
async function saveShortcutContrast(): Promise<number> {
  // inside the keycap only: its border and rounded corners would let the button colour in
  const box = (await page.getByTestId('save').locator('.kbd').boundingBox())!;
  const inset = 3;
  const png = await page.screenshot({ clip: { x: box.x + inset, y: box.y + inset, width: box.width - inset * 2, height: box.height - inset * 2 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * channel(data[i]!) + 0.7152 * channel(data[i + 1]!) + 0.0722 * channel(data[i + 2]!);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    return (hi + 0.05) / (lo + 0.05);
  }, png.toString('base64'));
}

test('back to Aurora', async () => {
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('look-aurora').click();
  await page.getByTestId('save').click();
  await expect(launcher.locator('html')).toHaveAttribute('data-style', 'aurora');
  const cfg = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
  expect(cfg.settings.style).toBe('aurora');
});
