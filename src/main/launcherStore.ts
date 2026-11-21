import fs from 'node:fs';
import path from 'node:path';
import type { InputMemory } from './engine';

interface Data {
  /** Launcher usage per entry (id, or key when the entry has no id). */
  usage: Record<string, { count: number; last: number }>;
  /** Last values typed for the inputs, per "entry:kind". Passwords are never stored. */
  inputs: Record<string, Record<string, string>>;
}

const DAY = 24 * 3600 * 1000;

/** Small machine-local store (data folder, never in the shareable configuration). */
export class LauncherStore implements InputMemory {
  private data: Data = { usage: {}, inputs: {} };
  private timer?: NodeJS.Timeout;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as Partial<Data>;
      this.data = { usage: raw.usage ?? {}, inputs: raw.inputs ?? {} };
    } catch {
      /* first run or unreadable: start empty */
    }
  }

  get(key: string) {
    return this.data.inputs[key];
  }

  set(key: string, values: Record<string, string>) {
    this.data.inputs[key] = values;
    this.persist();
  }

  bump(key: string) {
    const u = this.data.usage[key] ?? { count: 0, last: 0 };
    this.data.usage[key] = { count: u.count + 1, last: Date.now() };
    this.persist();
  }

  /** Frecency: frequent and recent uses rank higher; undefined when never used (or long ago). */
  rank(key: string, now = Date.now()): number | undefined {
    const u = this.data.usage[key];
    if (!u) return undefined;
    const age = now - u.last;
    if (age > 60 * DAY) return undefined;
    const recency = age < 3600 * 1000 ? 4 : age < DAY ? 3 : age < 7 * DAY ? 2 : 1;
    return recency * 10 + Math.min(u.count, 50) / 5 + u.last / 1e15;
  }

  private persist() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {
      /* not essential */
    }
  }
}
