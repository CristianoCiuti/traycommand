import { ArrowDown, ArrowUp, ChevronRight, Copy, Eye, EyeOff, FolderPlus, Minus, Plus, Trash2, ToggleRight } from 'lucide-preact';
import { type MenuEntry, type MenuNode, isSeparator } from '../../shared/config';
import { draft, entryAt, mutate, selection, status, statusKey, uniqueId } from '../store';
import { EntryIcon } from '../components/ui';

function describe(e: MenuEntry): string {
  const parts: string[] = [];
  const run = typeof e.action === 'string' ? e.action : e.action?.run;
  if (e.menu?.length) parts.push(`${e.menu.length} items`);
  if (run) parts.push(run.split('\n')[0]!);
  return parts.join(' · ');
}

function Rows(props: { path: number[]; nodes: MenuNode[] }) {
  const move = (i: number, delta: number) =>
    mutate((c) => {
      const list = entryAt(c, props.path)!.menu!;
      const j = i + delta;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
    });
  const remove = (i: number) => mutate((c) => entryAt(c, props.path)!.menu!.splice(i, 1));
  const duplicate = (i: number) =>
    mutate((c) => {
      const list = entryAt(c, props.path)!.menu!;
      const copy = structuredClone(list[i]!) as MenuEntry;
      const strip = (n: MenuNode) => {
        if (isSeparator(n)) return;
        if (n.id) n.id = uniqueId(c, n.id);
        n.menu?.forEach(strip);
      };
      strip(copy);
      if (!isSeparator(copy)) copy.label = `${copy.label} (copy)`;
      list.splice(i + 1, 0, copy);
    });

  return (
    <div class="menu-tree">
      {props.nodes.map((node, i) => {
        const childPath = [...props.path, i];
        const acts = (
          <div class="acts">
            <button class="btn ghost sm icon" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
              <ArrowUp size={14} />
            </button>
            <button class="btn ghost sm icon" onClick={() => move(i, 1)} disabled={i === props.nodes.length - 1} title="Move down">
              <ArrowDown size={14} />
            </button>
            {!isSeparator(node) && (
              <>
                <button class="btn ghost sm icon" onClick={() => mutate((c) => { const e = entryAt(c, childPath)!; if (e.hidden) delete e.hidden; else e.hidden = true; })} title={node.hidden ? 'Show' : 'Hide'}>
                  {node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button class="btn ghost sm icon" onClick={() => duplicate(i)} title="Duplicate">
                  <Copy size={14} />
                </button>
              </>
            )}
            <button class="btn ghost sm icon danger" onClick={() => remove(i)} title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        );
        if (isSeparator(node))
          return (
            <div class="menu-sep-row">
              <div class="menu-sep" />
              {acts}
            </div>
          );
        const st = status.value.get(statusKey(childPath));
        return (
          <>
            <div class="menu-row" style={node.hidden || node.disabled ? { opacity: 0.5 } : undefined} data-testid="menu-row">
              <span class="ico">
                <EntryIcon path={node.icon} size={16} fallback={node.state ? <ToggleRight size={15} /> : node.menu ? <ChevronRight size={15} /> : <span class="dot" style={{ width: 5, height: 5 }} />} />
              </span>
              <span class="name" onClick={() => (selection.value = childPath)} title="Edit">
                <span class="t">{node.label || '(no label)'}</span>
                {st?.on !== undefined && <span class={`pill ${st.on ? 'on' : 'off'}`}>{st.on ? 'ON' : 'OFF'}</span>}
                {node.hidden && <span class="pill muted">hidden</span>}
                <span class="meta">{describe(node)}</span>
              </span>
              {acts}
            </div>
            {node.menu && node.menu.length > 0 && (
              <div class="menu-children">
                <Rows path={childPath} nodes={node.menu} />
              </div>
            )}
          </>
        );
      })}
    </div>
  );
}

export function MenuEditor(props: { path: number[] }) {
  const entry = entryAt(draft.value, props.path);
  const nodes = entry?.menu ?? [];
  const add = (node: MenuNode, open: boolean) => {
    mutate((c) => {
      const e = entryAt(c, props.path)!;
      e.menu = [...(e.menu ?? []), node];
    });
    if (open) selection.value = [...props.path, nodes.length];
  };
  return (
    <div class="card-body">
      {nodes.length ? <Rows path={props.path} nodes={nodes} /> : <div class="hint">No entries yet.</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button class="btn sm" onClick={() => add({ label: 'New item', action: { run: '' } }, true)} data-testid="add-item">
          <Plus size={14} /> Item
        </button>
        <button class="btn sm" onClick={() => add({ label: 'New sub menu', menu: [] }, true)}>
          <FolderPlus size={14} /> Sub menu
        </button>
        <button class="btn sm" onClick={() => add({ separator: true }, false)}>
          <Minus size={14} /> Separator
        </button>
      </div>
    </div>
  );
}
