import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * TrayCommand skill for AI coding agents (Claude Code, OpenCode).
 *
 * The skill ships inside the app (resources/skill/traycommand). It is rendered with
 * the paths of this PC (executable, data folder, configuration file) and copied to
 * the user folder of every agent found on the machine. A marker file records what
 * was written, so that TrayCommand can tell "out of date" (the app has a newer
 * rendering) from "changed by the user" (files edited after installation).
 * Nothing outside <agent home>/skills/traycommand is ever touched.
 */

export const SKILL_NAME = 'traycommand';
export const MARKER = '.traycommand-skill.json';

export interface AgentSpec {
  id: 'claude' | 'opencode';
  label: string;
  /** User folder of the agent, relative to the home folder. */
  home: string[];
  /** Commands that reveal the agent when its folder does not exist yet. */
  commands: string[];
}

export const AGENTS: AgentSpec[] = [
  { id: 'claude', label: 'Claude Code', home: ['.claude'], commands: ['claude'] },
  { id: 'opencode', label: 'OpenCode', home: ['.config', 'opencode'], commands: ['opencode'] },
];

export interface SkillEnv {
  /** Home folder of the user (os.homedir(), or a temp folder in tests). */
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Folder with the skill sources (SKILL.md and friends). */
  source: string;
  /** Values for the {{PLACEHOLDERS}} in the sources. */
  values: Record<string, string>;
  version: string;
}

export interface Marker {
  version: string;
  /** Hash of the files as written by TrayCommand. */
  hash: string;
  installedAt: string;
}

export type SkillState = 'missing' | 'current' | 'outdated' | 'modified';

export interface AgentSkillStatus {
  id: AgentSpec['id'];
  label: string;
  /** The agent is on this PC (user folder or command on PATH). */
  present: boolean;
  state: SkillState;
  /** Version that wrote the installed skill (when TrayCommand installed it). */
  version?: string;
  dir: string;
}

export function agentHome(agent: AgentSpec, home: string): string {
  return path.join(home, ...agent.home);
}

export function skillDir(agent: AgentSpec, home: string): string {
  return path.join(agentHome(agent, home), 'skills', SKILL_NAME);
}

/** `cmd` is on PATH (with PATHEXT on Windows). */
export function onPath(cmd: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const extKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATHEXT');
  const win = platform === 'win32';
  const exts = win ? ['', ...((extKey && env[extKey]) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const raw of ((key && env[key]) || '').split(win ? ';' : ':')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (fs.statSync(path.join(dir, cmd + ext)).isFile()) return true;
      } catch {
        /* not here */
      }
    }
  }
  return false;
}

export function agentPresent(agent: AgentSpec, e: Pick<SkillEnv, 'home' | 'env' | 'platform'>): boolean {
  return fs.existsSync(agentHome(agent, e.home)) || agent.commands.some((c) => onPath(c, e.env, e.platform));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string[]) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(path.join(d, entry.name), [...rel, entry.name]);
      else if (entry.isFile() && entry.name !== MARKER) out.push([...rel, entry.name].join('/'));
    }
  };
  walk(dir, []);
  return out;
}

/** The skill files with the placeholders replaced: relative path (with "/") → content. */
export function renderSkill(source: string, values: Record<string, string>): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of filesUnder(source)) {
    let text = fs.readFileSync(path.join(source, ...rel.split('/')), 'utf8');
    for (const [k, v] of Object.entries(values)) text = text.split(`{{${k}}}`).join(v);
    files.set(rel, text);
  }
  if (!files.has('SKILL.md')) throw new Error(`Skill sources incomplete: no SKILL.md in ${source}`);
  return files;
}

export function hashFiles(files: Map<string, string>): string {
  const h = crypto.createHash('sha256');
  for (const rel of [...files.keys()].sort()) h.update(`${rel}\0${files.get(rel)!.replace(/\r\n/g, '\n')}\0`);
  return h.digest('hex');
}

function readInstalled(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of filesUnder(dir)) files.set(rel, fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));
  return files;
}

export function readMarker(dir: string): Marker | undefined {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')) as Marker;
    return typeof m.hash === 'string' ? m : undefined;
  } catch {
    return undefined;
  }
}

