import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppStateStore } from '../../src/main/appState';

describe('AppStateStore', () => {
  it('reads files written with a UTF-8 BOM (e.g. by Windows PowerShell)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-state-')), 'state.json');
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ configPath: 'C:\\x\\tc.json' })}`);
    expect(new AppStateStore(file).get().configPath).toBe('C:\\x\\tc.json');
  });

  it('persists updates', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-state-')), 'state.json');
    new AppStateStore(file).update({ lastVersion: '2.0.0' });
    expect(new AppStateStore(file).get().lastVersion).toBe('2.0.0');
  });
});
