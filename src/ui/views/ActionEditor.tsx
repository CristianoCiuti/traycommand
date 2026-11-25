import { useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, CirclePlay, Loader2, Plus, ShieldAlert, Trash2, X } from 'lucide-preact';
import { afterParts, confirmTexts, type Action, type ActionInput, type AfterRef, type AfterWhen, type Shell } from '../../shared/config';
import type { TestResult } from '../../shared/api';
import { allIds, api, draft } from '../store';
import { Field, Switch, TextArea, formatDuration } from '../components/ui';
import { InputsEditor } from './InputsEditor';
import { VarField, type VarScope } from '../components/VarField';

export function toAction(input: ActionInput | undefined): Action | undefined {
  if (input === undefined) return undefined;
  return typeof input === 'string' ? { run: input } : input;
}

/** Stores the shorthand string form when only `run` is set. */
export function fromAction(action: Action): ActionInput {
  const keys = Object.entries(action).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  return keys.length === 1 && keys[0]![0] === 'run' ? action.run : (Object.fromEntries(keys) as Action);
}

const SHELLS: { value: string; label: string }[] = [
  { value: '', label: 'Default shell' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'pwsh', label: 'PowerShell 7 (pwsh)' },
  { value: 'cmd', label: 'Command Prompt (cmd)' },
  { value: 'bash', label: 'bash' },
  { value: 'zsh', label: 'zsh' },
  { value: 'sh', label: 'sh' },
];

export function ShellSelect(props: { value?: Shell; onChange: (s: Shell | undefined) => void; allowDefault?: boolean }) {
  const custom = typeof props.value === 'object';
  return (
    <select
      class="select"
      value={custom ? '__custom' : ((props.value as string | undefined) ?? '')}
      onChange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        props.onChange(v === '' ? undefined : v === '__custom' ? { command: 'node', args: ['-e'] } : (v as Shell));
      }}
    >
      {SHELLS.filter((s) => props.allowDefault !== false || s.value).map((s) => (
        <option value={s.value}>{s.label}</option>
      ))}
      <option value="__custom">Custom…</option>
    </select>
  );
}

export function TestOutput(props: { result?: TestResult; running: boolean; checkMode?: boolean }) {
  const r = props.result;
  if (props.running)
    return (
      <div class="output">
        <div class="output-head">
          <Loader2 size={14} class="spin" /> Running…
        </div>
      </div>
    );
  if (!r) return null;
  const ok = r.code === 0 && !r.timedOut && !r.error;
  return (
    <div class="output" data-testid="test-output">
      <div class="output-head">
        <span class={`pill ${ok ? 'on' : 'danger'}`}>{r.error ? 'Error' : r.timedOut ? 'Timed out' : `Exit ${r.code}`}</span>
        {props.checkMode && r.on !== undefined && <span class={`pill ${r.on ? 'on' : 'off'}`}>State: {r.on ? 'ON' : 'OFF'}</span>}
        <span>{formatDuration(r.durationMs)}</span>
      </div>
      {(r.stdout || (!r.stderr && !r.error)) && <pre>{r.stdout || '(no output)'}</pre>}
      {(r.stderr || r.error) && <pre class="err">{[r.error, r.stderr].filter(Boolean).join('\n')}</pre>}
    </div>
  );
}

/** One entry to run (e.g. when a notification is clicked): "id" = what a click on it does, or "id:on" / "id:off" / "id:right". */
function ClickRef(props: { label: string; hint: string; none: string; value: string | undefined; onChange: (ref: string | undefined) => void; testId?: string }) {
  const ids = allIds(draft.value);
  const [id, kind] = (props.value ?? '').split(':');
  const known = !id || ids.some((x) => x.id === id);
  return (
    <Field label={props.label} hint={props.hint}>
      <div class="row" style={{ gap: 6 }}>
        <select
          class="select"
          value={id ?? ''}
          data-testid={props.testId}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            props.onChange(v ? (kind ? `${v}:${kind}` : v) : undefined);
          }}
        >
          <option value="">{props.none}</option>
          {!known && <option value={id}>{id} (missing)</option>}
          {ids.map((x) => (
            <option value={x.id}>
              {x.label} ({x.id})
            </option>
          ))}
        </select>
        {id && (
          <select
            class="select"
            style={{ width: 'auto' }}
            value={kind ?? ''}
            onChange={(e) => {
              const k = (e.currentTarget as HTMLSelectElement).value;
              props.onChange(k ? `${id}:${k}` : id);
            }}
          >
            <option value="">its click</option>
            <option value="on">on</option>
            <option value="off">off</option>
            <option value="right">right click</option>
          </select>
        )}
      </div>
    </Field>
  );
}

