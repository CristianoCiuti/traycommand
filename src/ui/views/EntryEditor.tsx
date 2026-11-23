import { ChevronRight, Copy, Eye, EyeOff, ListTree, MousePointerClick, MousePointer2, Power, Trash2, ToggleRight, Ban, Link2, Keyboard, CalendarClock } from 'lucide-preact';
import type { MenuEntry, Tray } from '../../shared/config';
import { allIds, draft, entryAt, issuesFor, mutate, selection, siblingsOf, status, statusKey, uniqueId, updateEntry, type AnyEntry } from '../store';
import { isSeparator, normalizeAction, type MenuNode } from '../../shared/config';
import { HotkeyInput } from '../components/HotkeyInput';
import { SchedulesEditor } from './SchedulesEditor';
import { scheduleCardText } from '../../shared/scheduleForm';
import { schedulesPaused } from '../store';
import { Card, Field, Switch } from '../components/ui';
import { VarField } from '../components/VarField';
import { ActionEditor, AddActionButton } from './ActionEditor';
import { StateEditor } from './StateEditor';
import { MenuEditor } from './MenuEditor';
import { IconPicker } from './IconPicker';

function Breadcrumbs(props: { path: number[] }) {
  const parts = props.path.map((_, i) => props.path.slice(0, i + 1));
  return (
    <div class="crumbs">
      {parts.map((p, i) => {
        const e = entryAt(draft.value, p);
        const last = i === parts.length - 1;
        return (
          <>
            {i > 0 && <ChevronRight size={13} />}
            {last ? <span>{e?.label || '(no label)'}</span> : <button onClick={() => (selection.value = p)}>{e?.label || '(no label)'}</button>}
          </>
        );
      })}
    </div>
  );
}

/** "Ask before running": a confirmation before the shortcut runs the entry, with its own texts. */
function HotkeyConfirmEditor(props: { entry: AnyEntry; setKey: <K extends keyof Tray>(key: K, value: Tray[K] | undefined) => void }) {
  const { entry, setKey } = props;
  const c = entry.hotkeyConfirm;
  const custom = typeof c === 'object' ? c : {};
  const change = (patch: { text?: string; button?: string }) => {
    const next = { ...custom, ...patch };
    if (!next.text) delete next.text;
    if (!next.button) delete next.button;
    setKey('hotkeyConfirm', (Object.keys(next).length ? next : true) as never);
  };
  return (
    <div class="card-body">
      <Switch
        checked={!!c}
        onChange={(v) => setKey('hotkeyConfirm', (v || undefined) as never)}
        label="Ask before running"
        hint={c ? undefined : 'The shortcut shows a confirmation first; clicks and the launcher do not ask'}
        testId="hotkey-confirm"
      />
      {c && (
        <div class="grid2">
          <Field label="Question" hint="${VARIABLES} allowed">
            <VarField value={custom.text ?? ''} placeholder={`${entry.state ? 'Turn on/off' : 'Run'} “${entry.label}”?`} onInput={(text) => change({ text })} testId="hotkey-confirm-text" />
          </Field>
          <Field label="Confirm button">
            <VarField value={custom.button ?? ''} placeholder={entry.state ? 'Turn on / Turn off' : 'Run'} onInput={(button) => change({ button })} testId="hotkey-confirm-button" />
          </Field>
        </div>
      )}
    </div>
  );
}

