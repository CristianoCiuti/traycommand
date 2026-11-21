import { useEffect, useState } from 'preact/hooks';
import { ExternalLink, FolderOpen, History, RefreshCw, ShieldAlert, ShieldCheck, Download, FileCog, Sparkles, Search, CalendarClock } from 'lucide-preact';
import { HotkeyInput } from '../components/HotkeyInput';
import { Keys } from '../components/keys';
import { hotkeyStatus, schedulesPaused } from '../store';
import type { AgentSkillInfo } from '../../shared/api';
import type { Settings } from '../../shared/config';
import { api, draft, info, mutate, reload, showToast, skills, update } from '../store';
import { Card, Dialog, Switch } from '../components/ui';
import { ShellSelect } from './ActionEditor';

function Setting(props: { title: string; desc?: string; children: preact.ComponentChildren; testId?: string }) {
  return (
    <div class="setting" data-testid={props.testId}>
      <div>
        <div class="t">{props.title}</div>
        {props.desc && <div class="d">{props.desc}</div>}
      </div>
      <div>{props.children}</div>
    </div>
  );
}

function skillText(a: AgentSkillInfo): string {
  if (a.state === 'current') return `Skill installed${a.version ? ` (TrayCommand ${a.version})` : ''}`;
  if (a.state === 'outdated') return 'Skill installed, a newer version is available';
  if (a.state === 'modified') return 'Skill changed after installation: updating replaces your changes';
  return a.present ? 'Found on this PC, skill not installed' : 'Not found on this PC';
}

