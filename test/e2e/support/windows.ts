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
