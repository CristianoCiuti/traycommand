import fs from 'node:fs';
import path from 'node:path';
import type { SecretChange } from '../shared/api';

/** Encryption tied to this user on this PC (Electron safeStorage: DPAPI, Keychain, the Linux keyring). */
export interface Cipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

interface SecretFile {
  version: 1;
  /** Encrypted values, base64, by name. */
  values: Record<string, string>;
}

/**
 * Values of the secret variables. They never go in the configuration file: they are kept
 * encrypted in the data folder, so they cannot be read from another account or another PC.
 */
export class SecretStore {
  private values: Record<string, string> = {};

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as Partial<SecretFile>;
      if (raw && typeof raw.values === 'object' && raw.values) {
        this.values = Object.fromEntries(Object.entries(raw.values).filter(([, v]) => typeof v === 'string'));
      }
    } catch {
      /* no secrets yet, or an unreadable file: start empty */
    }
  }

  /** Values can be stored safely on this system. */
  get available(): boolean {
    try {
      return this.cipher.available();
    } catch {
      return false;
    }
  }

  /** Names with a value that can be read (encrypted here, by this user). */
  names(): string[] {
    return Object.keys(this.values).filter((name) => this.get(name) !== undefined);
  }

  get(name: string): string | undefined {
    const data = this.values[name];
    if (data === undefined) return undefined;
    try {
      return this.cipher.decrypt(Buffer.from(data, 'base64'));
    } catch {
      return undefined;
    }
  }

  /** The values of these names (the ones without a value are left out). */
  read(names: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of names) {
      const value = this.get(name);
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  /** Applies the changes in order and writes the file; nothing changes when one of them cannot be applied. */
  apply(changes: readonly SecretChange[]): { ok: true } | { ok: false; error: string } {
    if (!changes.length) return { ok: true };
    const next = { ...this.values };
    for (const c of changes) {
      if (c.op === 'set') {
        if (!this.available) return { ok: false, error: 'Secrets cannot be stored safely on this system (no encryption available for this user)' };
        next[c.name] = this.cipher.encrypt(c.value).toString('base64');
      } else if (c.op === 'delete') delete next[c.name];
      else if (next[c.from] !== undefined) {
        next[c.to] = next[c.from]!;
        delete next[c.from];
      }
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, values: next } satisfies SecretFile, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (error) {
      return { ok: false, error: `Cannot save the secrets: ${(error as Error).message}` };
    }
    this.values = next;
    return { ok: true };
  }
}
