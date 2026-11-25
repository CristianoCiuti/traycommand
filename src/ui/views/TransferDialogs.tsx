import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ArrowRight, ChevronDown, ChevronRight, CircleAlert, Download, Image, Loader2, Upload } from 'lucide-preact';
import type { Config, Settings } from '../../shared/config';
import type { OpenImportResult } from '../../shared/api';
import {
  buildExport,
  checkedDecision,
  defaultExportSelection,
  describeSchedule,
  entryCheck,
  exportDependencies,
  exportKind,
  flatten,
  includeDependencies,
  noChoices,
  packCount,
  planChanges,
  planImport,
  scheduleExportable,
  scheduleRows,
  sectionCheck,
  toggleEntry,
  toggleKey,
  toggleSection,
  type Check,
  type Decision,
  type EntryRow,
  type ExportSelection,
  type ImportChoices,
  type Section,
} from '../../shared/transfer';
import { api, dirty, draft, entryAt, info, pathOfKey, save, showToast, transfer, validation } from '../store';
import { Dialog, EntryIcon, Switch, clearIconCache } from '../components/ui';
import { Keys } from '../components/keys';

/* ---------------- shared pieces ---------------- */

const SETTING_LABELS: Record<keyof Settings, string> = {
  shell: 'Default shell',
  theme: 'Theme',
  style: 'Look',
  appMenu: 'TrayCommand menu',
  notifyOnStartup: 'Notify on startup',
  checkUpdates: 'Check for updates',
  autostart: 'Start at login',
  allowAdminCommands: 'Allow administrator commands',
  launcherHotkey: 'Launcher shortcut',
  busyBadge: 'Badge while running',
  skillUpdates: 'AI skill updates',
};

