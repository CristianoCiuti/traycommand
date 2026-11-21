import fs from 'node:fs';
import path from 'node:path';

/**
 * Machine-local state, kept apart from the (shareable) configuration file:
 * where the config lives, window bounds, and the opt-in elevated mode, which must
 * never be enabled by editing the config by hand.
 */
export interface AppState {
  configPath?: string;
  window?: { x?: number; y?: number; width: number; height: number; maximized?: boolean };
  startElevated?: boolean;
  lastVersion?: string;
  updateResult?: { ok: boolean; version: string; message?: string; time: number };
  /** AI agent skill: agents the user does not want it for, last version that sent a notification. */
  skills?: { declined?: string[]; notifiedVersion?: string };
  /** Scheduled runs paused from the tray menu. */
  schedulesPaused?: boolean;
  /** Title bar colours last shown by the editor (so that it opens with them). */
  chrome?: { bg: string; fg: string };
}

export class AppStateStore {
  private value: AppState = {};
  constructor(private readonly file: string) {
    try {
      this.value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as AppState;
    } catch {
      this.value = {};
    }
  }

  get(): AppState {
    return this.value;
  }

  update(patch: Partial<AppState>) {
    this.value = { ...this.value, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
