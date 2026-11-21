import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronRight, CircleAlert, CornerDownLeft, EyeOff, FolderOpen, Loader2, RectangleEllipsis, Terminal, X } from 'lucide-preact';
import './launcher.css';
import type { LauncherItem, LauncherShow, PromptField, PromptRequest } from '../shared/api';
import { fuzzyMatch } from '../shared/fuzzy';
import { Keys } from './components/keys';

const api = window.traycommand.launcher;
const MAX_RESULTS = 60;
const RECENT = 5;

type Row = { item: LauncherItem; highlight: number[]; section?: string };

/** Key of the menu an entry belongs to ("trays[0].menu[2]" → "trays[0]"). */
const parentKey = (key: string) => key.replace(/\.menu\[\d+\]$/, '') === key ? undefined : key.replace(/\.menu\[\d+\]$/, '');

function Highlight(props: { text: string; marks: number[] }) {
  if (!props.marks.length) return <>{props.text}</>;
  const set = new Set(props.marks);
  const out: preact.JSX.Element[] = [];
  let buf = '';
  let marked = false;
  const flush = () => {
    if (buf) out.push(marked ? <mark>{buf}</mark> : <>{buf}</>);
    buf = '';
  };
  [...props.text].forEach((ch, i) => {
    const m = set.has(i);
    if (m !== marked) {
      flush();
      marked = m;
    }
    buf += ch;
  });
  flush();
  return <>{out}</>;
}

function ItemIcon(props: { item: LauncherItem }) {
  const it = props.item;
  return <span class={`lx-icon${it.toggle && it.on === false ? ' off' : ''}`}>{it.icon ? <img src={it.icon} alt="" /> : <Terminal size={16} />}</span>;
}

function actionLabel(item: LauncherItem) {
  if (!item.kind) return item.group ? 'Open' : '';
  if (item.toggle) return item.kind === 'off' ? 'Turn off' : 'Turn on';
  return item.hasInputs ? 'Run…' : 'Run';
}

/* ---------------- list ---------------- */

