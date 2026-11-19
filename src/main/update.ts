import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { REPO } from './paths';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  version: string;
  notes: string;
  page: string;
  assets: ReleaseAsset[];
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2) as [string, string | undefined];
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function assetName(version: string, platform = process.platform, arch = process.arch): string {
  switch (platform) {
    case 'win32':
      return `TrayCommand-${version}-win-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`;
    case 'darwin':
      return `TrayCommand-${version}-mac-universal.zip`;
    default:
      return `TrayCommand-${version}-linux-${arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage`;
  }
}

export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<Release> {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TrayCommand-updater' },
  });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const json = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets: { name: string; browser_download_url: string; size: number }[] };
  return {
    version: json.tag_name.replace(/^v/, ''),
    notes: json.body ?? '',
    page: json.html_url,
    assets: json.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

export async function download(url: string, file: string, onProgress?: (ratio: number) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'TrayCommand-updater' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let done = 0;
  const body = Readable.fromWeb(res.body as unknown as WebReadableStream);
  body.on('data', (chunk: Buffer) => {
    done += chunk.length;
    if (total && onProgress) onProgress(done / total);
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(body, fs.createWriteStream(file));
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** Parses a SHA256SUMS file ("<hash>  <name>" per line). */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) map.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return map;
}

export interface RunnerJob {
  pid: number;
  /** Folder (Windows/macOS .app) or file (AppImage) to replace. */
  target: string;
  /** New content: extracted folder or downloaded file. */
  source: string;
  kind: 'dir' | 'file';
  relaunch: { command: string; args: string[]; cwd: string };
  resultFile: string;
  version: string;
  /** Copy the source instead of moving it (Windows: the runner runs from the source folder, which stays locked). */
  copy?: boolean;
}
