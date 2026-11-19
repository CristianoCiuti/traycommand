import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionLog } from '../shared/api';

const MEMORY = 300;
const MAX_FILE = 2 * 1024 * 1024;

/** Execution history: last entries in memory + a rotating JSON-lines file. */
export class LogStore {
  private items: ExecutionLog[] = [];
  private listeners = new Set<(log: ExecutionLog) => void>();
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'executions.jsonl');
    try {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-MEMORY);
      this.items = lines.filter(Boolean).map((l) => JSON.parse(l) as ExecutionLog);
    } catch {
      this.items = [];
    }
  }

  add(log: ExecutionLog) {
    const trimmed = { ...log, stdout: log.stdout.slice(0, 8000), stderr: log.stderr.slice(0, 8000) };
    this.items.push(trimmed);
    if (this.items.length > MEMORY) this.items.splice(0, this.items.length - MEMORY);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > MAX_FILE) fs.renameSync(this.file, `${this.file}.1`);
      fs.appendFileSync(this.file, `${JSON.stringify(trimmed)}\n`);
    } catch {
      /* logging must never break execution */
    }
    for (const l of this.listeners) l(trimmed);
  }

  list(): ExecutionLog[] {
    return [...this.items].reverse();
  }

  onLog(listener: (log: ExecutionLog) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get folder() {
    return this.dir;
  }
}