type Notify = Action['notify'];
const notifyText = (n: Notify): string | true | undefined => (n === undefined || n === false ? undefined : n === true ? true : typeof n === 'string' ? n : (n.text ?? true));
const notifyClick = (n: Notify) => (typeof n === 'object' ? n.click : undefined);
/** The shortest form: true / "text" without a click, { text, click } with one. */
function makeNotify(text: string | true | undefined, click: string | undefined): Notify {
  if (text === undefined) return undefined;
  if (!click) return text;
  return text === true ? { click } : { text, click };
}

/** notifyError without empty fields (undefined when nothing is set). */
const errorNotify = (text: string | undefined, click: string | undefined): Action['notifyError'] =>
  text === undefined && click === undefined ? undefined : { ...(text !== undefined ? { text } : {}), ...(click !== undefined ? { click } : {}) };

/** The shortest form of a confirmation: the question alone, { text, button } with a button text. */
function makeConfirm(text: string, button: string): Action['confirm'] {
  if (!button) return text || undefined;
  return { text, button };
}

function RefList(props: { title: string; hint: string; refs: string[] | undefined; onChange: (refs: string[] | undefined) => void }) {
  const ids = allIds(draft.value);
  const refs = props.refs ?? [];
  const set = (next: string[]) => props.onChange(next.length ? next : undefined);
  return (
    <Field label={props.title} hint={props.hint}>
      <div class="chips">
        {refs.map((ref, i) => {
          const [id, kind] = ref.split(':');
          return (
            <span class="chip">
              {id}
              <select
                value={kind ?? ''}
                onChange={(e) => {
                  const k = (e.currentTarget as HTMLSelectElement).value;
                  const next = [...refs];
                  next[i] = k ? `${id}:${k}` : id!;
                  set(next);
                }}
              >
                <option value="">same</option>
                <option value="on">on</option>
                <option value="off">off</option>
                <option value="right">right</option>
              </select>
              <button onClick={() => set(refs.filter((_, j) => j !== i))} aria-label="Remove">
                <X size={12} />
              </button>
            </span>
          );
        })}
        <select
          class="select"
          style={{ width: 'auto', height: 26, padding: '0 6px', fontSize: 12 }}
          value=""
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v) set([...refs, v]);
            (e.currentTarget as HTMLSelectElement).value = '';
          }}
        >
          <option value="">+ add entry…</option>
          {ids.map((x) => (
            <option value={x.id}>
              {x.label} ({x.id})
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}

type AfterMode = AfterWhen | 'codes';

/** The shortest form of an entry of `after`: the reference alone when it always runs. */
export function makeAfter(run: string, mode: AfterMode, codes: number[]): AfterRef {
  if (mode === 'codes') return { run, exitCodes: codes };
  return mode === 'always' ? run : { run, when: mode };
}

/** Exit codes typed in a field: the whole numbers in it ("0, 3 4" → [0, 3, 4]). */
export const parseCodes = (text: string): number[] => [...new Set((text.match(/-?\d+/g) ?? []).map(Number))];

/** One entry of "Run after": which entry, which of its actions, and on which result of the script. */
function AfterRow(props: { item: AfterRef; i: number; ids: { id: string; label: string }[]; onChange: (item: AfterRef) => void; onRemove: () => void; testId?: string }) {
  const { run, when, exitCodes } = afterParts(props.item);
  const [id = '', kind = ''] = run.split(':');
  const mode: AfterMode = exitCodes ? 'codes' : when;
  const [codesText, setCodesText] = useState((exitCodes ?? []).join(', '));
  const set = (next: { id?: string; kind?: string; mode?: AfterMode; codes?: number[] }) => {
    const nid = next.id ?? id;
    const nkind = next.kind ?? kind;
    props.onChange(makeAfter(nkind ? `${nid}:${nkind}` : nid, next.mode ?? mode, next.codes ?? exitCodes ?? []));
  };
  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);
  return (
    <div class="choice" data-testid={props.testId}>
      <span class="choice-num">{props.i + 1}</span>
      <select class="select" style={{ flex: 1, minWidth: 0 }} value={id} onChange={(e) => set({ id: (e.currentTarget as HTMLSelectElement).value })} aria-label="Entry" data-testid={tid('entry')}>
        {!props.ids.some((x) => x.id === id) && <option value={id}>{id} (unknown)</option>}
        {props.ids.map((x) => (
          <option value={x.id}>
            {x.label} ({x.id})
          </option>
        ))}
      </select>
      <select class="select" style={{ width: 128 }} value={kind} onChange={(e) => set({ kind: (e.currentTarget as HTMLSelectElement).value })} aria-label="Which action" data-testid={tid('kind')}>
        <option value="">same action</option>
        <option value="on">turn on</option>
        <option value="off">turn off</option>
        <option value="right">right click</option>
      </select>
      <select
        class="select"
        style={{ width: 196 }}
        value={mode}
        onChange={(e) => {
          const m = (e.currentTarget as HTMLSelectElement).value as AfterMode;
          if (m === 'codes') setCodesText((exitCodes ?? []).join(', '));
          set({ mode: m });
        }}
        aria-label="When it runs"
        data-testid={tid('when')}
      >
        <option value="always">always</option>
        <option value="success">only if the script succeeds</option>
        <option value="failed">only if the script fails</option>
        <option value="codes">only with exit codes…</option>
      </select>
      {mode === 'codes' && (
        <input
          class={`input mono ${exitCodes?.length ? '' : 'invalid'}`}
          style={{ width: 96 }}
          value={codesText}
          placeholder="e.g. 0, 3"
          aria-label="Exit codes"
          title="Exit codes of the script, separated by commas"
          onInput={(e) => {
            const text = (e.currentTarget as HTMLInputElement).value;
            setCodesText(text);
            set({ codes: parseCodes(text) });
          }}
          data-testid={tid('codes')}
        />
      )}
      <button class="btn ghost sm icon danger" onClick={props.onRemove} aria-label="Remove" data-testid={tid('remove')}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** "Run after": entries run in order after the script, each always or only on some results. */
function AfterList(props: { items: AfterRef[] | undefined; onChange: (items: AfterRef[] | undefined) => void; testId?: string }) {
  const ids = allIds(draft.value);
  const items = props.items ?? [];
  const set = (next: AfterRef[]) => props.onChange(next.length ? next : undefined);
  return (
    <Field
      label="Run after"
      hint="Other entries, run in order when this script ends: always, only if it succeeds or fails, or only with some exit codes. This entry shows running until the last one ends."
    >
      <div class="choices" data-testid={props.testId}>
        {items.map((item, i) => (
          <AfterRow
            key={`${i}:${items.length}`}
            item={item}
            i={i}
            ids={ids}
            onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))}
            onRemove={() => set(items.filter((_, j) => j !== i))}
            testId={props.testId ? `${props.testId}-${i}` : undefined}
          />
        ))}
        <div class="row" style={{ alignItems: 'center' }}>
          <select
            class="select"
            style={{ width: 'auto' }}
            value=""
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v) set([...items, v]);
              (e.currentTarget as HTMLSelectElement).value = '';
            }}
            aria-label="Add an entry to run after"
            data-testid={props.testId ? `${props.testId}-add` : undefined}
          >
            <option value="">+ Add an entry to run after…</option>
            {ids.map((x) => (
              <option value={x.id}>
                {x.label} ({x.id})
              </option>
            ))}
          </select>
        </div>
      </div>
    </Field>
  );
}