function SkillsCard(props: { mode: 'auto' | 'ask'; setMode: (m: 'auto' | 'ask') => void }) {
  const s = skills.value;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // files may have changed outside TrayCommand
    void api.skills().then((r) => (skills.value = r));
  }, []);
  const run = async (fn: () => Promise<typeof s>, done: string) => {
    setBusy(true);
    try {
      const r = await fn();
      skills.value = r;
      showToast(r?.error ?? done, r?.error ? 'error' : 'ok');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="AI assistants" icon={<Sparkles size={16} />} desc="Create and change trays by asking Claude Code or opencode" testId="skills-card">
      <div class="settings-list">
        <div class="setting" style={{ gridTemplateColumns: '1fr' }}>
          <div class="d" style={{ color: 'var(--text-2)' }}>
            The TrayCommand skill teaches the agent what TrayCommand can do and where your configuration is. Then just ask, for example <i>“add a tray that turns the VPN on and off”</i> or <i>“hide the Docker tray”</i>. The agent edits the configuration file and TrayCommand applies it right away. Installed in your user folder of each agent; nothing else is changed.
          </div>
        </div>
        {s?.agents.map((a) => (
          <Setting title={a.label} desc={skillText(a)} testId={`skill-${a.id}`}>
            <div style={{ display: 'flex', gap: 6 }}>
              {a.state === 'missing' ? (
                <button class="btn sm primary" disabled={busy || !a.present} onClick={() => run(() => api.installSkill([a.id]), `Skill installed for ${a.label}`)} data-testid={`skill-install-${a.id}`}>
                  Install
                </button>
              ) : (
                <>
                  {a.state !== 'current' && (
                    <button class="btn sm primary" disabled={busy} onClick={() => run(() => api.installSkill([a.id]), `Skill updated for ${a.label}`)} data-testid={`skill-update-${a.id}`}>
                      Update
                    </button>
                  )}
                  <button class="btn sm" title={a.dir} onClick={() => api.openPath(a.dir)}>
                    <FolderOpen size={14} />
                  </button>
                  <button class="btn sm" disabled={busy} onClick={() => run(() => api.uninstallSkill(a.id), `Skill removed for ${a.label}`)} data-testid={`skill-remove-${a.id}`}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </Setting>
        ))}
        <Setting title="Skill updates" desc="When a new version of TrayCommand brings a newer skill">
          <select class="select" value={props.mode} onChange={(e) => props.setMode((e.currentTarget as HTMLSelectElement).value as 'auto' | 'ask')} data-testid="skill-updates">
            <option value="auto">Update automatically</option>
            <option value="ask">Ask me first</option>
          </select>
        </Setting>
        {s?.error && <div class="card-empty" style={{ color: 'var(--danger)' }}>{s.error}</div>}
      </div>
    </Card>
  );
}

function ElevatedDialog(props: { onClose: () => void; onConfirm: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <Dialog title="Start as administrator without prompt" icon={<ShieldAlert size={20} color="var(--danger)" />} onClose={props.onClose} testId="elevated-dialog"
      footer={
        <>
          <button class="btn primary" onClick={props.onClose} autoFocus data-testid="elevated-cancel">
            Cancel
          </button>
          <button class="btn danger-solid" disabled={!understood} onClick={props.onConfirm} data-testid="elevated-continue">
            Continue at your own risk
          </button>
        </>
      }
    >
      <div class="risk" data-testid="elevated-risk">
        <p>This creates a task in the Windows Task Scheduler that starts TrayCommand with administrator privileges at every login, without asking.</p>
        <p>Antivirus and corporate security software (EDR) may treat this as malicious behaviour (persistence and privilege elevation): they can block or quarantine TrayCommand, or report your PC to the IT department.</p>
        <p>Do not continue on a company-managed PC, or if you are not absolutely sure.</p>
      </div>
      <div class="hint">
        Windows will ask for administrator permission once (UAC). TrayCommand will be copied to <code>C:\Program Files\TrayCommand</code> so that no other program can replace it. You can turn this off at any time from this page.
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood((e.currentTarget as HTMLInputElement).checked)} data-testid="elevated-understood" /> I understand the risks
      </label>
    </Dialog>
  );
}

export function SettingsView() {
  const config = draft.value;
  const i = info.value;
  const [backups, setBackups] = useState<{ name: string; time: number }[]>([]);
  const [showElevated, setShowElevated] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.backups().then(setBackups);
  }, []);
  if (!config || !i) return null;
  const s = config.settings;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => mutate((c) => (c.settings[key] = value));
  const u = update.value;

  const changeConfigFile = async () => {
    const file = await api.pickFile({ title: 'Choose a TrayCommand configuration file', filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: i.configPath });
    if (!file) return;
    const r = await api.setConfigPath(file);
    info.value = await api.info();
    await reload();
    showToast(r.ok ? 'Configuration file changed' : `Loaded with errors: ${r.issues?.[0]?.message ?? ''}`, r.ok ? 'ok' : 'error');
  };

  const elevate = async (on: boolean) => {
    setShowElevated(false);
    setBusy(true);
    try {
      const r = await api.setStartElevated(on);
      info.value = await api.info();
      showToast(r.ok ? (r.message ?? 'Done') : (r.message ?? 'Failed'), r.ok ? 'ok' : 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page">
      <div class="page-inner">
        <div>
          <h1 data-hud="SYS // 03 · CONFIGURATION">Settings</h1>
          <p class="lead">Saved in the configuration file, except where noted.</p>
        </div>

        <Card title="General">
          <div class="settings-list">
            <Setting title="Start at login" desc={i.startElevated ? 'Handled by the administrator start task' : 'Adds a shortcut to your Startup folder. No Task Scheduler, no registry.'} testId="setting-autostart">
              <Switch checked={i.startElevated || s.autostart} disabled={i.startElevated} onChange={(v) => set('autostart', v)} />
            </Setting>
            <Setting title="Theme">
              <select class="select" value={s.theme} onChange={(e) => set('theme', (e.currentTarget as HTMLSelectElement).value as Settings['theme'])}>
                <option value="system">Same as system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Setting>
            <Setting title="Default shell" desc="Used by scripts that do not choose one">
              <ShellSelect value={s.shell} onChange={(v) => set('shell', v)} />
            </Setting>
            <Setting title="TrayCommand menu" desc="Where the TrayCommand entries (open, settings, quit…) appear">
              <select class="select" value={s.appMenu} onChange={(e) => set('appMenu', (e.currentTarget as HTMLSelectElement).value)}>
                <option value="own">Its own tray icon</option>
                {config.trays.map((t) => (
                  <option value={t.id}>Inside “{t.label}”</option>
                ))}
              </select>
            </Setting>
            <Setting title="Notify when TrayCommand starts">
              <Switch checked={s.notifyOnStartup} onChange={(v) => set('notifyOnStartup', v)} />
            </Setting>
          </div>
        </Card>

        <Card title="Launcher and shortcuts" icon={<Search size={16} />} desc="Search and run any entry from the keyboard" testId="launcher-card">
          <div class="settings-list">
            <Setting title="Shortcut to open the launcher" desc="Type a few letters of an entry, then Enter. Works from any application.">
              <HotkeyInput value={s.launcherHotkey || undefined} onChange={(v) => set('launcherHotkey', v ?? '')} placeholder="No shortcut" statusPath="settings.launcherHotkey" testId="launcher-hotkey" />
            </Setting>
            <Setting title="Open the launcher now">
              <button class="btn sm" onClick={() => void api.openLauncher()} data-testid="open-launcher">
                <Search size={14} /> Open
              </button>
            </Setting>
            {hotkeyStatus.value.filter((h) => !h.ok).map((h) => (
              <Setting title={h.label} desc={`Shortcut not working: ${h.error}`}>
                <Keys hotkey={h.hotkey} platform={i.platform} />
              </Setting>
            ))}
            <Setting title="Pause all schedules" desc="Stored on this PC only. Also in the TrayCommand tray menu." testId="setting-pause-schedules">
              <Switch
                checked={schedulesPaused.value}
                onChange={async (v) => {
                  schedulesPaused.value = await api.setSchedulesPaused(v);
                }}
              />
            </Setting>
          </div>
        </Card>

        <Card title="Configuration file" icon={<FileCog size={16} />}>
          <div class="card-body">
            <div class="path" data-testid="config-path">{i.configPath}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button class="btn sm" onClick={() => api.openPath(i.configDir)}>
                <FolderOpen size={14} /> Open folder
              </button>
              <button class="btn sm" onClick={changeConfigFile}>
                Use another file…
              </button>
            </div>
            <div class="hint">Keep it in a synced folder (OneDrive, Dropbox…) to share it between PCs. Icons and relative paths are resolved from its folder. The choice of file is stored on this PC only.</div>
          </div>
        </Card>

        <Card title="Backups" icon={<History size={16} />} desc="A copy is kept before every save (last 30)">
          <div class="settings-list">
            {backups.slice(0, 6).map((b) => (
              <Setting title={new Date(b.time).toLocaleString()} desc={b.name}>
                <button
                  class="btn sm"
                  onClick={async () => {
                    if (!confirm('Replace the current configuration with this backup?')) return;
                    const r = await api.restoreBackup(b.name);
                    await reload();
                    showToast(r.ok ? 'Backup restored' : 'Cannot restore', r.ok ? 'ok' : 'error');
                    setBackups(await api.backups());
                  }}
                >
                  Restore
                </button>
              </Setting>
            ))}
            {!backups.length && <div class="card-empty">No backups yet.</div>}
          </div>
        </Card>

        <SkillsCard mode={s.skillUpdates} setMode={(m) => set('skillUpdates', m)} />

        <Card title="Updates" icon={<Download size={16} />}>
          <div class="settings-list">
            <Setting title={`Version ${i.version}`} desc={u?.state === 'available' ? `Version ${u.latest} is available` : u?.state === 'none' ? 'You have the latest version' : u?.state === 'error' ? `Check failed: ${u.error}` : u?.state === 'downloading' ? `Downloading… ${Math.round((u.progress ?? 0) * 100)}%` : 'Checked automatically every 6 hours'}>
              <div style={{ display: 'flex', gap: 6 }}>
                {u?.state === 'available' ? (
                  <button class="btn sm primary" onClick={() => api.installUpdate()}>
                    <Download size={14} /> Install {u.latest}
                  </button>
                ) : (
                  <button class="btn sm" onClick={async () => (update.value = await api.checkUpdate())} disabled={u?.state === 'checking'}>
                    <RefreshCw size={14} /> Check now
                  </button>
                )}
              </div>
            </Setting>
            <Setting title="Check for updates automatically">
              <Switch checked={s.checkUpdates} onChange={(v) => set('checkUpdates', v)} />
            </Setting>
            <Setting title="Documentation and release notes">
              <button class="btn sm" onClick={() => api.openExternal(i.docsUrl)}>
                <ExternalLink size={14} /> Open
              </button>
            </Setting>
          </div>
        </Card>

        <Card title="Advanced" icon={<ShieldCheck size={16} />}>
          <div class="settings-list">
            <Setting title="Allow commands as administrator" desc="Actions marked “Run as administrator” ask for permission (UAC) every time they run. No Task Scheduler." testId="setting-admin-commands">
              <Switch checked={s.allowAdminCommands} onChange={(v) => set('allowAdminCommands', v)} />
            </Setting>
            {i.platform === 'win32' && (
              <Setting
                title="Start as administrator without prompt"
                desc={i.startElevated ? 'Enabled on this PC: TrayCommand starts as administrator at login.' : 'Off. Uses the Windows Task Scheduler: read the warning before enabling it.'}
                testId="setting-elevated"
              >
                {i.startElevated ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button class="btn sm" disabled={busy} onClick={async () => (await api.restartElevated()) || showToast('Cannot start the task', 'error')}>
                      Restart as administrator
                    </button>
                    <button class="btn sm" disabled={busy} onClick={() => elevate(false)}>
                      Turn off
                    </button>
                  </div>
                ) : (
                  <button class="btn sm danger" disabled={busy} onClick={() => setShowElevated(true)} data-testid="elevated-open">
                    <ShieldAlert size={14} /> Enable…
                  </button>
                )}
              </Setting>
            )}
            <Setting title="Data folder" desc="Logs, backups and local state">
              <button class="btn sm" onClick={() => api.openPath(i.dataDir)}>
                <FolderOpen size={14} /> Open
              </button>
            </Setting>
          </div>
        </Card>
      </div>
      {showElevated && <ElevatedDialog onClose={() => setShowElevated(false)} onConfirm={() => elevate(true)} />}
    </div>
  );
}
