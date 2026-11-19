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

describe.skipIf(process.platform !== 'win32')('zip extraction on Windows', () => {
  it('works even when another tar comes first on PATH (Git for Windows usr/bin)', async () => {
    const { extractZipWindows } = await import('../../src/main/unzip');
    const { runScript } = await import('../../src/main/runner');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-unzip-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'TrayCommand.exe'), 'new');
    const zip = path.join(root, 'update.zip');
    await runScript(`Compress-Archive -Path '${path.join(root, 'src', '*')}' -DestinationPath '${zip}'`, { shell: 'powershell' });
    // a fake "tar.exe" first on PATH that always fails, like GNU tar with C:\\ paths
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), path.join(bin, 'tar.exe'));
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin};${oldPath}`;
    try {
      const out = path.join(root, 'out');
      fs.mkdirSync(out);
      const r = await extractZipWindows(zip, out);
      expect(r.code).toBe(0);
      expect(fs.readFileSync(path.join(out, 'TrayCommand.exe'), 'utf8')).toBe('new');
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  }, 60000);
});

describe('detached update runner', () => {
  it('survives its parent, copies the new version from a folder in use, writes the result and relaunches', async () => {
    const { build } = await import('esbuild');
    const { spawn } = await import('node:child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-runner-'));
    const runner = path.join(root, 'update-runner.cjs');
    await build({ entryPoints: [path.resolve(__dirname, '../../src/main/updateRunner.ts')], outfile: runner, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const target = path.join(root, 'Tray Command');
    const source = path.join(root, 'update', 'extracted');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'v.txt'), 'old');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'v.txt'), 'new');
    const relaunched = path.join(root, 'relaunched.txt');
    const job = {
      pid: 999999,
      target,
      source,
      kind: 'dir',
      copy: true,
      relaunch: { command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(relaunched)}, 'yes')`], cwd: root },
      resultFile: path.join(root, 'result.json'),
      version: '9.9.9',
    };
    const jobFile = path.join(root, 'job.json');
    fs.writeFileSync(jobFile, JSON.stringify(job));
    // like the app: detached, hidden, run from the folder of the new version
    const child = spawn(process.execPath, [runner, jobFile], { cwd: source, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, TRAYCOMMAND_UPDATE_RUNNER: '1' } });
    child.unref();
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(relaunched) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const result = JSON.parse(fs.readFileSync(job.resultFile, 'utf8'));
    expect(result).toMatchObject({ ok: true, version: '9.9.9' });
    expect(fs.readFileSync(path.join(target, 'v.txt'), 'utf8')).toBe('new');
    expect(fs.existsSync(`${target}.old`)).toBe(false);
    expect(fs.readFileSync(relaunched, 'utf8')).toBe('yes');
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* still in use by the exiting runner */
    }
  }, 30000);
});
