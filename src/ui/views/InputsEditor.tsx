import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-preact';
import type { Input } from '../../shared/config';
import { Field, Switch, TextArea } from '../components/ui';

const TYPES: { value: NonNullable<Input['type']>; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'password', label: 'Password' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Choice' },
  { value: 'checkbox', label: 'Yes / no' },
  { value: 'file', label: 'File' },
  { value: 'folder', label: 'Folder' },
];

function nextName(inputs: Input[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'VALUE' : `VALUE${n}`;
    if (!inputs.some((i) => i.name === name)) return name;
  }
}

/** Values asked before the action runs. Each one is ${NAME} in the script and an environment variable. */
export function InputsEditor(props: { value: Input[] | undefined; onChange: (v: Input[] | undefined) => void; script: string; onInsert: (text: string) => void; testId?: string }) {
  const inputs = props.value ?? [];
  const set = (next: Input[]) => props.onChange(next.length ? next : undefined);
  const update = (i: number, patch: Partial<Input>) => {
    const next = [...inputs];
    const merged = { ...next[i]!, ...patch } as Input;
    for (const k of Object.keys(merged) as (keyof Input)[]) if (merged[k] === undefined || merged[k] === '') delete merged[k];
    next[i] = merged;
    set(next);
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...inputs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    set(next);
  };

  return (
    <div class="inputs-editor" data-testid={props.testId}>
      {inputs.map((input, i) => {
        const used = props.script.includes(`\${${input.name}}`);
        const type = input.type ?? 'text';
        const optionsText = (input.options ?? []).map((o) => (typeof o === 'string' ? o : o.label && o.label !== o.value ? `${o.value}=${o.label}` : o.value)).join('\n');
        return (
          <div class="input-def">
            <div class="input-def-head">
              <input
                class="input mono name"
                value={input.name}
                aria-label="Name"
                onInput={(e) => update(i, { name: (e.currentTarget as HTMLInputElement).value.replace(/[^A-Za-z0-9_]/g, '_') })}
                data-testid={`input-name-${i}`}
              />
              <input class="input" value={input.label ?? ''} placeholder={`Label (default: ${input.name})`} aria-label="Label" onInput={(e) => update(i, { label: (e.currentTarget as HTMLInputElement).value || undefined })} />
              <select class="select type" value={type} aria-label="Type" onChange={(e) => update(i, { type: ((e.currentTarget as HTMLSelectElement).value as Input['type']) === 'text' ? undefined : ((e.currentTarget as HTMLSelectElement).value as Input['type']) })} data-testid={`input-type-${i}`}>
                {TYPES.map((t) => (
                  <option value={t.value}>{t.label}</option>
                ))}
              </select>
              <span class="input-def-acts">
                <button class={`chip-btn${used ? ' used' : ''}`} title={used ? 'Used in the script. Click to insert it again' : 'Not used in the script yet: click to insert it'} onClick={() => props.onInsert(`\${${input.name}}`)}>
                  {'${'}
                  {input.name}
                  {'}'}
                </button>
                <button class="btn ghost sm icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp size={13} />
                </button>
                <button class="btn ghost sm icon" disabled={i === inputs.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown size={13} />
                </button>
                <button class="btn ghost sm icon danger" onClick={() => set(inputs.filter((_, j) => j !== i))} aria-label="Remove input">
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
            <div class="grid3">
              {type === 'checkbox' ? (
                <Switch checked={input.default === true || input.default === 'true'} onChange={(v) => update(i, { default: v || undefined })} label="On by default" />
              ) : type === 'password' ? (
                <div class="hint" style={{ alignSelf: 'center' }}>Never remembered, hidden in the activity log</div>
              ) : (
                <Field label="Default">
                  <input class="input" value={input.default === undefined ? '' : String(input.default)} placeholder="(empty)" onInput={(e) => update(i, { default: (e.currentTarget as HTMLInputElement).value || undefined })} />
                </Field>
              )}
              {type !== 'checkbox' && type !== 'select' ? (
                <Field label="Placeholder">
                  <input class="input" value={input.placeholder ?? ''} placeholder="(none)" onInput={(e) => update(i, { placeholder: (e.currentTarget as HTMLInputElement).value || undefined })} />
                </Field>
              ) : (
                <div />
              )}
              {type !== 'checkbox' ? (
                <Field label="Format" hint="Regular expression, optional">
                  <input class="input mono" value={input.pattern ?? ''} placeholder="any" onInput={(e) => update(i, { pattern: (e.currentTarget as HTMLInputElement).value || undefined })} />
                </Field>
              ) : (
                <div />
              )}
            </div>
            {type === 'select' && (
              <div class="grid2">
                <Field label="Choices" hint="One per line; value=label to show a different text">
                  <TextArea
                    code
                    rows={3}
                    value={optionsText}
                    placeholder={'dev\ntest\nprod=Production'}
                    onInput={(text) => {
                      const options = text
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((l) => (l.includes('=') ? { value: l.slice(0, l.indexOf('=')).trim(), label: l.slice(l.indexOf('=') + 1).trim() } : l));
                      update(i, { options: options.length ? options : undefined });
                    }}
                    testId={`input-options-${i}`}
                  />
                </Field>
                <Field label="…or choices from a script" hint="Each output line is a choice, e.g. git branch --format=%(refname:short)">
                  <TextArea code rows={3} value={input.optionsCommand ?? ''} placeholder="(none)" onInput={(v) => update(i, { optionsCommand: v || undefined })} />
                </Field>
              </div>
            )}
            <div class="row" style={{ gap: 20 }}>
              {type !== 'checkbox' && <Switch checked={!!input.optional} onChange={(v) => update(i, { optional: v || undefined })} label="Can be empty" />}
              {type !== 'password' && <Switch checked={input.remember !== false} onChange={(v) => update(i, { remember: v ? undefined : false })} label="Propose the last value" />}
            </div>
          </div>
        );
      })}
      <div class="row" style={{ alignItems: 'center' }}>
        <button class="btn sm" onClick={() => set([...inputs, { name: nextName(inputs) }])} data-testid={props.testId ? `${props.testId}-add` : undefined}>
          <Plus size={14} /> Ask for a value
        </button>
        <span class="hint">
          {inputs.length
            ? 'Asked in a small form before running. Use ${NAME} in the script, or the environment variable with the same name.'
            : 'Turn the action into a small form: e.g. a branch name, an environment, a file.'}
        </span>
      </div>
    </div>
  );
}
