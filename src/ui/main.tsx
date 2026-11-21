import { render } from 'preact';
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Activity, Braces, Loader2, Settings as SettingsIcon, SquareTerminal, CircleAlert, Sparkles } from 'lucide-preact';
import { applyStyle, chromeColors } from './themes/apply';
import { EDITOR_CSS } from './themes/editor';
import { activeStyle, api, dirty, discard, draft, info, init, loadIssues, navigate, route, save, showToast, skills, skillsSnoozed, toast, validation } from './store';
import { TraysView } from './views/TraysView';
import { SettingsView } from './views/SettingsView';
import { LogsView } from './views/LogsView';
import { JsonView } from './views/JsonView';
import { WelcomeView } from './views/WelcomeView';
import { TransferDialog, startImport } from './views/TransferDialogs';

const TABS = [
  { route: '/', label: 'Trays', icon: SquareTerminal },
  { route: '/logs', label: 'Activity', icon: Activity },
  { route: '/settings', label: 'Settings', icon: SettingsIcon },
  { route: '/json', label: 'JSON', icon: Braces },
];

function SaveBar() {
  if (!dirty.value) return null;
  const v = validation.value;
  const invalid = v && !v.ok;
  return (
    <div class="savebar" data-testid="savebar">
      <span class="msg">
        {invalid ? <CircleAlert size={16} color="var(--danger)" /> : <span class="dot" style={{ color: 'var(--warn)' }} />}
        {invalid ? `${v.issues.length} problem${v.issues.length > 1 ? 's' : ''} to fix` : 'Unsaved changes'}
      </span>
      <button class="btn ghost" onClick={discard}>
        Discard
      </button>
      <button class="btn primary" disabled={invalid} onClick={() => void save()} data-testid="save">
        Save <span class="kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>Ctrl+S</span>
      </button>
    </div>
  );
}

function names(labels: string[]) {
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : (labels[0] ?? '');
}

/** Proposes to install (or update) the TrayCommand skill for the AI agents found on this PC. */
function SkillBanner() {
  const s = skills.value;
  if (!s || !s.offer.length || skillsSnoozed.value) return null;
  const offered = s.agents.filter((a) => s.offer.includes(a.id));
  const missing = offered.filter((a) => a.state === 'missing');
  const changed = offered.filter((a) => a.state === 'modified');
  const text = missing.length === offered.length
    ? <>{names(offered.map((a) => a.label))} {offered.length > 1 ? 'are' : 'is'} on this PC. Install the TrayCommand skill and just ask: <i>“add a tray that starts my Docker stack”</i>.</>
    : <>A newer TrayCommand skill is available for {names(offered.map((a) => a.label))}.{changed.length ? ` Your changes to the skill for ${names(changed.map((a) => a.label))} will be replaced.` : ''}</>;
  return (
    <div class="banner" data-testid="skill-banner">
      <Sparkles size={18} color="var(--accent)" />
      <span class="msg">{text}</span>
      <button class="btn sm primary" data-testid="skill-banner-install" onClick={async () => {
        const r = await api.installSkill(s.offer);
        skills.value = r;
        showToast(r.error ?? `TrayCommand skill installed for ${names(offered.map((a) => a.label))}`, r.error ? 'error' : 'ok');
      }}>
        {missing.length === offered.length ? 'Install' : 'Update'}
      </button>
      <button class="btn sm ghost" onClick={() => (skillsSnoozed.value = true)}>Not now</button>
      <button class="btn sm ghost" data-testid="skill-banner-decline" onClick={async () => (skills.value = await api.declineSkill(s.offer))}>Don't ask again</button>
    </div>
  );
}

function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty.peek() && validation.peek()?.ok) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.peek()) e.returnValue = false;
    };
    window.addEventListener('beforeunload', onUnload);
    // a file dropped on the window is imported (an export or a configuration file)
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      if (!/\.(zip|json)$/i.test(file.name)) {
        showToast('Drop a TrayCommand export (.zip or .json) to import it', 'error');
        return;
      }
      void startImport(api.pathForFile(file));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  if (!info.value) {
    return (
      <div class="empty">
        <Loader2 size={22} class="spin" />
      </div>
    );
  }

  const r = route.value;
  const current = r.startsWith('/settings') ? '/settings' : r.startsWith('/logs') ? '/logs' : r.startsWith('/json') ? '/json' : r.startsWith('/welcome') ? '/welcome' : '/';
  const broken = !draft.value || loadIssues.value.length > 0;

  return (
    <div class={`app platform-${info.value.platform}`}>
      <header class="titlebar">
        <div class="brand">
          <img src={`./icon-${activeStyle.value}.png`} alt="" />
          TrayCommand
        </div>
        <nav class="nav">
          {TABS.map((t) => (
            <button class={current === t.route ? 'active' : ''} onClick={() => navigate(t.route)} data-testid={`tab-${t.label.toLowerCase()}`}>
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </nav>
        <span class="spacer" />
      </header>
      <div class="content">
        <div>{current !== '/welcome' && <SkillBanner />}</div>
        {current === '/welcome' ? <WelcomeView /> : current === '/json' || (broken && current !== '/logs') ? <JsonView /> : current === '/settings' ? <SettingsView /> : current === '/logs' ? <LogsView /> : <TraysView />}
      </div>
      <SaveBar />
      <TransferDialog />
      {toast.value && <div class={`toast ${toast.value.kind === 'error' ? 'error' : ''}`}>{toast.value.text}</div>}
    </div>
  );
}

// the look: the one being chosen in the settings is shown at once; the window buttons follow it, light or dark
applyStyle('aurora', EDITOR_CSS);
const sendChrome = () => api.setChrome(chromeColors(), activeStyle.peek());
effect(() => {
  applyStyle(activeStyle.value, EDITOR_CSS);
  sendChrome();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sendChrome);

render(<App />, document.getElementById('app')!);
void init();
