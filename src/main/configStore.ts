import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION, type Config, type ConfigIssue, SCHEMA_URL, parseConfig } from '../shared/config';
import type { LoadedConfig } from '../shared/api';

const MAX_BACKUPS = 30;

export const STARTER_CONFIG = {
  $schema: SCHEMA_URL,
  version: CONFIG_VERSION,
  settings: {},
  variables: {},
  trays: [
    {
      id: 'hello',
      label: 'Hello TrayCommand',
      action: { run: process.platform === 'win32' ? 'Start-Process notepad' : 'echo hello', notify: 'Hello from TrayCommand! Open the editor from the TrayCommand icon to add your own trays.' },
    },
  ],
};

/** Serializes a config with a stable key order ($schema, version, settings, variables, trays). */
export function serializeConfig(config: Config): string {
  const { $schema, version, settings, variables, trays, ...rest } = config;
  return `${JSON.stringify({ $schema: $schema ?? SCHEMA_URL, version, settings, variables, trays, ...rest }, null, 2)}\n`;
}

export class ConfigStore {
  private lastRaw?: string;
  private watching = false;
  private debounce?: NodeJS.Timeout;
  private current: LoadedConfig | undefined;

  constructor(
    private filePath: string,
    private readonly backupDir: string,
    private readonly onExternalChange: (loaded: LoadedConfig) => void,
  ) {}

  get path() {
    return this.filePath;
  }

  get dir() {
    return path.dirname(this.filePath);
  }

  get loaded(): LoadedConfig | undefined {
    return this.current;
  }

  /** Reads and validates the file, creating a starter config when it does not exist. */
  load(): LoadedConfig {
    if (!fs.existsSync(this.filePath)) {
      fs.mkdirSync(this.dir, { recursive: true });
      this.writeRaw(`${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);
    }
    const raw = fs.readFileSync(this.filePath, 'utf8').replace(/^﻿/, '');
    this.lastRaw = raw;
    this.current = ConfigStore.parseRaw(raw);
    return this.current;
  }

  static parseRaw(raw: string): LoadedConfig {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      return { ok: false, raw, issues: [{ path: '', message: `Invalid JSON: ${(error as Error).message}` }] };
    }
    const result = parseConfig(json);
    return result.ok ? { ok: true, raw, config: result.config, warnings: result.warnings } : { ok: false, raw, issues: result.issues };
  }

  save(config: Config): { ok: boolean; issues?: ConfigIssue[] } {
    const raw = serializeConfig(config);
    return this.saveRaw(raw);
  }

  saveRaw(raw: string): { ok: boolean; issues?: ConfigIssue[] } {
    const parsed = ConfigStore.parseRaw(raw);
    if (!parsed.ok) return { ok: false, issues: parsed.issues };
    this.backup();
    this.writeRaw(raw);
    this.current = parsed;
    return { ok: true };
  }

  private writeRaw(raw: string) {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, this.filePath);
    this.lastRaw = raw;
  }

  /** Copies the current file into the backup folder, keeping the newest MAX_BACKUPS. */
  backup() {
    if (!fs.existsSync(this.filePath)) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.filePath, path.join(this.backupDir, `traycommand-${stamp}.json`));
    const files = this.backups();
    for (const old of files.slice(MAX_BACKUPS)) fs.rmSync(path.join(this.backupDir, old.name), { force: true });
  }

  backups(): { name: string; time: number }[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.json'))
      .map((name) => ({ name, time: fs.statSync(path.join(this.backupDir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
  }

  restore(name: string) {
    const file = path.join(this.backupDir, path.basename(name));
    return this.saveRaw(fs.readFileSync(file, 'utf8'));
  }

  /** Polls the file (works on network drives and OneDrive, where fs.watch is unreliable). */
  watch() {
    if (this.watching) return;
    this.watching = true;
    fs.watchFile(this.filePath, { interval: 1000 }, () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        let raw: string;
        try {
          raw = fs.readFileSync(this.filePath, 'utf8').replace(/^﻿/, '');
        } catch {
          return;
        }
        if (raw === this.lastRaw) return;
        this.lastRaw = raw;
        this.current = ConfigStore.parseRaw(raw);
        this.onExternalChange(this.current);
      }, 300);
    });
  }

  unwatch() {
    if (!this.watching) return;
    fs.unwatchFile(this.filePath);
    this.watching = false;
  }

  /** Points the store to another file (keeps watching if it was). */
  setPath(filePath: string) {
    const wasWatching = this.watching;
    this.unwatch();
    this.filePath = filePath;
    this.load();
    if (wasWatching) this.watch();
  }
}
