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
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Windows runner as a PowerShell script: no Electron runtime involved, so nothing
 * inside the install folder stays locked while it is being replaced.
 */
export function windowsRunnerScript(job: RunnerJob): string {
  const args = job.relaunch.args.length ? ` -ArgumentList ${job.relaunch.args.map((a) => psq(a.includes(' ') ? `"${a}"` : a)).join(',')}` : '';
  return `$ErrorActionPreference = 'Stop'
$target = ${psq(job.target)}
$source = ${psq(job.source)}
$backup = "$target.old"
function Retry([scriptblock]$Action) {
  $deadline = (Get-Date).AddSeconds(20)
  while ($true) {
    try { & $Action; return } catch { if ((Get-Date) -gt $deadline) { throw } ; Start-Sleep -Milliseconds 250 }
  }
}
$result = @{ ok = $true; version = ${psq(job.version)}; time = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
try {
  $p = Get-Process -Id ${job.pid} -ErrorAction SilentlyContinue
  if ($p) { $null = $p.WaitForExit(60000) }
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath $backup) { Retry { Remove-Item -LiteralPath $backup -Recurse -Force } }
  $had = Test-Path -LiteralPath $target
  if ($had) { Retry { Move-Item -LiteralPath $target -Destination $backup } }
  try {
    Retry { Move-Item -LiteralPath $source -Destination $target }
  } catch {
    if ($had) { Retry { Move-Item -LiteralPath $backup -Destination $target } }
    throw
  }
  try { Remove-Item -LiteralPath $backup -Recurse -Force } catch {}
} catch {
  $result.ok = $false
  $result.message = $_.Exception.Message
}
$result | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath ${psq(job.resultFile)}
Start-Process -FilePath ${psq(job.relaunch.command)} -WorkingDirectory ${psq(job.relaunch.cwd)}${args}
`;
}
