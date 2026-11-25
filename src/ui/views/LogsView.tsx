import { useEffect, useState } from 'preact/hooks';
import { CircleStop, FolderOpen } from 'lucide-preact';
import type { RunningInfo } from '../../shared/api';
import { api, info, logs } from '../store';
import { Card, formatDuration, timeAgo } from '../components/ui';

const SOURCES: Record<string, string> = { hotkey: 'shortcut', launcher: 'launcher', schedule: 'scheduled', watch: 'file watch', alert: 'chosen in an alert', notification: 'notification click', cli: 'command line' };

export function LogsView() {
  const [open, setOpen] = useState<number>();
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const [running, setRunning] = useState<RunningInfo[]>([]);
  useEffect(() => {
    const load = () => void api.running().then(setRunning);
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);
  const list = logs.value.filter((l) => filter === 'all' || !l.ok);

  return (
    <div class="page">
      <div class="page-inner">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 data-hud="SYS // 03 · ACTIVITY LOG">Activity</h1>
            <p class="lead">Every action run from the tray or the editor. State checks are not listed.</p>
          </div>
          <select class="select" style={{ width: 160 }} value={filter} onChange={(e) => setFilter((e.currentTarget as HTMLSelectElement).value as 'all' | 'errors')}>
            <option value="all">All</option>
            <option value="errors">Errors only</option>
          </select>
          {info.value && (
            <button class="btn" onClick={() => api.openPath(`${info.value!.dataDir}/logs`)}>
              <FolderOpen size={14} /> Log folder
            </button>
          )}
        </div>

        {running.length > 0 && (
          <Card title={`Running now (${running.length})`}>
            <div class="settings-list">
              {running.map((p) => (
                <div class="setting">
                  <div>
                    <div class="t">{p.label}</div>
                    <div class="d mono">{p.script.split('\n')[0]}</div>
                  </div>
                  <button class="btn sm danger" onClick={() => api.kill(p.id)}>
                    <CircleStop size={14} /> Stop ({formatDuration(Date.now() - p.startedAt)})
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="History">
          {list.length ? (
            <table class="log-table" data-testid="log-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Result</th>
                  <th>Entry</th>
                  <th style={{ width: 90 }}>Duration</th>
                  <th style={{ width: 120 }}>When</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l, idx) => (
                  <>
                    <tr class="clickable" onClick={() => setOpen(open === idx ? undefined : idx)}>
                      <td>
                        {l.skipped ? (
                          <span class="pill muted" title={l.skipped}>
                            Skipped
                          </span>
                        ) : (
                          <span class={`pill ${l.ok ? 'on' : 'danger'}`}>{l.ok ? 'OK' : l.error ? 'Error' : `Exit ${l.code}`}</span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {l.label} <span class="hint">{l.kind === 'off' ? '· turn off' : l.kind === 'right' ? '· right click' : ''}{l.source && SOURCES[l.source] ? ` · ${SOURCES[l.source]}` : ''}</span>
                        </div>
                        <div class={`hint ${l.skipped ? '' : 'mono'}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 460 }}>
                          {l.skipped ?? l.script.split('\n')[0]}
                        </div>
                      </td>
                      <td>{l.skipped ? '—' : formatDuration(l.durationMs)}</td>
                      <td class="hint" title={new Date(l.time).toLocaleString()}>
                        {timeAgo(l.time)}
                      </td>
                    </tr>
                    {open === idx && (
                      <tr class="log-detail">
                        <td colSpan={4}>
                          <div class="output">
                            <pre>{l.script}</pre>
                            {l.inputs && (
                              <pre style={{ borderTop: '1px dashed var(--border)' }}>
                                {Object.entries(l.inputs)
                                  .map(([k, v]) => `${k} = ${v}`)
                                  .join('\n')}
                              </pre>
                            )}
                            {l.skipped && <pre style={{ borderTop: '1px dashed var(--border)' }}>{l.skipped}</pre>}
                            {!l.skipped && (l.stdout || !l.stderr) && <pre style={{ borderTop: '1px dashed var(--border)' }}>{l.stdout || '(no output)'}</pre>}
                            {(l.stderr || l.error) && <pre class="err">{[l.error, l.stderr].filter(Boolean).join('\n')}</pre>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          ) : (
            <div class="card-empty">Nothing here yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
