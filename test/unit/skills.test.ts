import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENTS, MARKER, installSkill, onPath, planSkills, renderSkill, skillDir, skillStatus, uninstallSkill, type SkillEnv } from '../../src/main/skills';

const source = path.resolve(__dirname, '..', '..', 'skill', 'traycommand');
let home: string;

function env(o: Partial<SkillEnv> = {}): SkillEnv {
  return {
    home,
    env: { PATH: '' },
    platform: process.platform,
    source,
    version: '9.9.9',
    values: { TRAYCOMMAND_VERSION: '9.9.9', TRAYCOMMAND_SH: '"/opt/tc"', TRAYCOMMAND_PS: "& '/opt/tc'", TRAYCOMMAND_DATA: '/data/tc' },
    ...o,
  };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-skills-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('skill sources', () => {
  it('render with every placeholder replaced and a valid frontmatter', () => {
    const files = renderSkill(source, env().values);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['SKILL.md', 'reference.md', 'examples.md', 'scripts/make-icon.ps1']));
    for (const [rel, text] of files) expect(text, rel).not.toMatch(/\{\{[A-Z_]+\}\}/);
    const skill = files.get('SKILL.md')!;
    expect(skill).toMatch(/^---\nname: traycommand\ndescription: .{50,1024}\n---\n/);
    expect(skill).toContain('"/opt/tc" --validate');
    expect(skill).toContain("& '/opt/tc' --info | Out-String");
  });

  it('reference documents every settings key of the schema', async () => {
    const { SettingsSchema } = await import('../../src/shared/config');
    const reference = fs.readFileSync(path.join(source, 'reference.md'), 'utf8');
    for (const key of Object.keys(SettingsSchema.shape)) expect(reference, key).toContain(`\`${key}\``);
  });
});

describe('agent detection', () => {
  it('finds an agent from its user folder or its command on PATH', () => {
    expect(skillStatus(env()).map((s) => s.present)).toEqual([false, false]);
    fs.mkdirSync(path.join(home, '.claude'));
    expect(skillStatus(env()).find((s) => s.id === 'claude')!.present).toBe(true);
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'opencode.cmd' : 'opencode'), '');
    const e = { PATH: bin, PATHEXT: '.EXE;.CMD' };
    expect(onPath('opencode', e, process.platform)).toBe(true);
    expect(skillStatus(env({ env: e })).find((s) => s.id === 'opencode')!.present).toBe(true);
  });
});

describe('install, status and plan', () => {
  it('installs into the agent user folders and reports current', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    const dir = installSkill(env(), 'claude');
    expect(dir).toBe(path.join(home, '.claude', 'skills', 'traycommand'));
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, MARKER))).toBe(true);
    expect(skillDir(AGENTS[1]!, home)).toBe(path.join(home, '.config', 'opencode', 'skills', 'traycommand'));
    const claude = skillStatus(env()).find((s) => s.id === 'claude')!;
    expect(claude).toMatchObject({ state: 'current', version: '9.9.9' });
  });

  it('a newer rendering is outdated; edited files are modified', () => {
    installSkill(env(), 'claude');
    const newer = env({ version: '10.0.0', values: { ...env().values, TRAYCOMMAND_VERSION: '10.0.0' } });
    expect(skillStatus(newer).find((s) => s.id === 'claude')!.state).toBe('outdated');
    fs.appendFileSync(path.join(home, '.claude', 'skills', 'traycommand', 'SKILL.md'), '\nmy notes\n');
    expect(skillStatus(newer).find((s) => s.id === 'claude')!.state).toBe('modified');
    installSkill(newer, 'claude');
    expect(skillStatus(newer).find((s) => s.id === 'claude')!.state).toBe('current');
  });

  it('reinstalling replaces the whole folder and uninstall removes only it', () => {
    installSkill(env(), 'opencode');
    const dir = path.join(home, '.config', 'opencode', 'skills', 'traycommand');
    fs.writeFileSync(path.join(dir, 'stale.md'), 'x');
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), '{}');
    installSkill(env(), 'opencode');
    expect(fs.existsSync(path.join(dir, 'stale.md'))).toBe(false);
    uninstallSkill({ home }, 'opencode');
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'))).toBe(true);
  });

  it('plans silent updates, offers and respects declined agents', () => {
    const base = { label: '', dir: '', present: true };
    const status = [
      { ...base, id: 'claude' as const, state: 'outdated' as const },
      { ...base, id: 'opencode' as const, state: 'missing' as const },
    ];
    expect(planSkills(status, { auto: true, declined: [] })).toEqual({ autoUpdate: ['claude'], offer: ['opencode'] });
    expect(planSkills(status, { auto: false, declined: [] })).toEqual({ autoUpdate: [], offer: ['claude', 'opencode'] });
    expect(planSkills(status, { auto: false, declined: ['opencode'] })).toEqual({ autoUpdate: [], offer: ['claude'] });
    // modified skills are never replaced silently
    expect(planSkills([{ ...base, id: 'claude', state: 'modified' }], { auto: true, declined: [] })).toEqual({ autoUpdate: [], offer: ['claude'] });
    // agents not on this PC are not offered
    expect(planSkills([{ ...base, id: 'claude', state: 'missing', present: false }], { auto: true, declined: [] }).offer).toEqual([]);
  });
});