export function skillStatus(e: SkillEnv, rendered = renderSkill(e.source, e.values)): AgentSkillStatus[] {
  const wanted = hashFiles(rendered);
  return AGENTS.map((agent) => {
    const dir = skillDir(agent, e.home);
    const base = { id: agent.id, label: agent.label, present: agentPresent(agent, e), dir };
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return { ...base, state: 'missing' as const };
    const marker = readMarker(dir);
    const actual = hashFiles(readInstalled(dir));
    // no marker or files differing from what TrayCommand wrote: someone edited them
    if (!marker || marker.hash !== actual) return { ...base, state: actual === wanted ? ('current' as const) : ('modified' as const), version: marker?.version };
    return { ...base, state: actual === wanted ? ('current' as const) : ('outdated' as const), version: marker.version };
  });
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/**
 * Retries a file operation for a few seconds while the file is in use: the agents
 * (OpenCode, Claude Code) watch their skills folder and read new files as soon as they
 * appear, and antivirus software scans them.
 */
export function retryBusy<T>(fn: () => T, timeoutMs = 10000): T {
  const deadline = Date.now() + timeoutMs;
  for (let wait = 50; ; wait = Math.min(wait * 2, 500)) {
    try {
      return fn();
    } catch (error) {
      if (!BUSY.has((error as NodeJS.ErrnoException).code ?? '') || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/**
 * Writes the skill for one agent. Files are written in place (never a temporary folder
 * renamed into the watched skills folder: Windows refuses to rename a folder while a
 * watcher has a file of it open), files not in the skill anymore are removed, the
 * marker is written last.
 */
export function installSkill(e: SkillEnv, id: AgentSpec['id'], rendered = renderSkill(e.source, e.values)): string {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent ${id}`);
  const dir = skillDir(agent, e.home);
  // leftovers of the 2.1.0 installer
  const parent = path.dirname(dir);
  if (fs.existsSync(parent)) {
    for (const name of fs.readdirSync(parent)) {
      if (name.startsWith(`${SKILL_NAME}.tmp-`)) {
        try {
          fs.rmSync(path.join(parent, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          /* still in use: removed next time */
        }
      }
    }
  }
  retryBusy(() => fs.mkdirSync(dir, { recursive: true }));
  if (fs.existsSync(dir)) {
    for (const rel of filesUnder(dir)) if (!rendered.has(rel)) retryBusy(() => fs.rmSync(path.join(dir, ...rel.split('/')), { force: true }));
  }
  for (const [rel, text] of rendered) {
    const file = path.join(dir, ...rel.split('/'));
    retryBusy(() => fs.mkdirSync(path.dirname(file), { recursive: true }));
    retryBusy(() => fs.writeFileSync(file, text));
  }
  const marker: Marker = { version: e.version, hash: hashFiles(rendered), installedAt: new Date().toISOString() };
  retryBusy(() => fs.writeFileSync(path.join(dir, MARKER), `${JSON.stringify(marker, null, 2)}\n`));
  return dir;
}

export function uninstallSkill(e: Pick<SkillEnv, 'home'>, id: AgentSpec['id']): void {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent ${id}`);
  fs.rmSync(skillDir(agent, e.home), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

export interface SkillPlan {
  /** Out of date and safe to replace automatically. */
  autoUpdate: AgentSpec['id'][];
  /** Agents to propose to the user (install or update). */
  offer: AgentSpec['id'][];
}

/**
 * What to do at startup: with automatic updates, outdated skills are replaced
 * silently; skills changed by the user are never overwritten without asking;
 * missing skills are offered for agents on this PC unless the user declined.
 */
export function planSkills(status: AgentSkillStatus[], o: { auto: boolean; declined: string[] }): SkillPlan {
  const plan: SkillPlan = { autoUpdate: [], offer: [] };
  for (const s of status) {
    if (s.state === 'outdated' && o.auto) plan.autoUpdate.push(s.id);
    else if (s.state === 'outdated' || s.state === 'modified') {
      if (!o.declined.includes(s.id)) plan.offer.push(s.id);
    } else if (s.state === 'missing' && s.present && !o.declined.includes(s.id)) plan.offer.push(s.id);
  }
  return plan;
}
