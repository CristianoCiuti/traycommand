import fs from 'node:fs';
import path from 'node:path';

export type FileEvent = 'add' | 'change' | 'remove';

export interface FileChange {
  /** Absolute path. */
  file: string;
  event: FileEvent;
}

export interface FolderWatchOptions {
  dir: string;
  /** Path relative to `dir` (with "/") → watched? */
  match: (relative: string) => boolean;
  subfolders: boolean;
  events: Set<FileEvent>;
  /** Quiet time after the last event before reporting (ms). */
  settleMs: number;
  /** Called with the changes of a burst, oldest first. */
  onChanges: (changes: FileChange[]) => void;
  /** Called when the watch starts working (undefined) or fails (message). */
  onState: (error?: string) => void;
  /** Retry delay when the folder is missing or the watch fails (ms). */
  retryMs?: number;
}

interface Signature {
  size: number;
  mtime: number;
}

/**
 * Watches a folder for files that appear, change or disappear. Events are collected until the folder
 * has been quiet for `settleMs`, then compared with the last known listing, so that the many raw
 * events of a single copy become one "add", and a save that changes nothing is ignored.
 */
export class FolderWatch {
  private watcher?: fs.FSWatcher;
  private known = new Map<string, Signature>();
  private pending = new Set<string>();
  private fullScan = false;
  private settleTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private closed = false;
  error?: string;

  constructor(private readonly o: FolderWatchOptions) {}

  /** Starts watching; with `existing` the matching files already there are reported as added. */
  start(existing = false) {
    if (this.closed) return;
    try {
      const stat = fs.statSync(this.o.dir);
      if (!stat.isDirectory()) throw Object.assign(new Error('not a folder'), { code: 'ENOTDIR' });
      this.known = this.scan();
      this.watcher = fs.watch(this.o.dir, { recursive: this.o.subfolders, persistent: false }, (_type, name) => this.onRaw(name));
      this.watcher.on('error', (error) => this.fail(error));
      this.error = undefined;
      this.o.onState(undefined);
      if (existing) this.reportExisting();
    } catch (error) {
      this.fail(error);
    }
  }

  close() {
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.settleTimer);
    clearTimeout(this.retryTimer);
  }

  /** Reports the matching files present now as added (when a time window opens). */
  reportExisting() {
    const files = [...this.known.keys()].sort();
    const changes = files.map((rel) => ({ file: this.abs(rel), event: 'add' as const }));
    if (changes.length && this.o.events.has('add')) this.o.onChanges(changes);
  }

  private fail(error: unknown) {
    this.watcher?.close();
    this.watcher = undefined;
    const code = (error as NodeJS.ErrnoException)?.code;
    this.error =
      code === 'ENOENT' ? 'Folder not found' : code === 'ENOTDIR' ? 'Not a folder' : code === 'EACCES' || code === 'EPERM' ? 'Access denied' : ((error as Error)?.message ?? String(error));
    this.o.onState(this.error);
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    // the folder may appear later (a drive that is connected, a folder created by another program)
    this.retryTimer = setTimeout(() => this.start(false), this.o.retryMs ?? 5000);
  }

  private abs(rel: string) {
    return path.join(this.o.dir, ...rel.split('/'));
  }

  private onRaw(name: string | Buffer | null) {
    if (this.closed) return;
    if (name === null || name === undefined) this.fullScan = true;
    else {
      const rel = String(name).replace(/\\/g, '/');
      if (!this.o.subfolders && rel.includes('/')) return;
      this.pending.add(rel);
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.flush(), this.o.settleMs);
  }

  /** Files of the folder that match, relative with "/". */
  private scan(sub = ''): Map<string, Signature> {
    const out = new Map<string, Signature>();
    const walk = (rel: string) => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(rel ? this.abs(rel) : this.o.dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        const r = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
          if (this.o.subfolders) walk(r);
        } else if (this.o.match(r)) {
          const sig = this.signature(r);
          if (sig) out.set(r, sig);
        }
      }
    };
    walk(sub);
    return out;
  }

  private signature(rel: string): Signature | undefined {
    try {
      const st = fs.statSync(this.abs(rel));
      return st.isFile() ? { size: st.size, mtime: st.mtimeMs } : undefined;
    } catch {
      return undefined;
    }
  }

  private flush() {
    if (this.closed) return;
    const changes: FileChange[] = [];
    const seen = new Set<string>();
    const consider = (rel: string, now: Signature | undefined) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const before = this.known.get(rel);
      if (now && !before) {
        this.known.set(rel, now);
        changes.push({ file: this.abs(rel), event: 'add' });
      } else if (now && before) {
        if (now.size !== before.size || now.mtime !== before.mtime) {
          this.known.set(rel, now);
          changes.push({ file: this.abs(rel), event: 'change' });
        }
      } else if (!now && before) {
        this.known.delete(rel);
        changes.push({ file: this.abs(rel), event: 'remove' });
      }
    };

    if (this.fullScan) {
      const current = this.scan();
      for (const [rel, sig] of current) consider(rel, sig);
      for (const rel of [...this.known.keys()]) if (!current.has(rel)) consider(rel, undefined);
    }
    for (const rel of this.pending) {
      let isDir = false;
      try {
        isDir = fs.statSync(this.abs(rel)).isDirectory();
      } catch {
        /* gone */
      }
      if (isDir) {
        // a folder copied or moved in: its files; or a folder removed/renamed: its known files
        if (this.o.subfolders) for (const [r, sig] of this.scan(rel)) consider(r, sig);
        continue;
      }
      const prefix = `${rel}/`;
      const inside = [...this.known.keys()].filter((r) => r.startsWith(prefix));
      if (inside.length) for (const r of inside) consider(r, this.signature(r));
      if (this.o.match(rel)) consider(rel, this.signature(rel));
    }
    this.pending.clear();
    this.fullScan = false;
    const wanted = changes.filter((c) => this.o.events.has(c.event));
    if (wanted.length) this.o.onChanges(wanted);
  }
}
