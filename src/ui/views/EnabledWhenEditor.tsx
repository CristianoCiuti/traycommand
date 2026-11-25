import { Plus, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { describeEnabled, enabledGroup, type EnabledGroup, type EnabledWhen } from '../../shared/config';

type Toggle = { id: string; label: string; toggle: boolean };
type Group = { kind: EnabledGroup; items: EnabledWhen[] };

/** Groups can hold groups; past this depth the editor offers only toggles (the file can go deeper). */
const MAX_DEPTH = 2;

const makeGroup = (g: Group): EnabledWhen => (g.kind === 'all' ? { all: g.items } : { any: g.items });

/**
 * The shortest form of the whole condition: nothing when empty, the toggle alone when it is the only one,
 * a group otherwise.
 */
export function compactEnabled(g: Group): EnabledWhen | undefined {
  if (!g.items.length) return undefined;
  if (g.items.length === 1 && typeof g.items[0] === 'string') return g.items[0];
  return makeGroup(g);
}

/** The condition as a group to edit: a single toggle becomes a group of one. */
export const rootGroup = (cond: EnabledWhen | undefined, kind: EnabledGroup = 'all'): Group =>
  cond === undefined ? { kind, items: [] } : (enabledGroup(cond) ?? { kind, items: [cond] });

/** "Server is ON" as a chip: the toggle, ON or OFF, and a button that removes it. */
function ToggleChip(props: { cond: string; toggles: Toggle[]; onChange: (c: string) => void; onRemove: () => void; testId: string }) {
  const off = props.cond.startsWith('!');
  const id = off ? props.cond.slice(1) : props.cond;
  const label = props.toggles.find((t) => t.id === id)?.label;
  return (
    <span class={`chip${label ? '' : ' invalid'}`} data-testid={props.testId} title={label ? id : `No toggle with id ${id}`}>
      {label ?? id}
      <select value={off ? 'off' : 'on'} onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value === 'off' ? `!${id}` : id)} aria-label="State" data-testid={`${props.testId}-state`}>
        <option value="on">is ON</option>
        <option value="off">is OFF</option>
      </select>
      <button onClick={props.onRemove} aria-label="Remove" data-testid={`${props.testId}-remove`}>
        <X size={12} />
      </button>
    </span>
  );
}

/** A group of conditions: all of them (and) or any of them (or), each a toggle or another group. */
function GroupEditor(props: { group: Group; toggles: Toggle[]; depth: number; onChange: (g: Group | undefined) => void; testId: string }) {
  const { kind, items } = props.group;
  const set = (next: EnabledWhen[]) => props.onChange(next.length ? { kind, items: next } : undefined);
  const word = kind === 'all' ? 'and' : 'or';
  return (
    <div class={`cond-group${props.depth ? ' nested' : ''}`} data-testid={props.testId}>
      <div class="cond-head">
        <span class="days" role="group" aria-label="Combine" data-testid={`${props.testId}-kind`}>
          {(['all', 'any'] as const).map((k) => (
            <button class={`day${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => props.onChange({ kind: k, items })} data-testid={`${props.testId}-${k}`}>
              {k === 'all' ? 'All (and)' : 'Any (or)'}
            </button>
          ))}
        </span>
        <span class="hint">{kind === 'all' ? 'of these must be true' : 'of these is enough'}</span>
        {props.depth > 0 && (
          <button class="btn ghost sm icon danger" style={{ marginLeft: 'auto' }} onClick={() => props.onChange(undefined)} aria-label="Remove group" data-testid={`${props.testId}-remove`}>
            <X size={14} />
          </button>
        )}
      </div>
      <div class="cond-items">
        {items.map((item, i) => {
          const tid = `${props.testId}-${i}`;
          const sub = enabledGroup(item);
          const replace = (v: EnabledWhen | undefined) => set(v === undefined ? items.filter((_, j) => j !== i) : items.map((x, j) => (j === i ? v : x)));
          return (
            <div class="cond-item">
              <span class="cond-word">{i === 0 ? '' : word}</span>
              {sub ? (
                <GroupEditor group={sub} toggles={props.toggles} depth={props.depth + 1} onChange={(g) => replace(g && compactNested(g))} testId={tid} />
              ) : (
                <ToggleChip cond={item as string} toggles={props.toggles} onChange={replace} onRemove={() => replace(undefined)} testId={tid} />
              )}
            </div>
          );
        })}
        <div class="cond-item">
          <span class="cond-word">{items.length ? word : ''}</span>
          <span class="chips">
            <select
              class="select"
              style={{ width: 'auto', minWidth: 136, height: 26, padding: '0 28px 0 8px', fontSize: 12 }}
              value=""
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                if (v) set([...items, v]);
                (e.currentTarget as HTMLSelectElement).value = '';
              }}
              aria-label="Add a toggle"
              data-testid={`${props.testId}-add`}
            >
              <option value="">+ add toggle…</option>
              {props.toggles.filter((t) => t.toggle).map((t) => (
                <option value={t.id}>
                  {t.label} ({t.id})
                </option>
              ))}
            </select>
            {props.depth < MAX_DEPTH && (
              <button class="btn sm" style={{ height: 26, fontSize: 12 }} onClick={() => set([...items, kind === 'all' ? { any: [] } : { all: [] }])} data-testid={`${props.testId}-add-group`}>
                <Plus size={13} /> {kind === 'all' ? 'Group of "or"' : 'Group of "and"'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A nested group keeps its form while it is edited (an empty new group stays until something is added). */
const compactNested = (g: Group): EnabledWhen => makeGroup(g);

/** The whole "Enabled when" editor: a group of toggles and groups, with the result in words. */
export function EnabledWhenEditor(props: { value: EnabledWhen | undefined; toggles: Toggle[]; onChange: (v: EnabledWhen | undefined) => void }) {
  // the choice between all and any, kept while there is nothing or a single toggle to combine
  const [kind, setKind] = useState<EnabledGroup>('all');
  const root = rootGroup(props.value, kind);
  const label = (id: string) => props.toggles.find((t) => t.id === id)?.label ?? id;
  return (
    <div class="cond-editor" data-testid="enabled-when">
      <GroupEditor
        group={root}
        toggles={props.toggles}
        depth={0}
        onChange={(g) => {
          if (g) setKind(g.kind);
          props.onChange(g && compactEnabled(g));
        }}
        testId="enabled-when-root"
      />
      <div class="cond-summary" data-testid="enabled-when-summary">
        {props.value === undefined ? (
          'Always clickable. Add the toggles it depends on.'
        ) : (
          <>
            Clickable only while <b>{describeEnabled(props.value, label)}</b>.
          </>
        )}
      </div>
    </div>
  );
}
