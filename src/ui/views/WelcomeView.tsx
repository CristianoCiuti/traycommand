import { useState } from 'preact/hooks';
import { Download, Play } from 'lucide-preact';
import { api, info, navigate, showToast } from '../store';

export function WelcomeView() {
  const [busy, setBusy] = useState(false);
  const i = info.value;
  return (
    <div class="page">
      <div class="welcome">
        <img src="./icon.png" alt="" />
        <h1 data-hud="SYS // BOOT SEQUENCE">Welcome to TrayCommand</h1>
        <p class="lead">Run your commands from tray icons. Install it for your user: no administrator rights needed, it updates itself and can start at login.</p>
        <div class="choice">
          <div class="card">
            <b>Install for this user</b>
            <span class="hint">Copies TrayCommand to <code class="path">{i?.installDir}</code> and adds it to the Start menu.</span>
            <button
              class="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api.install();
                if (!r.ok) {
                  setBusy(false);
                  showToast(r.message ?? 'Installation failed', 'error');
                }
              }}
              data-testid="install"
            >
              <Download size={14} /> Install
            </button>
          </div>
          <div class="card">
            <b>Just run it from here</b>
            <span class="hint">Nothing is copied. Updates and start at login will use the current location.</span>
            <button class="btn" onClick={() => navigate('/')}>
              <Play size={14} /> Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
