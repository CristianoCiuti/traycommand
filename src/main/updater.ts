import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateInfo } from '../shared/api';
import { runScript } from './runner';
import { assetName, compareVersions, download, fetchLatestRelease, parseChecksums, sha256, type RunnerJob } from './update';
import { currentInstallRoot, installedExecutable } from './paths';
import { extractZipWindows } from './unzip';

/** Checks GitHub releases, downloads and verifies the new version, then hands over to the update runner. */
export class Updater {
  private info: UpdateInfo;
  private listeners = new Set<(info: UpdateInfo) => void>();
  private timer?: NodeJS.Timeout;
  private assetUrl?: string;
  private sumsUrl?: string;

  constructor(
    private readonly dataDir: string,
    private readonly relaunchArgs: () => string[],
  ) {
    this.info = { state: 'idle', current: app.getVersion() };
  }

  get state() {
    return this.info;
  }

  onChange(listener: (info: UpdateInfo) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<UpdateInfo>) {
    this.info = { ...this.info, ...patch };
    for (const l of this.listeners) l(this.info);
  }

  schedule(enabled: boolean) {
    clearInterval(this.timer);
    if (!enabled || !app.isPackaged) return;
    setTimeout(() => void this.check(), 15_000);
    this.timer = setInterval(() => void this.check(), 6 * 3600_000);
  }

  async check(): Promise<UpdateInfo> {
    if (this.info.state === 'downloading') return this.info;
    this.set({ state: 'checking', error: undefined });
    try {
      const release = await fetchLatestRelease();
      const name = assetName(release.version);
      const asset = release.assets.find((a) => a.name === name);
      const sums = release.assets.find((a) => a.name === 'SHA256SUMS');
      if (compareVersions(release.version, this.info.current) > 0 && asset) {
        this.assetUrl = asset.url;
        this.sumsUrl = sums?.url;
        this.set({ state: 'available', latest: release.version, notes: release.notes, url: release.page });
      } else {
        this.set({ state: 'none', latest: release.version, url: release.page });
      }
    } catch (error) {
      this.set({ state: 'error', error: (error as Error).message });
    }
    return this.info;
  }

  /** Downloads, verifies and starts the detached runner, then quits the app. */
  async install(quit: () => void): Promise<void> {
    if (this.info.state !== 'available' || !this.assetUrl || !this.info.latest) return;
    const version = this.info.latest;
    const dir = path.join(this.dataDir, 'update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.set({ state: 'downloading', progress: 0 });
      const name = assetName(version);
      const file = path.join(dir, name);
      await download(this.assetUrl, file, (p) => this.set({ progress: p }));
      if (!this.sumsUrl) throw new Error('Release has no SHA256SUMS: refusing to install an unverified file');
      const sumsFile = path.join(dir, 'SHA256SUMS');
      await download(this.sumsUrl, sumsFile);
      const expected = parseChecksums(fs.readFileSync(sumsFile, 'utf8')).get(name);
      const actual = await sha256(file);
      if (!expected || expected !== actual) throw new Error('Checksum mismatch: the download is corrupted or tampered with');

      const target = currentInstallRoot();
      let source = file;
      let kind: RunnerJob['kind'] = 'file';
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const extract = path.join(dir, 'extracted');
        fs.mkdirSync(extract);
        const r = process.platform === 'win32' ? await extractZipWindows(file, extract) : await runScript(`ditto -x -k '${file}' '${extract}'`, { shell: 'sh' });
        if (r.code !== 0) throw new Error(`Cannot extract the update: ${r.stderr || r.error}`);
        const entries = fs.readdirSync(extract);
        source = process.platform === 'darwin' ? path.join(extract, entries.find((e) => e.endsWith('.app')) ?? '') : entries.length === 1 && fs.statSync(path.join(extract, entries[0]!)).isDirectory() ? path.join(extract, entries[0]!) : extract;
        kind = 'dir';
      } else if (process.env.APPIMAGE) {
        source = file;
      }
      const targetPath = process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : target;
      const job: RunnerJob = {
        pid: process.pid,
        target: targetPath,
        source,
        kind,
        relaunch: {
          command: process.platform === 'linux' && process.env.APPIMAGE ? targetPath : installedExecutable(target),
          args: this.relaunchArgs(),
          cwd: os.homedir(),
        },
        resultFile: path.join(this.dataDir, 'update-result.json'),
        version,
      };
      // Windows: the new TrayCommand.exe runs the runner, so the folder being replaced is not in use
      if (process.platform === 'win32') job.copy = true;
      const jobFile = path.join(dir, 'job.json');
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
      const runner = path.join(dir, 'update-runner.cjs');
      fs.copyFileSync(path.join(__dirname, 'update-runner.cjs'), runner);
      const runtime = process.platform === 'win32' ? installedExecutable(source) : process.execPath;
      if (!fs.existsSync(runtime)) throw new Error(`The update does not contain ${path.basename(runtime)}`);
      const child = spawn(runtime, [runner, jobFile], {
        cwd: dir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TRAYCOMMAND_UPDATE_RUNNER: '1' },
      });
      // make sure it really started before quitting
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', reject);
      });
      child.unref();
      this.set({ state: 'ready' });
      quit();
    } catch (error) {
      this.set({ state: 'error', error: (error as Error).message });
    }
  }
}
