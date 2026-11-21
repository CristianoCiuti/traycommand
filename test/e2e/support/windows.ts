import type { ElectronApplication, Page } from '@playwright/test';

/** The editor window. The launcher window is created hidden at start-up, so it can be the first window. */
export async function editorWindow(app: ElectronApplication, timeout = 30000): Promise<Page> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) return page;
    if (Date.now() > deadline) throw new Error('The editor window did not open');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Closes the app: asks it to exit, and ends the process if it has not gone within a few seconds
 * (a reply that never comes would otherwise keep the test worker waiting until its teardown times out).
 */
export async function closeApp(app: ElectronApplication | undefined) {
  if (!app) return;
  const proc = app.process();
  await Promise.race([app.evaluate(({ app }) => app.exit(0)).catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
  if (proc.exitCode === null && !proc.killed) proc.kill();
}
