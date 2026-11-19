import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetName, compareVersions, parseChecksums } from '../../src/main/update';
import { applyUpdate } from '../../src/main/updateRunner';

describe('versions', () => {
  it('compares semver with prereleases', () => {
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
  });
  it('names assets per platform', () => {
    expect(assetName('2.0.0', 'win32', 'x64')).toBe('TrayCommand-2.0.0-win-x64.zip');
    expect(assetName('2.0.0', 'linux', 'x64')).toBe('TrayCommand-2.0.0-linux-x86_64.AppImage');
    expect(assetName('2.0.0', 'darwin', 'arm64')).toBe('TrayCommand-2.0.0-mac-universal.zip');
  });
  it('parses SHA256SUMS', () => {
    const h = 'a'.repeat(64);
    expect(parseChecksums(`${h}  TrayCommand-2.0.0-win-x64.zip\n`).get('TrayCommand-2.0.0-win-x64.zip')).toBe(h);
  });
});

describe('applyUpdate', () => {
  it('swaps the installation folder and removes the backup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-update-'));
    const target = path.join(root, 'TrayCommand');
    const source = path.join(root, 'new');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'version.txt'), 'old');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'version.txt'), 'new');
    const result = await applyUpdate({
      pid: 999999,
      target,
      source,
      kind: 'dir',
      relaunch: { command: 'x', args: [], cwd: root },
      resultFile: path.join(root, 'r.json'),
      version: '2.0.1',
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(target, 'version.txt'), 'utf8')).toBe('new');
    expect(fs.existsSync(`${target}.old`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rolls back when the new version cannot be moved in', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-update-'));
    const target = path.join(root, 'TrayCommand');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'version.txt'), 'old');
    const result = await applyUpdate({
      pid: 999999,
      target,
      source: path.join(root, 'missing'),
      kind: 'dir',
      relaunch: { command: 'x', args: [], cwd: root },
      resultFile: path.join(root, 'r.json'),
      version: '2.0.1',
    });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(target, 'version.txt'), 'utf8')).toBe('old');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe.skipIf(process.platform !== 'win32')('windows runner script', () => {
  it('swaps folders with PowerShell and writes the result', async () => {
    const { windowsRunnerScript } = await import('../../src/main/update');
    const { runScript } = await import('../../src/main/runner');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-psrun-'));
    const target = path.join(root, 'Tray Command');
    const source = path.join(root, 'new');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'v.txt'), 'old');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'v.txt'), 'new');
    const script = path.join(root, 'run.ps1');
    fs.writeFileSync(
      script,
      `﻿${windowsRunnerScript({ pid: 999999, target, source, kind: 'dir', relaunch: { command: 'cmd.exe', args: ['/c', 'exit'], cwd: root }, resultFile: path.join(root, 'result.json'), version: '9.9.9' })}`,
    );
    const r = await runScript(`& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${script}'`, { shell: 'powershell' });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(target, 'v.txt'), 'utf8')).toBe('new');
    const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8').replace(/^﻿/, ''));
    expect(result.ok).toBe(true);
    expect(result.version).toBe('9.9.9');
    await new Promise((r) => setTimeout(r, 1000));
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* the relaunched process may still hold the temp folder */
    }
  });
});