export function valueText(value: unknown): string {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  if (value === undefined) return '—';
  if (value === '') return 'None';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function TriCheck(props: { state: Check | boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const state = props.state === true ? 'all' : props.state === false ? 'none' : props.state;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      class="tc-check"
      checked={state !== 'none'}
      disabled={props.disabled}
      aria-label={props.label}
      data-testid={props.testId}
      data-state={state}
      onChange={() => props.onChange(state !== 'all')}
    />
  );
}

function Section(props: { title: string; count: string; state?: Check; onToggle?: (on: boolean) => void; open: boolean; setOpen: (o: boolean) => void; children: ComponentChildren; testId: string; extra?: ComponentChildren }) {
  return (
    <section class="xfer-section" data-testid={props.testId}>
      <div class="xfer-section-head">
        {props.state && props.onToggle ? <TriCheck state={props.state} onChange={props.onToggle} label={props.title} testId={`${props.testId}-check`} /> : <span class="tc-check-space" />}
        <button class="xfer-disclosure" onClick={() => props.setOpen(!props.open)} aria-expanded={props.open}>
          {props.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span class="t">{props.title}</span>
          <span class="n">{props.count}</span>
        </button>
        {props.extra}
      </div>
      {props.open && <div class="xfer-rows">{props.children}</div>}
    </section>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------------- export ---------------- */

function ExportDialog(props: { config: Config }) {
  const config = props.config;
  const [sel, setSel] = useState<ExportSelection>(() => defaultExportSelection(config));
  const [open, setOpen] = useState<Record<Section, boolean>>({ entries: true, schedules: false, variables: false, settings: false });
  const [busy, setBusy] = useState(false);
  const flat = useMemo(() => flatten(config.trays), [config]);
  const schedules = useMemo(() => scheduleRows(config), [config]);
  const built = useMemo(() => buildExport(config, sel, { app: info.value?.version, created: new Date().toISOString() }), [config, sel]);
  const deps = useMemo(() => exportDependencies(config, sel), [config, sel]);
  const kind = exportKind(built.pack, built.icons.length);
  const count = packCount(built.pack);
  const close = () => (transfer.value = undefined);
  const toggle = (s: Section) => (on: boolean) => setSel(toggleSection(config, sel, s, on));
  const opener = (s: Section) => (o: boolean) => setOpen({ ...open, [s]: o });
  const settingKeys = Object.keys(SETTING_LABELS) as (keyof Settings)[];
  const selectedOf = (s: Section) => (s === 'entries' ? flat.filter((f) => sel.entries.has(f.key)).length : sel[s].size);
  const totalOf = (s: Section) => (s === 'entries' ? flat.length : s === 'schedules' ? schedules.length : s === 'variables' ? Object.keys(config.variables).length + (config.secrets?.length ?? 0) : settingKeys.length);
  const countText = (s: Section) => `${selectedOf(s)} of ${totalOf(s)}`;

  const parts = [
    built.pack.trays.length && plural(built.pack.trays.length, 'tray'),
    built.pack.schedules.length && plural(built.pack.schedules.length, 'schedule'),
    Object.keys(built.pack.variables).length + (built.pack.secrets?.length ?? 0) && plural(Object.keys(built.pack.variables).length + (built.pack.secrets?.length ?? 0), 'variable'),
    Object.keys(built.pack.settings).length && plural(Object.keys(built.pack.settings).length, 'setting'),
    built.icons.length && plural(built.icons.length, 'icon'),
  ].filter(Boolean);

  const name = () => {
    if (built.pack.trays.length === 1 && count === 1) return built.pack.trays[0]!.label;
    return `TrayCommand ${new Date().toISOString().slice(0, 10)}`;
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await api.exportPack({ pack: built.pack, icons: built.icons, variables: config.variables, name: name() });
      if (r.canceled) return;
      if (!r.ok) {
        showToast(`Not exported: ${r.error}`, 'error');
        return;
      }
      showToast(r.missing?.length ? `Exported, without ${plural(r.missing.length, 'icon')} not found` : `Exported to ${r.file!.split(/[\\/]/).pop()}`);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title="Export"
      icon={<Upload size={18} />}
      onClose={close}
      testId="export-dialog"
      footer={
        <>
          <span class="xfer-summary" data-testid="export-summary">
            {count ? `${parts.join(', ')} · ${kind === 'zip' ? '.zip file' : '.json file'}` : 'Choose what to export'}
          </span>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!count || busy} onClick={() => void doExport()} data-testid="export-save">
            {busy ? <Loader2 size={14} class="spin" /> : <Download size={14} />} Export…
          </button>
        </>
      }
    >
      <p class="hint" style={{ margin: 0 }}>
        Tick what to share. Everything inside a tray or menu goes with it; open a section to pick single items.
      </p>
      <div class="xfer-sections">
        <Section title="Trays and menus" testId="export-entries" count={countText('entries')} state={sectionCheck(config, sel, 'entries')} onToggle={toggle('entries')} open={open.entries} setOpen={opener('entries')}>
          {flat.map((f) => {
            const n = f.node.schedules?.length ?? 0;
            return (
              <label class="xfer-row" style={{ paddingLeft: 8 + f.depth * 22 }} data-testid="export-entry">
                <TriCheck state={entryCheck(config, sel, f.key)} onChange={(on) => setSel(toggleEntry(config, sel, f.key, on))} label={f.node.label} />
                <span class="xfer-ico">
                  <EntryIcon path={f.node.icon} size={16} />
                </span>
                <span class="xfer-label">{f.node.label}</span>
                <span class="xfer-meta">
                  {f.node.hotkey && <Keys hotkey={f.node.hotkey} platform={info.value?.platform} small />}
                  {n > 0 && <span>{plural(n, 'schedule')}</span>}
                </span>
              </label>
            );
          })}
          {!flat.length && <div class="xfer-empty">No trays</div>}
        </Section>

        <Section title="Schedules" testId="export-schedules" count={countText('schedules')} state={sectionCheck(config, sel, 'schedules')} onToggle={toggle('schedules')} open={open.schedules} setOpen={opener('schedules')}>
          {schedules.map((s) => {
            const can = scheduleExportable(sel, s);
            const alone = sel.schedules.has(s.key) && !sel.entries.has(s.entryKey);
            return (
              <label class={`xfer-row ${can ? '' : 'disabled'}`} data-testid="export-schedule">
                <TriCheck state={can && sel.schedules.has(s.key)} disabled={!can} onChange={(on) => setSel(toggleKey(sel, 'schedules', s.key, on))} label={describeSchedule(s.schedule)} />
                <span class="xfer-label">{describeSchedule(s.schedule)}</span>
                <span class="xfer-meta">
                  {s.path.join(' › ')}
                  {!can && ' · the entry has no id: export it too'}
                  {can && alone && ' · alone: added to this entry when imported'}
                </span>
              </label>
            );
          })}
          {!schedules.length && <div class="xfer-empty">No schedules</div>}
        </Section>

        <Section title="Variables" testId="export-variables" count={countText('variables')} state={sectionCheck(config, sel, 'variables')} onToggle={toggle('variables')} open={open.variables} setOpen={opener('variables')}>
          {Object.entries(config.variables).map(([k, v]) => (
            <label class="xfer-row" data-testid="export-variable">
              <TriCheck state={sel.variables.has(k)} onChange={(on) => setSel(toggleKey(sel, 'variables', k, on))} label={k} />
              <span class="xfer-label mono">{`\${${k}}`}</span>
              <span class="xfer-meta mono">{v}</span>
            </label>
          ))}
          {(config.secrets ?? []).map((k) => (
            <label class="xfer-row" data-testid="export-variable" data-secret="true">
              <TriCheck state={sel.variables.has(k)} onChange={(on) => setSel(toggleKey(sel, 'variables', k, on))} label={k} />
              <span class="xfer-label mono">{`\${${k}}`}</span>
              <span class="pill muted">secret</span>
              <span class="xfer-meta">only the name: the value never leaves this PC</span>
            </label>
          ))}
          {!Object.keys(config.variables).length && !config.secrets?.length && <div class="xfer-empty">No variables</div>}
        </Section>

        <Section title="Settings" testId="export-settings" count={countText('settings')} state={sectionCheck(config, sel, 'settings')} onToggle={toggle('settings')} open={open.settings} setOpen={opener('settings')}>
          {settingKeys.map((k) => (
            <label class="xfer-row" data-testid="export-setting">
              <TriCheck state={sel.settings.has(k)} onChange={(on) => setSel(toggleKey(sel, 'settings', k, on))} label={SETTING_LABELS[k]} />
              <span class="xfer-label">{SETTING_LABELS[k]}</span>
              <span class="xfer-meta">{valueText(config.settings[k])}</span>
            </label>
          ))}
        </Section>
      </div>

      {(deps.entries.length > 0 || deps.variables.length > 0) && (
        <div class="notice warn" data-testid="export-deps">
          <CircleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div>What you export uses things left out:</div>
            <ul class="xfer-list">
              {deps.entries.map((d) => (
                <li>
                  <b>{d.label}</b> <span class="hint">(used by {d.by})</span>
                </li>
              ))}
              {deps.variables.map((d) => (
                <li>
                  <b class="mono">{`\${${d.name}}`}</b> <span class="hint">(used by {d.by})</span>
                </li>
              ))}
            </ul>
          </div>
          <button class="btn sm" onClick={() => setSel(includeDependencies(config, sel, deps))} data-testid="export-deps-add">
            Include them
          </button>
        </div>
      )}

      <Switch
        checked={sel.icons}
        onChange={(icons) => setSel({ ...sel, icons })}
        testId="export-icons"
        label={
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Image size={14} /> Include icons
          </span>
        }
        hint={sel.icons ? 'The icon files go in the export (as a .zip file).' : 'Entries are exported without their icons.'}
      />
    </Dialog>
  );
}

/* ---------------- import ---------------- */

type Opened = Extract<OpenImportResult, { ok: true }>;

const DECISION_LABELS: Record<Exclude<Decision, 'skip'>, string> = {
  add: 'Add',
  merge: 'Add to it',
  replace: 'Replace it',
  rename: 'Keep both',
};

function StatusPill(props: { row: EntryRow }) {
  const r = props.row;
  if (r.status === 'inside') return <span class="pill muted">not imported</span>;
  if (r.status === 'new') return <span class="pill on">new</span>;
  if (r.status === 'identical') return <span class="pill muted">already here</span>;
  return <span class="pill warn">already here, different</span>;
}

/** "trays[1].menu[0].action" → "Docker › Up: " */
function issueWhere(config: Config, path: string): string {
  const m = /^(trays\[\d+\](?:\.menu\[\d+\])*)/.exec(path);
  if (!m) return path ? `${path}: ` : '';
  const p = pathOfKey(m[1]!);
  const labels: string[] = [];
  for (let i = 1; p && i <= p.length; i++) labels.push(entryAt(config, p.slice(0, i))?.label ?? '?');
  return `${labels.join(' › ')}: `;
}

function ImportDialog(props: { opened: Opened; config: Config }) {
  const { opened, config } = props;
  const [choices, setChoices] = useState<ImportChoices>(noChoices);
  const [open, setOpen] = useState({ entries: true, hotkeys: true, schedules: true, variables: true, settings: true });
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planImport(config, opened.pack, choices), [config, opened, choices]);
  const close = () => (transfer.value = undefined);
  const setEntry = (key: string, d: Decision) => setChoices({ ...choices, entries: { ...choices.entries, [key]: d } });
  const changes = planChanges(plan);
  // problems already in the editor (unsaved) are not caused by the import: they must be fixed first
  const draftOk = validation.value?.ok !== false;
  const pack = opened.pack;
  const c = plan.counts;
  const already = plan.entries.filter((r) => r.status === 'identical' && r.decision === 'skip').length;
  const summary = [
    c.add && `${c.add} new`,
    c.replace && `${c.replace} replaced`,
    c.merge && `${c.merge} merged`,
    c.rename && `${c.rename} kept apart`,
    c.schedules && plural(c.schedules, 'schedule'),
    c.variables && plural(c.variables, 'variable'),
    c.settings && plural(c.settings, 'setting'),
  ].filter(Boolean);
  const live = plan.entries.filter((r) => r.status !== 'inside');
  // what is already here (and left alone) does not count as unticked
  const relevant = live.filter((r) => !(r.status === 'identical' && r.decision === 'skip'));
  const ticked = relevant.filter((r) => r.decision !== 'skip').length;
  const entriesState: Check = ticked === 0 ? 'none' : ticked === relevant.length ? 'all' : 'some';
  // ticking the section goes back to what is proposed for each entry; unticking leaves everything out
  const toggleAllEntries = (on: boolean) => setChoices({ ...choices, entries: on ? {} : Object.fromEntries(plan.entries.map((r) => [r.key, 'skip' as Decision])) });
  const valuesState = (rows: { checked: boolean; status: string }[]): Check => {
    const usable = rows.filter((r) => r.status !== 'same' && r.status !== 'missing');
    const n = usable.filter((r) => r.checked).length;
    return n === 0 ? 'none' : n === usable.length ? 'all' : 'some';
  };

  const doImport = async () => {
    setBusy(true);
    const before = draft.value;
    try {
      const icons = plan.icons.length ? await api.importIcons(opened.token, plan.icons) : {};
      const final = planImport(config, pack, choices, icons);
      draft.value = final.config;
      if (await save()) {
        clearIconCache();
        showToast(`Imported: ${summary.join(', ')}`);
        close();
      } else draft.value = before;
    } finally {
      setBusy(false);
    }
  };

  const source = opened.kind === 'config' ? 'Configuration file' : `Export${pack.app ? ` from TrayCommand ${pack.app}` : ''}${pack.created ? `, ${new Date(pack.created).toLocaleString()}` : ''}`;

  return (
    <Dialog
      wide
      title={`Import ${opened.name}`}
      icon={<Download size={18} />}
      onClose={close}
      testId="import-dialog"
      footer={
        <>
          <span class="xfer-summary" data-testid="import-summary">
            {changes ? summary.join(', ') : 'Nothing to import'}
            {already > 0 && ` · ${already} already here`}
          </span>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" disabled={!changes || plan.issues.length > 0 || busy || !draftOk} onClick={() => void doImport()} data-testid="import-apply">
            {busy && <Loader2 size={14} class="spin" />} Import
          </button>
        </>
      }
    >
      <p class="hint" style={{ margin: 0 }}>
        {source}. Untick what you do not want; for what is already here, choose what to do.
      </p>
      <div class="xfer-sections">
        {plan.entries.length > 0 && (
          <Section title="Trays and menus" testId="import-entries" count={`${live.filter((r) => r.decision !== 'skip').length} of ${live.length}`} state={entriesState} onToggle={toggleAllEntries} open={open.entries} setOpen={(o) => setOpen({ ...open, entries: o })}>
            {plan.entries.map((r) => {
              const icon = r.icon ? opened.icons[r.icon] : undefined;
              const inside = r.status === 'inside';
              return (
                <div class={`xfer-row ${inside ? 'disabled' : ''}`} style={{ paddingLeft: 8 + r.depth * 22 }} data-testid="import-entry" data-status={r.status}>
                  <TriCheck state={r.decision !== 'skip'} disabled={inside} onChange={(on) => setEntry(r.key, on ? checkedDecision(r) : 'skip')} label={r.label} />
                  <span class="xfer-ico">{icon ? <img src={icon} width={16} height={16} alt="" /> : null}</span>
                  <span class="xfer-label">{r.label}</span>
                  <StatusPill row={r} />
                  {r.admin && r.status !== 'inside' && <span class="pill danger" title="One of its actions runs as administrator">admin</span>}
                  <span class="xfer-meta">
                    {r.hotkey && <Keys hotkey={r.hotkey} platform={info.value?.platform} small />}
                    {r.schedules > 0 && <span>{plural(r.schedules, 'schedule')}</span>}
                    {r.existing && r.status === 'conflict' && (r.existing.label !== r.label || r.existing.where) && (
                      <span>
                        here: {r.existing.label !== r.label ? `“${r.existing.label}”` : ''}
                        {r.existing.where ? ` in ${r.existing.where}` : ''}
                      </span>
                    )}
                  </span>
                  {r.status === 'conflict' && r.decision !== 'skip' && r.options.length > 1 && (
                    <select class="select xfer-select" value={r.decision} onChange={(e) => setEntry(r.key, (e.currentTarget as HTMLSelectElement).value as Decision)} data-testid="import-decision" aria-label={`What to do with ${r.label}`}>
                      {r.options.map((o) => (
                        <option value={o}>{DECISION_LABELS[o]}</option>
                      ))}
                    </select>
                  )}
                  {r.newId && <span class="xfer-meta mono" title="New id">→ {r.newId}</span>}
                </div>
              );
            })}
          </Section>
        )}

        {plan.hotkeys.length > 0 && (
          <Section title="Shortcuts used twice" testId="import-hotkeys" count={String(plan.hotkeys.length)} open={open.hotkeys} setOpen={(o) => setOpen({ ...open, hotkeys: o })}>
            {plan.hotkeys.map((h) => (
              <div class="xfer-row" data-testid="import-hotkey">
                <span class="xfer-label">
                  <Keys hotkey={h.hotkey} platform={info.value?.platform} small />
                </span>
                {h.launcher ? (
                  <span class="xfer-meta">used by the launcher: {h.label} is imported without it</span>
                ) : (
                  <select class="select xfer-select wide" value={h.winner} onChange={(e) => setChoices({ ...choices, hotkeys: { ...choices.hotkeys, [h.key]: (e.currentTarget as HTMLSelectElement).value as 'existing' | 'imported' } })} data-testid="import-hotkey-winner" aria-label={`Shortcut ${h.hotkey}`}>
                    <option value="existing">
                      Keep it on {h.holder} ({h.holderImported ? 'imported' : 'here'})
                    </option>
                    <option value="imported">Move it to {h.label} (imported)</option>
                  </select>
                )}
              </div>
            ))}
          </Section>
        )}

        {plan.schedules.length > 0 && (
          <Section
            title="Schedules"
            testId="import-schedules"
            count={`${c.schedules} of ${plan.schedules.length}`}
            state={valuesState(plan.schedules)}
            onToggle={(on) => setChoices({ ...choices, schedules: Object.fromEntries(plan.schedules.filter((s) => s.status !== 'missing').map((s) => [s.index, on])) })}
            open={open.schedules}
            setOpen={(o) => setOpen({ ...open, schedules: o })}
          >
            {plan.schedules.map((s) => (
              <div class={`xfer-row ${s.status === 'missing' ? 'disabled' : ''}`} data-testid="import-schedule" data-status={s.status}>
                <TriCheck state={s.checked} disabled={s.status === 'missing'} onChange={(on) => setChoices({ ...choices, schedules: { ...choices.schedules, [s.index]: on } })} label={s.text} />
                <span class="xfer-label">{s.text}</span>
                {s.status === 'missing' ? <span class="pill danger">no entry “{s.entry}” here</span> : s.status === 'identical' ? <span class="pill muted">already here</span> : <span class="pill on">new</span>}
                <span class="xfer-meta">
                  <ArrowRight size={12} /> {s.label}
                </span>
              </div>
            ))}
          </Section>
        )}

        {plan.variables.length > 0 && (
          <Section
            title="Variables"
            testId="import-variables"
            count={`${c.variables} of ${plan.variables.length}`}
            state={valuesState(plan.variables)}
            onToggle={(on) => setChoices({ ...choices, variables: Object.fromEntries(plan.variables.map((v) => [v.name, on])) })}
            open={open.variables}
            setOpen={(o) => setOpen({ ...open, variables: o })}
          >
            {plan.variables.map((v) => (
              <div class={`xfer-row ${v.status === 'same' ? 'disabled' : ''}`} data-testid="import-variable" data-status={v.status}>
                <TriCheck state={v.checked} disabled={v.status === 'same'} onChange={(on) => setChoices({ ...choices, variables: { ...choices.variables, [v.name]: on } })} label={v.name} />
                <span class="xfer-label mono">{`\${${v.name}}`}</span>
                {v.status === 'new' ? <span class="pill on">new</span> : v.status === 'same' ? <span class="pill muted">already here</span> : <span class="pill warn">different here</span>}
                {v.secret ? (
                  <span class="xfer-meta">secret: give it a value of yours in Variables</span>
                ) : (
                  <span class="xfer-meta mono">{v.status === 'different' ? `${valueText(v.current)} → ${valueText(v.value)}` : valueText(v.value)}</span>
                )}
              </div>
            ))}
          </Section>
        )}

        {plan.settings.length > 0 && (
          <Section
            title="Settings"
            testId="import-settings"
            count={`${c.settings} of ${plan.settings.length}`}
            state={valuesState(plan.settings)}
            // ticking the whole section leaves alone the settings that need a look (they are ticked one by one)
            onToggle={(on) => setChoices({ ...choices, settings: Object.fromEntries(plan.settings.map((v) => [v.name, on && !v.caution ? true : on ? v.checked : false])) })}
            open={open.settings}
            setOpen={(o) => setOpen({ ...open, settings: o })}
          >
            {plan.settings.map((v) => (
              <div class={`xfer-row ${v.status === 'same' ? 'disabled' : ''}`} data-testid="import-setting" data-status={v.status}>
                <TriCheck state={v.checked} disabled={v.status === 'same'} onChange={(on) => setChoices({ ...choices, settings: { ...choices.settings, [v.name]: on } })} label={v.name} />
                <span class="xfer-label">{SETTING_LABELS[v.name as keyof Settings]}</span>
                {v.status === 'same' && <span class="pill muted">already so</span>}
                <span class="xfer-meta">{v.status === 'different' ? `${valueText(v.current)} → ${valueText(v.value)}` : valueText(v.value)}</span>
                {v.caution && <span class="xfer-caution">{v.caution}</span>}
              </div>
            ))}
          </Section>
        )}
      </div>

      {opened.missing.length > 0 && (
        <div class="notice" data-testid="import-missing-icons">
          <Image size={16} style={{ flex: 'none', marginTop: 1 }} />
          <span>
            {plural(opened.missing.length, 'icon')} not found in the file: {opened.missing.length === 1 ? 'that entry keeps its icon path' : 'those entries keep their icon paths'} (the default icon is shown if it is not on this PC).
          </span>
        </div>
      )}
      {!draftOk && (
        <div class="issues" data-testid="import-draft-invalid">
          The editor has unsaved changes with problems: fix or discard them first, then import.
        </div>
      )}
      {draftOk && plan.issues.length > 0 && (
        <div class="issues" data-testid="import-issues">
          <b>This cannot be imported as chosen:</b>
          <ul>
            {plan.issues.slice(0, 5).map((i) => (
              <li>
                {issueWhere(plan.config, i.path)}
                {i.message}
              </li>
            ))}
          </ul>
          {plan.issues.some((i) => /Unknown id/.test(i.message)) && <div>Tick the entries they refer to, or import those entries too.</div>}
        </div>
      )}
      {dirty.value && changes > 0 && plan.issues.length === 0 && <div class="hint">Your unsaved changes are saved together with the import.</div>}
    </Dialog>
  );
}

/* ---------------- entry points ---------------- */

export async function startImport(file?: string) {
  const r = await api.openImport(file);
  if (r.ok) transfer.value = { mode: 'import', opened: r };
  else if (!r.canceled) showToast(`Cannot import: ${r.error}`, 'error');
}

export function startExport() {
  transfer.value = { mode: 'export' };
}

/** The open export or import window. */
export function TransferDialog() {
  const t = transfer.value;
  const config = draft.value;
  if (!t || !config) return null;
  return t.mode === 'export' ? <ExportDialog config={config} /> : <ImportDialog opened={t.opened} config={config} />;
}
