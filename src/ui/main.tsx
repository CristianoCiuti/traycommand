import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { Activity, Braces, Loader2, Settings as SettingsIcon, SquareTerminal, CircleAlert } from 'lucide-preact';
import './styles.css';
import { dirty, discard, draft, info, init, loadIssues, navigate, route, save, toast, validation } from './store';
import { TraysView } from './views/TraysView';
import { SettingsView } from './views/SettingsView';
import { LogsView } from './views/LogsView';
import { JsonView } from './views/JsonView';
import { WelcomeView } from './views/WelcomeView';

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
    return () => {
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
          <img src="./icon.png" alt="" />
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
      <div style={{ minHeight: 0 }}>
        {current === '/welcome' ? <WelcomeView /> : current === '/json' || (broken && current !== '/logs') ? <JsonView /> : current === '/settings' ? <SettingsView /> : current === '/logs' ? <LogsView /> : <TraysView />}
      </div>
      <SaveBar />
      {toast.value && <div class={`toast ${toast.value.kind === 'error' ? 'error' : ''}`}>{toast.value.text}</div>}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
void init();