export function EntryEditor(props: { path: number[] }) {
  const path = props.path;
  const entry = entryAt(draft.value, path);
  if (!entry) return <div class="empty">Select a tray</div>;
  const isTray = path.length === 1;
  const tray = entry as Tray;
  const st = status.value.get(statusKey(path));
  const issues = issuesFor(path);
  const set = (fn: (e: AnyEntry) => void) => updateEntry(path, fn);
  const setKey = <K extends keyof Tray>(key: K, value: Tray[K] | undefined) =>
    set((e) => {
      if (value === undefined || value === false || value === '') delete (e as Tray)[key];
      else (e as Tray)[key] = value as never;
    });

  const remove = () => {
    if (!confirm(`Delete “${entry.label}”${entry.menu?.length ? ' and its menu' : ''}?`)) return;
    mutate((c) => siblingsOf(c, path)?.splice(path.at(-1)!, 1));
    selection.value = path.length > 1 ? path.slice(0, -1) : draft.value!.trays.length > 1 ? [Math.max(0, path[0]! - 1)] : [];
  };

  const duplicate = () => {
    mutate((c) => {
      const list = siblingsOf(c, path)!;
      const copy = structuredClone(list[path.at(-1)!]!) as AnyEntry;
      const renumber = (n: MenuNode | AnyEntry) => {
        if (isSeparator(n as MenuNode)) return;
        const e = n as AnyEntry;
        if (e.id) e.id = uniqueId(c, e.id);
        delete e.hotkey; // a shortcut can belong to one entry only
        delete e.hotkeyConfirm;
        e.menu?.forEach(renumber);
      };
      renumber(copy);
      copy.label = `${copy.label} (copy)`;
      list.splice(path.at(-1)! + 1, 0, copy as never);
    });
    selection.value = [...path.slice(0, -1), path.at(-1)! + 1];
  };

  const otherIds = allIds(draft.value).filter((x) => x.id !== entry.id);
  // runs started by a folder watch get the file: its values can be used in the actions
  const scope = { files: (entry.schedules ?? []).some((s) => s.watch !== undefined) };

  return (
    <div class="editor-inner" data-testid="entry-editor">
      {path.length > 1 && <Breadcrumbs path={path} />}
      <div class="entry-head">
        <IconPicker large value={entry.icon} onChange={(v) => setKey('icon', v)} />
        <div>
          <VarField class="title-input" value={entry.label} placeholder={isTray ? 'Tray name' : 'Menu item name'} onInput={(label) => setKey('label', label as never)} testId="entry-label" />
          <div class="id-line">
            id
            <input
              value={entry.id ?? ''}
              placeholder={isTray ? 'required' : 'optional, needed to reference it'}
              onInput={(e) => setKey('id', ((e.currentTarget as HTMLInputElement).value || undefined) as never)}
              data-testid="entry-id"
            />
            {st?.on !== undefined && <span class={`pill ${st.on ? 'on' : 'off'}`}><span class="dot" />{st.on ? 'ON' : 'OFF'}</span>}
            {st?.busy && <span class="pill busy">running</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button class={`btn sm${entry.hidden ? ' primary' : ''}`} onClick={() => setKey('hidden', !entry.hidden || undefined)} title={entry.hidden ? 'Hidden: click to show' : 'Hide without deleting'} data-testid="toggle-hidden">
            {entry.hidden ? <EyeOff size={14} /> : <Eye size={14} />} {entry.hidden ? 'Hidden' : 'Visible'}
          </button>
          <button class={`btn sm${entry.disabled ? ' primary' : ''}`} onClick={() => setKey('disabled', !entry.disabled || undefined)} title="Disabled entries are greyed out and their state checks pause" data-testid="toggle-disabled">
            <Ban size={14} /> {entry.disabled ? 'Disabled' : 'Enabled'}
          </button>
          <button class="btn sm icon" onClick={duplicate} title="Duplicate" data-testid="duplicate-entry">
            <Copy size={14} />
          </button>
          <button class="btn sm icon danger" onClick={remove} title="Delete" data-testid="delete-entry">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <div class="issues">
          <b>Fix before saving</b>
          <ul>
            {issues.map((i) => (
              <li>
                <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card
        title="Click"
        icon={<MousePointerClick size={16} />}
        desc={entry.state ? 'Runs while OFF (turns it on)' : isTray ? 'Without an action, a click opens the menu' : 'Runs when the menu item is clicked'}
        actions={entry.action !== undefined ? <button class="btn sm ghost" onClick={() => setKey('action', undefined)}>Remove</button> : <AddActionButton label="Add action" onClick={() => setKey('action', { run: '' } as never)} testId="add-action" />}
        testId="card-click"
      >
        {entry.action !== undefined && <ActionEditor value={entry.action} onChange={(v) => setKey('action', v as never)} testId="action" scope={scope} />}
      </Card>

      <Card
        title="On / Off state"
        icon={<ToggleRight size={16} />}
        desc="Turns the entry into a toggle with a live state"
        actions={<Switch checked={!!entry.state} onChange={(v) => setKey('state', v ? ({ check: '', interval: 60 } as never) : undefined)} testId="toggle-state" />}
        testId="card-state"
      >
        {entry.state && <StateEditor value={entry.state} onChange={(s) => setKey('state', s as never)} />}
      </Card>

      {entry.state && (
        <Card
          title="Turn off"
          icon={<Power size={16} />}
          desc="Runs on click while ON"
          actions={entry.offAction !== undefined ? <button class="btn sm ghost" onClick={() => setKey('offAction', undefined)}>Remove</button> : <AddActionButton label="Add turn-off action" onClick={() => setKey('offAction', { run: '' } as never)} testId="add-off-action" />}
        >
          {entry.offAction !== undefined && <ActionEditor value={entry.offAction} onChange={(v) => setKey('offAction', v as never)} testId="off-action" scope={scope} />}
        </Card>
      )}

      {isTray && (
        <Card
          title="Right click"
          icon={<MousePointer2 size={16} />}
          desc="Without an action, right click opens the menu"
          actions={tray.rightAction !== undefined ? <button class="btn sm ghost" onClick={() => setKey('rightAction', undefined)}>Remove</button> : <AddActionButton label="Add action" onClick={() => setKey('rightAction', { run: '' } as never)} />}
        >
          {tray.rightAction !== undefined && <ActionEditor value={tray.rightAction} onChange={(v) => setKey('rightAction', v as never)} testId="right-action" scope={scope} />}
        </Card>
      )}

      <Card
        title="Keyboard shortcut"
        icon={<Keyboard size={16} />}
        desc={entry.action ? 'Works from any application, like a click' : entry.menu?.length ? 'Opens the launcher on this menu' : 'Add an action or a menu first'}
        actions={
          <HotkeyInput
            value={entry.hotkey}
            onChange={(v) =>
              set((e) => {
                if (v) e.hotkey = v;
                else {
                  delete e.hotkey;
                  delete e.hotkeyConfirm; // asked only by the shortcut
                }
              })
            }
            statusPath={statusKey(path)}
            testId="entry-hotkey"
          />
        }
        testId="card-hotkey"
      >
        {entry.hotkey && (entry.action || entry.hotkeyConfirm) && <HotkeyConfirmEditor entry={entry} setKey={setKey} />}
      </Card>

      <Card
        title="Schedule"
        icon={<CalendarClock size={16} />}
        desc={scheduleCardText(st, schedulesPaused.value, !!entry.schedules?.length, (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
        testId="card-schedule"
      >
        <SchedulesEditor
          value={entry.schedules}
          onChange={(v) => setKey('schedules', v as never)}
          watches={st?.watches}
          entries={otherIds}
          entryLabel={entry.label}
          isToggle={!!entry.state}
          hasOff={entry.offAction !== undefined}
          hasRight={isTray && tray.rightAction !== undefined}
          action={normalizeAction(entry.action)}
        />
      </Card>

      <Card title={isTray ? 'Menu' : 'Sub menu'} icon={<ListTree size={16} />} desc={`${(entry.menu ?? []).length} ${(entry.menu ?? []).length === 1 ? 'entry' : 'entries'}`} testId="card-menu">
        <MenuEditor path={path} />
      </Card>

      <Card title="Enabled when" icon={<Link2 size={16} />} desc="Follow the state of another toggle">
        <div class="card-body">
          <div class="grid2">
            <Field label="Enabled only while">
              <select
                class="select"
                value={entry.enabledWhen ?? ''}
                onChange={(e) => setKey('enabledWhen', ((e.currentTarget as HTMLSelectElement).value || undefined) as never)}
              >
                <option value="">Always</option>
                {otherIds.map((x) => (
                  <>
                    <option value={x.id}>{x.label} is ON</option>
                    <option value={`!${x.id}`}>{x.label} is OFF</option>
                  </>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

export type { MenuEntry };
