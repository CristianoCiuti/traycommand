import { useState } from 'preact/hooks';
import { CalendarClock, Eye, EyeOff, GripVertical, Keyboard, Plus, Search, Terminal } from 'lucide-preact';
import { isSeparator, type MenuNode } from '../../shared/config';
import type { Tray } from '../../shared/config';
import { draft, mutate, selection, status, uniqueId } from '../store';
import { EntryIcon } from '../components/ui';
import { EntryEditor } from './EntryEditor';

function trayStatusPill(tray: Tray, index: number) {
  const st = status.value.get(`trays[${index}]`);
  if (tray.hidden) return <span class="pill muted">hidden</span>;
  if (tray.disabled) return <span class="pill muted">disabled</span>;
  if (st?.busy) return <span class="pill busy">running</span>;
  if (tray.state && st?.on !== undefined)
    return (
      <span class={`pill ${st.on ? 'on' : 'off'}`}>
        <span class="dot" />
        {st.on ? 'ON' : 'OFF'}
      </span>
    );
  return null;
}

/** Shortcuts and schedules anywhere in the tray (itself or its menus). */
function extras(tray: Tray) {
  let hotkeys = 0;
  let schedules = 0;
  const visit = (n: MenuNode | Tray) => {
    if (isSeparator(n as MenuNode)) return;
    const e = n as Tray;
    if (e.hotkey) hotkeys++;
    if (e.schedules?.some((s) => !s.disabled)) schedules++;
    e.menu?.forEach(visit);
  };
  visit(tray);
  return { hotkeys, schedules };
}

function subtitle(tray: Tray) {
  const parts: string[] = [];
  if (tray.state) parts.push('toggle');
  if (tray.action) parts.push('click action');
  if (tray.menu?.length) parts.push(`${tray.menu.length} menu ${tray.menu.length === 1 ? 'entry' : 'entries'}`);
  return parts.join(' · ') || 'empty';
}

export function TraysView() {
  const [query, setQuery] = useState('');
  const [dragFrom, setDragFrom] = useState<number>();
  const [dragOver, setDragOver] = useState<number>();
  const config = draft.value;
  if (!config) return null;
  const selected = selection.value;

  const addTray = () => {
    mutate((c) => {
      c.trays.push({ id: uniqueId(c, 'new_tray'), label: 'New tray' });
    });
    selection.value = [draft.value!.trays.length - 1];
  };

  const toggleHidden = (i: number, e: Event) => {
    e.stopPropagation();
    mutate((c) => {
      const t = c.trays[i]!;
      if (t.hidden) delete t.hidden;
      else t.hidden = true;
    });
  };

  const drop = (to: number) => {
    if (dragFrom === undefined || dragFrom === to) return;
    const from = dragFrom;
    mutate((c) => {
      const [moved] = c.trays.splice(from, 1);
      c.trays.splice(to, 0, moved!);
    });
    if (selected[0] === from) selection.value = [to, ...selected.slice(1)];
    setDragFrom(undefined);
    setDragOver(undefined);
  };

  const q = query.trim().toLowerCase();
  const visible = config.trays.map((t, i) => ({ t, i })).filter(({ t }) => !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));

  return (
    <div class="trays">
      <aside class="sidebar">
        <div class="sidebar-head">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-3)' }} />
            <input class="input" style={{ paddingLeft: 28, height: 30 }} placeholder="Search trays" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
          </div>
          <button class="btn primary icon" onClick={addTray} title="New tray" data-testid="add-tray">
            <Plus size={16} />
          </button>
        </div>
        <div class="hud-label" aria-hidden="true">
          SYS // TRAYS <b>{String(config.trays.length).padStart(2, '0')}</b>
        </div>
        <div class="list" data-testid="tray-list">
          {visible.map(({ t, i }) => (
            <div
              class={`tray-row${selected[0] === i ? ' selected' : ''}${t.hidden || t.disabled ? ' dimmed' : ''}${dragOver === i ? ' drag-over' : ''}`}
              onClick={() => (selection.value = [i])}
              draggable={!q}
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver(undefined)}
              onDrop={() => drop(i)}
              onDragEnd={() => {
                setDragFrom(undefined);
                setDragOver(undefined);
              }}
              data-testid="tray-row"
            >
              <span class="handle">
                <GripVertical size={14} />
              </span>
              <span class="tray-icon">
                <EntryIcon path={t.icon} fallback={<Terminal size={15} />} />
              </span>
              <span class="tray-name">
                <div class="title">{t.label || '(no label)'}</div>
                <div class="sub">{subtitle(t)}</div>
              </span>
              <span class="row-actions">
                {extras(t).hotkeys > 0 && (
                  <span class="badge-icon" title={`${extras(t).hotkeys} keyboard shortcut${extras(t).hotkeys > 1 ? 's' : ''}`}>
                    <Keyboard size={13} />
                  </span>
                )}
                {extras(t).schedules > 0 && (
                  <span class="badge-icon" title={`${extras(t).schedules} scheduled ${extras(t).schedules > 1 ? 'entries' : 'entry'}`}>
                    <CalendarClock size={13} />
                  </span>
                )}
                {trayStatusPill(t, i)}
                <button class="btn ghost sm icon" onClick={(e) => toggleHidden(i, e)} title={t.hidden ? 'Show in the tray' : 'Hide from the tray'} data-testid="row-toggle-hidden">
                  {t.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
            </div>
          ))}
          {!visible.length && <div class="hint" style={{ padding: 12 }}>{q ? 'No match' : 'No trays yet'}</div>}
        </div>
      </aside>
      <main class="editor">
        {selected.length && config.trays[selected[0]!] ? (
          <EntryEditor path={selected} />
        ) : (
          <div class="empty">
            <div>
              <div class="big">
                <Terminal size={26} />
              </div>
              <h3 style={{ margin: '0 0 6px' }}>No tray selected</h3>
              <p style={{ margin: '0 0 14px' }}>Create a tray icon that runs your commands.</p>
              <button class="btn primary" onClick={addTray}>
                <Plus size={14} /> New tray
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