export function ActionEditor(props: { value: ActionInput | undefined; onChange: (v: ActionInput | undefined) => void; placeholder?: string; testId?: string; scope?: VarScope }) {
  const action = toAction(props.value) ?? { run: '' };
  const [open, setOpen] = useState(() => Object.keys(action).some((k) => k !== 'run'));
  const [result, setResult] = useState<TestResult>();
  const [running, setRunning] = useState(false);
  const scriptRef = useRef<HTMLTextAreaElement>(null);

  /** Inserts text at the caret of the script (or at the end). */
  const insert = (text: string) => {
    const t = scriptRef.current;
    const at = t && document.activeElement === t ? t.selectionStart : (t?.selectionStart ?? action.run.length);
    const end = t && document.activeElement === t ? t.selectionEnd : at;
    const run = `${action.run.slice(0, at)}${text}${action.run.slice(end)}`;
    change({ run });
    requestAnimationFrame(() => {
      if (!t) return;
      t.focus();
      t.selectionStart = t.selectionEnd = at + text.length;
    });
  };

  const change = (patch: Partial<Action>) => {
    const next = { ...action, ...patch } as Action;
    for (const k of Object.keys(next) as (keyof Action)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    // An empty script stays as { run: '' } (flagged by validation) until the user removes the action explicitly.
    props.onChange(next.run ? fromAction(next) : ({ ...next, run: '' } as Action));
  };

  const test = async () => {
    setRunning(true);
    try {
      setResult(await window.traycommand.test({ ...action, confirm: undefined }));
    } finally {
      setRunning(false);
    }
  };

  const scope: VarScope = { inputs: [...(action.inputs ?? []).map((i) => i.name), ...(props.scope?.inputs ?? [])], files: props.scope?.files };
  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);
  const advancedCount = ['shell', 'cwd', 'env', 'timeout', 'notify', 'notifyError', 'confirm', 'terminal', 'admin', 'before', 'parallel', 'after'].filter((k) => (action as Record<string, unknown>)[k] !== undefined).length;
  const text = notifyText(action.notify);
  const click = notifyClick(action.notify);
  const confirm = confirmTexts(action.confirm);

  return (
    <div class="card-body" data-testid={props.testId}>
      <Field label="Script">
        <VarField multiline code value={action.run} scope={scope} placeholder={props.placeholder ?? 'e.g. Start-Process notepad'} onInput={(run) => change({ run })} testId={tid('script')} inputRef={scriptRef} />
      </Field>
      <InputsEditor value={action.inputs} onChange={(inputs) => change({ inputs })} script={action.run} onInsert={insert} testId={props.testId ? `${props.testId}-inputs` : undefined} />
      <div class="row" style={{ alignItems: 'center' }}>
        <button class="btn sm" onClick={test} disabled={!action.run || running} data-testid={props.testId ? `${props.testId}-test` : undefined}>
          <CirclePlay size={14} /> Test
        </button>
        {action.admin && (
          <span class="hint" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <ShieldAlert size={13} /> runs as administrator (UAC prompt)
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button class="disclosure" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Options{advancedCount ? ` (${advancedCount})` : ''}
        </button>
      </div>
      <TestOutput result={result} running={running} />
      {open && (
        <>
          <div class="grid3">
            <Field label="Shell">
              <ShellSelect value={action.shell} onChange={(shell) => change({ shell })} />
            </Field>
            <Field label="Working folder" hint="Relative to the config file">
              <VarField value={action.cwd ?? ''} scope={scope} placeholder="(config folder)" onInput={(cwd) => change({ cwd: cwd || undefined })} testId={tid('cwd')} />
            </Field>
            <Field label="Timeout (seconds)">
              <input class="input" type="number" min={1} value={action.timeout ?? ''} placeholder="none" onInput={(e) => change({ timeout: Number((e.currentTarget as HTMLInputElement).value) || undefined })} />
            </Field>
          </div>
          {typeof action.shell === 'object' && (
            <div class="grid2">
              <Field label="Shell executable">
                <input class="input mono" value={action.shell.command} onInput={(e) => change({ shell: { ...(action.shell as { command: string; args: string[] }), command: (e.currentTarget as HTMLInputElement).value } })} />
              </Field>
              <Field label="Shell arguments" hint="Space separated, the script is appended last">
                <input class="input mono" value={action.shell.args.join(' ')} onInput={(e) => change({ shell: { ...(action.shell as { command: string; args: string[] }), args: (e.currentTarget as HTMLInputElement).value.split(' ').filter(Boolean) } })} />
              </Field>
            </div>
          )}
          <div class="grid2">
            <Field label="Notification on success" hint="Errors are always notified">
              <select
                class="select"
                value={text === undefined ? 'none' : text === true ? 'default' : 'custom'}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  change({ notify: makeNotify(v === 'none' ? undefined : v === 'default' ? true : typeof text === 'string' ? text : 'Done', click) });
                }}
              >
                <option value="none">None</option>
                <option value="default">Default (“Done”)</option>
                <option value="custom">Custom text</option>
              </select>
            </Field>
            {typeof text === 'string' ? (
              <Field label="Notification text">
                <VarField value={text} scope={scope} onInput={(t) => change({ notify: makeNotify(t, click) })} testId={tid('notify')} />
              </Field>
            ) : (
              <div />
            )}
          </div>
          {text !== undefined && (
            <ClickRef label="Clicking the notification runs" hint="An entry of any tray; empty = nothing" none="Nothing" value={click} onChange={(c) => change({ notify: makeNotify(text, c) })} testId={tid('notify-click')} />
          )}
          <div class="grid2">
            <Field label="Error notification text" hint="Instead of “Failed: …”; the last lines of the output follow">
              <VarField
                value={action.notifyError?.text ?? ''}
                scope={scope}
                placeholder="Failed: <reason>"
                onInput={(t) => change({ notifyError: errorNotify(t || undefined, action.notifyError?.click) })}
                testId={tid('notify-error')}
              />
            </Field>
            <ClickRef
              label="Clicking an error notification runs"
              hint="Empty = open the activity log"
              none="Open the activity log"
              value={action.notifyError?.click}
              onChange={(c) => change({ notifyError: errorNotify(action.notifyError?.text, c) })}
              testId={tid('notify-error-click')}
            />
          </div>
          <div class="grid2">
            <Field label="Ask for confirmation" hint="Leave empty to run immediately; Enter runs, Esc cancels">
              <VarField value={confirm?.text ?? ''} scope={scope} placeholder="e.g. Reset the database?" onInput={(t) => change({ confirm: makeConfirm(t, confirm?.button ?? '') })} testId={tid('confirm')} />
            </Field>
            <Field label="Confirm button" hint="Text of the button that runs">
              <VarField value={confirm?.button ?? ''} scope={scope} placeholder="Run" onInput={(b) => change({ confirm: makeConfirm(confirm?.text ?? '', b) })} testId={tid('confirm-button')} />
            </Field>
          </div>
          <div class="grid2">
            <Switch checked={!!action.terminal} onChange={(v) => change({ terminal: v || undefined })} label="Run in a visible terminal" hint="The window stays open after the script ends" />
            <Switch checked={!!action.admin} onChange={(v) => change({ admin: v || undefined })} label="Run as administrator" hint="UAC prompt on every run; enable it in Settings first" />
          </div>
          <Field label="Environment variables" hint="One per line: NAME=value. The safest way to give a secret to a script: TOKEN=${TOKEN}, then $env:TOKEN in the script">
            <VarField
              multiline
              code
              rows={2}
              scope={scope}
              testId={tid('env')}
              value={Object.entries(action.env ?? {})
                .map(([k, v]) => `${k}=${v}`)
                .join('\n')}
              onInput={(text) => {
                const env = Object.fromEntries(
                  text
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.includes('='))
                    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]),
                );
                change({ env: Object.keys(env).length ? env : undefined });
              }}
            />
          </Field>
          <RefList title="Run before" hint="Actions of other entries, in order, before this script" refs={action.before} onChange={(before) => change({ before })} />
          <RefList title="Run together" hint="Actions of other entries, in parallel with this script" refs={action.parallel} onChange={(parallel) => change({ parallel })} />
          <AfterList items={action.after} onChange={(after) => change({ after })} testId={tid('after')} />
        </>
      )}
    </div>
  );
}

export function AddActionButton(props: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button class="btn sm" onClick={props.onClick} data-testid={props.testId}>
      <Plus size={14} /> {props.label}
    </button>
  );
}

export { api };