function List(props: {
  data: LauncherShow;
  scope?: string;
  setScope: (key: string | undefined) => void;
  query: string;
  setQuery: (q: string) => void;
  hidden: boolean;
}) {
  const { data, scope, query } = props;
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Hover selects only after the mouse really moved: opening under a still pointer must not change the selection. */
  const mouseMoved = useRef(false);
  const mouseAt = useRef<string>();
  const platform = data.platform;

  const scopeItem = scope ? data.items.find((i) => i.key === scope) : undefined;
  const scopeLabel = scopeItem?.label ?? (scope === data.scope ? data.scopeLabel : undefined);
  const scopePath = scopeItem ? (scopeItem.path ? `${scopeItem.path} › ${scopeItem.label}` : scopeItem.label) : undefined;
  /** Path of an item below the current menu ("Docker › Compose" → "Compose" inside "Docker"). */
  const relPath = (item: LauncherItem) => (scopePath && item.path.startsWith(scopePath) ? item.path.slice(scopePath.length).replace(/^ › /, '') : item.path);

  const rows: Row[] = useMemo(() => {
    const inScope = scope ? data.items.filter((i) => i.key.startsWith(`${scope}.`)) : data.items;
    const q = query.trim();
    if (!q) {
      if (scope) return inScope.filter((i) => parentKey(i.key) === scope).map((item) => ({ item, highlight: [] }));
      const recent = [...inScope].filter((i) => i.recent !== undefined && i.kind).sort((a, b) => b.recent! - a.recent!).slice(0, RECENT);
      const rest = inScope.map((item) => ({ item, highlight: [] as number[], section: undefined as string | undefined }));
      if (!recent.length) return rest;
      if (rest[0]) rest[0].section = 'All commands';
      return [...recent.map((item, i) => ({ item, highlight: [], section: i === 0 ? 'Recent' : undefined })), ...rest];
    }
    const scored: (Row & { score: number })[] = [];
    for (const item of inScope) {
      const m = fuzzyMatch(q, item.label, relPath(item));
      if (m) scored.push({ item, highlight: m.label, score: m.score + (item.recent ?? 0) * 0.3 + (item.kind ? 1 : 0) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }, [data, scope, query]);

  useEffect(() => setSelected(0), [query, scope, data]);
  useEffect(() => {
    mouseMoved.current = false;
    mouseAt.current = undefined;
  }, [data]);
  useEffect(() => {
    if (!props.hidden) input.current?.focus();
  }, [data, scope, props.hidden]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, rows]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(undefined), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const current = rows[selected]?.item;

  const run = async (item: LauncherItem | undefined, alternate = false) => {
    if (!item) return;
    if (!alternate && !item.kind) {
      if (item.group) enter(item);
      return;
    }
    const r = await api.run(item.key, alternate);
    if (!r.ok) setMessage(r.message ?? 'Cannot run it');
  };

  const enter = (item: LauncherItem | undefined) => {
    if (!item?.group) return false;
    props.setScope(item.key);
    props.setQuery('');
    return true;
  };

  const leave = () => {
    if (!scope) return false;
    const up = parentKey(scope);
    props.setScope(up && data.items.some((i) => i.key === up) ? up : undefined);
    return true;
  };

  const onKey = (e: KeyboardEvent) => {
    const move = (to: number) => {
      e.preventDefault();
      if (!rows.length) return;
      setSelected((to + rows.length) % rows.length);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(selected + 1);
      case 'ArrowUp':
        return move(selected - 1);
      case 'PageDown':
        return move(Math.min(rows.length - 1, selected + 7));
      case 'PageUp':
        return move(Math.max(0, selected - 7));
      case 'Enter':
        e.preventDefault();
        return void run(current, e.shiftKey);
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) leave();
        else enter(current);
        return;
      case 'ArrowRight': {
        const el = e.currentTarget as HTMLInputElement;
        if (el.selectionStart === el.value.length && current?.group) {
          e.preventDefault();
          enter(current);
        }
        return;
      }
      case 'ArrowLeft': {
        const el = e.currentTarget as HTMLInputElement;
        if (el.selectionStart === 0 && el.selectionEnd === 0 && scope) {
          e.preventDefault();
          leave();
        }
        return;
      }
      case 'Backspace':
        if (!query && scope) {
          e.preventDefault();
          leave();
        }
        return;
      case 'Escape':
        e.preventDefault();
        if (query) props.setQuery('');
        else if (scope && scope !== data.scope) leave();
        else api.close();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && current) {
      e.preventDefault();
      api.edit(current.key);
    }
  };

  return (
    <div class="lx" data-testid="launcher-list" style={props.hidden ? { display: 'none' } : undefined}>
      <div class="lx-search">
        <span class="lx-ps1" aria-hidden="true">
          tc<span class="lx-ps1-sep">:~$</span>
        </span>
        {scopeLabel && (
          <span class="lx-scope" title="Backspace to search everywhere">
            {scopeLabel}
            <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => props.setScope(undefined)} aria-label="Search everywhere">
              <X size={12} />
            </button>
          </span>
        )}
        <span class="lx-line">
          <input
            ref={input}
            value={query}
            placeholder={scopeLabel ? `Search in ${scopeLabel}` : 'Search commands'}
            spellcheck={false}
            autoComplete="off"
            onInput={(e) => props.setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKey}
            data-testid="launcher-input"
            aria-activedescendant={current ? `lx-${selected}` : undefined}
            aria-controls="lx-list"
          />
          <span class="lx-mirror" aria-hidden="true">
            {query}
            <i class="lx-caret" />
          </span>
        </span>
        {data.hotkey && <Keys hotkey={data.hotkey} platform={platform} small />}
      </div>
      <div class="lx-list" id="lx-list" role="listbox" ref={listRef} onMouseMove={(e) => {
          const at = `${e.screenX},${e.screenY}`;
          if (mouseAt.current !== undefined && mouseAt.current !== at) mouseMoved.current = true;
          mouseAt.current = at;
        }}>
        {rows.map((row, i) => {
          const it = row.item;
          return (
            <>
              {row.section && <div class="lx-section">{row.section}</div>}
              <div
                id={`lx-${i}`}
                role="option"
                aria-selected={i === selected}
                data-index={i}
                data-testid="launcher-item"
                class={`lx-row${i === selected ? ' selected' : ''}${it.enabled || it.group ? '' : ' unavailable'}`}
                onMouseEnter={() => mouseMoved.current && setSelected(i)}
                onMouseMove={() => mouseMoved.current && i !== selected && setSelected(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => void run(it, e.shiftKey)}
              >
                <ItemIcon item={it} />
                <span class="lx-text">
                  <span class="lx-label">
                    <Highlight text={it.label} marks={row.highlight} />
                  </span>
                  {relPath(it) && <span class="lx-path">{relPath(it)}</span>}
                </span>
                <span class="lx-meta">
                  {it.hidden && (
                    <span class="lx-tag" title="Hidden from the tray">
                      <EyeOff size={12} />
                    </span>
                  )}
                  {it.busy && <Loader2 size={14} class="spin" />}
                  {it.toggle && it.on !== undefined && <span class={`lx-state ${it.on ? 'on' : 'off'}`}>{it.on ? 'ON' : 'OFF'}</span>}
                  {it.hasInputs && (
                    <span class="lx-tag" title="Asks for values">
                      <RectangleEllipsis size={14} />
                    </span>
                  )}
                  {it.hotkey && <Keys hotkey={it.hotkey} platform={platform} small />}
                  {i === selected ? (
                    <span class="lx-go">
                      {actionLabel(it)} {it.kind ? <CornerDownLeft size={13} /> : it.group ? <ChevronRight size={14} /> : null}
                    </span>
                  ) : (
                    it.group && <ChevronRight size={14} class="lx-chev" />
                  )}
                </span>
              </div>
            </>
          );
        })}
        {!rows.length && (
          <div class="lx-empty">
            {query ? (
              <>
                No command matches “{query}”{scope && <div class="lx-hint">Press Backspace twice to search everywhere</div>}
              </>
            ) : (
              'No commands yet: add some in TrayCommand'
            )}
          </div>
        )}
      </div>
      {message && (
        <div class="lx-message" role="alert">
          <CircleAlert size={14} /> {message}
        </div>
      )}
      <div class="lx-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> run
        </span>
        {current?.alternate && (
          <span>
            <kbd>⇧</kbd>
            <kbd>↵</kbd> right click
          </span>
        )}
        {current?.group && (
          <span>
            <kbd>Tab</kbd> open menu
          </span>
        )}
        {scope && (
          <span>
            <kbd>⌫</kbd> back
          </span>
        )}
        <span class="lx-spacer" />
        <span>
          <kbd>{platform === 'darwin' ? '⌘' : 'Ctrl'}</kbd>
          <kbd>E</kbd> edit
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

/* ---------------- form ---------------- */

function validate(field: PromptField, value: string): string | undefined {
  if (field.type === 'checkbox') return undefined;
  if (value === '') return field.optional ? undefined : 'Required';
  if (field.type === 'number' && !Number.isFinite(Number(value))) return 'Enter a number';
  if (field.pattern) {
    try {
      if (!new RegExp(`^(?:${field.pattern})$`).test(value)) return 'Not in the expected format';
    } catch {
      /* invalid pattern: already reported by the validator */
    }
  }
  return undefined;
}

function SelectField(props: { field: PromptField; value: string; onChange: (v: string) => void; promptId: number; refocus: () => void; testId: string }) {
  const { field } = props;
  const [options, setOptions] = useState(field.options ?? []);
  const [loading, setLoading] = useState(!!field.dynamic);
  const [error, setError] = useState<string>();
  const load = () => {
    setLoading(true);
    setError(undefined);
    void api.options(props.promptId, field.name).then((r) => {
      setLoading(false);
      if (r.error) setError(r.error);
      const list = (r.options ?? []).map((o) => ({ value: o, label: o }));
      setOptions(list);
      if (list.length && !list.some((o) => o.value === props.value)) props.onChange(list[0]!.value);
    });
  };
  useEffect(() => {
    if (field.dynamic) load();
    else if (options.length && !options.some((o) => o.value === props.value)) props.onChange(options[0]!.value);
  }, [props.promptId, field.name]);
  if (loading)
    return (
      <div class="lx-input lx-loading">
        <Loader2 size={14} class="spin" /> Loading choices…
      </div>
    );
  return (
    <>
      <select class="lx-input" value={props.value} onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)} data-testid={props.testId} data-field={field.name}>
        {options.map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && (
        <div class="lx-field-error">
          {error}{' '}
          <button class="lx-link" onClick={load}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function Form(props: { request: PromptRequest & { fromList: boolean }; platform: string }) {
  const r = props.request;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(r.fields.map((f) => [f.name, f.value])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const focusFirst = () => {
    const el = root.current?.querySelector<HTMLElement>('[data-field]');
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useLayoutEffect(() => {
    focusFirst();
  }, [r.id]);

  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (submitted) setErrors((e) => {
      const field = r.fields.find((f) => f.name === name)!;
      const next = { ...e };
      const problem = validate(field, value);
      if (problem) next[name] = problem;
      else delete next[name];
      return next;
    });
  };

  const submit = () => {
    setSubmitted(true);
    const problems: Record<string, string> = {};
    for (const f of r.fields) {
      const p = validate(f, values[f.name] ?? '');
      if (p) problems[f.name] = p;
    }
    setErrors(problems);
    const first = r.fields.find((f) => problems[f.name]);
    if (first) {
      root.current?.querySelector<HTMLElement>(`[data-field="${first.name}"]`)?.focus();
      return;
    }
    api.submit(r.id, values);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.cancel(r.id, r.fromList);
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement && e.altKey)) {
      e.preventDefault();
      submit();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      const el = e.target as HTMLElement;
      const field = r.fields.find((f) => f.name === el.dataset.field);
      if (field && (field.type === 'file' || field.type === 'folder')) {
        e.preventDefault();
        void browse(field);
      }
    }
  };

  const browse = async (field: PromptField) => {
    const picked = await api.pick(field.type as 'file' | 'folder', values[field.name] ?? '');
    if (picked !== undefined) set(field.name, picked);
    root.current?.querySelector<HTMLElement>(`[data-field="${field.name}"]`)?.focus();
  };

  return (
    <div class="lx lx-form" ref={root} onKeyDown={onKey} data-testid="launcher-form">
      <div class="lx-head">
        <span class="lx-icon">{r.icon ? <img src={r.icon} alt="" /> : <Terminal size={16} />}</span>
        <span class="lx-text">
          <span class="lx-title">{r.title}</span>
          {r.subtitle && <span class="lx-path">{r.subtitle}</span>}
        </span>
        <button class="lx-close" tabIndex={-1} onClick={() => api.cancel(r.id, false)} aria-label="Cancel">
          <X size={16} />
        </button>
      </div>
      <div class="lx-fields">
        {r.fields.map((f, i) => {
          const value = values[f.name] ?? '';
          const testId = `launcher-field-${f.name}`;
          const err = errors[f.name];
          return (
            <div class={`lx-field${err ? ' invalid' : ''}`}>
              {f.type === 'checkbox' ? (
                <label class="lx-check">
                  <input type="checkbox" checked={value === 'true'} onChange={(e) => set(f.name, (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')} data-field={f.name} data-testid={testId} />
                  <span class="lx-track" />
                  {f.label}
                </label>
              ) : (
                <>
                  <label for={`f-${i}`}>
                    {f.label}
                    {f.optional && <span class="lx-optional">optional</span>}
                  </label>
                  {f.type === 'select' ? (
                    <SelectField field={f} value={value} onChange={(v) => set(f.name, v)} promptId={r.id} refocus={focusFirst} testId={testId} />
                  ) : (
                    <div class="lx-input-row">
                      <input
                        id={`f-${i}`}
                        class="lx-input"
                        type={f.type === 'password' ? 'password' : 'text'}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        value={value}
                        placeholder={f.placeholder}
                        spellcheck={false}
                        autoComplete="off"
                        onInput={(e) => set(f.name, (e.currentTarget as HTMLInputElement).value)}
                        data-field={f.name}
                        data-testid={testId}
                      />
                      {(f.type === 'file' || f.type === 'folder') && (
                        <button class="lx-btn" onClick={() => void browse(f)} title={`Browse (${props.platform === 'darwin' ? '⌘' : 'Ctrl'}+O)`}>
                          <FolderOpen size={14} /> Browse
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {err && <div class="lx-field-error">{err}</div>}
            </div>
          );
        })}
      </div>
      <div class="lx-foot">
        <span>
          <kbd>Tab</kbd> next field
        </span>
        <span>
          <kbd>Esc</kbd> {r.fromList ? 'back' : 'cancel'}
        </span>
        <span class="lx-spacer" />
        <button class="lx-btn primary" onClick={submit} data-testid="launcher-submit">
          {r.submitLabel} <CornerDownLeft size={13} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- root ---------------- */

function Launcher() {
  const [data, setData] = useState<LauncherShow>({ items: [], platform: 'win32' });
  const [scope, setScope] = useState<string>();
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState<PromptRequest & { fromList: boolean }>();
  const root = useRef<HTMLDivElement>(null);
  const anim = useRef<HTMLDivElement>(null);
  const inPrompt = useRef(false);
  inPrompt.current = !!prompt;
  const focusSearch = () => (document.querySelector('[data-testid="launcher-input"]') as HTMLInputElement | null)?.focus();

  useEffect(() => {
    const offs = [
      api.onShow((d) => {
        setPrompt(undefined);
        setQuery('');
        setScope(d.scope);
        setData(d);
        // the search field is always mounted: focus it at once, so that no key typed right after the shortcut is lost
        focusSearch();
        const el = anim.current;
        if (el) {
          el.classList.remove('lx-anim');
          void el.offsetWidth;
          el.classList.add('lx-anim');
        }
      }),
      api.onPrompt((p) => setPrompt(p)),
      api.onBack(() => {
        setPrompt(undefined);
        requestAnimationFrame(focusSearch);
      }),
      api.onHide(() => {
        // reset now, so that the next opening never shows the old content for a frame
        setPrompt(undefined);
        setQuery('');
        setScope(undefined);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // the window follows the height of the content
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => api.resize(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFocus = () => !inPrompt.current && focusSearch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <div class="lx-root" ref={root}>
      <div class="lx-anim" ref={anim}>
        {prompt && <Form request={prompt} platform={data.platform} key={prompt.id} />}
        <List data={data} scope={scope} setScope={setScope} query={query} setQuery={setQuery} hidden={!!prompt} />
      </div>
    </div>
  );
}

render(<Launcher />, document.getElementById('launcher')!);
