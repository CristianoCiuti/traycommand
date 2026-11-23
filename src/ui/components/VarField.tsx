import type { Ref, RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { KeyRound, Plus, TriangleAlert } from 'lucide-preact';
import { FILE_VALUES, namesIn, undefinedReason } from '../../shared/varRefs';
import { draft, info, mutate, secretStates, showToast } from '../store';
import { TextArea } from './ui';

/** What a text gets besides the variables of the configuration. */
export interface VarScope {
  /** Values asked before the action runs (and values given by a schedule). */
  inputs?: string[];
  /** TC_FILE and the other values of a run started by a folder watch. */
  files?: boolean;
}

interface Chip {
  text: string;
  label: string;
  title: string;
  kind: 'input' | 'file' | 'variable' | 'secret' | 'builtin';
  /** Where the caret goes, from the end of the inserted text. */
  back?: number;
}

/** The chips that can be inserted in a text with this scope. */
export function chipsFor(scope: VarScope | undefined, variables: Record<string, string>, secrets: string[], configDir: string): Chip[] {
  const ref = (name: string) => `\${${name}}`;
  const chips: Chip[] = [];
  const inputs = [...new Set(scope?.inputs ?? [])];
  for (const name of inputs) chips.push({ text: ref(name), label: name, kind: 'input', title: 'Value asked before running' });
  if (scope?.files) for (const v of FILE_VALUES) if (!inputs.includes(v.name)) chips.push({ text: ref(v.name), label: v.name, kind: 'file', title: `${v.hint} (runs started by the folder watch)` });
  for (const [name, value] of Object.entries(variables)) if (!inputs.includes(name)) chips.push({ text: ref(name), label: name, kind: 'variable', title: value ? `Variable: ${value}` : 'Variable (empty)' });
  for (const name of secrets) if (!inputs.includes(name)) chips.push({ text: ref(name), label: name, kind: 'secret', title: 'Secret: its value is hidden everywhere' });
  chips.push({ text: '${configDir}', label: 'configDir', kind: 'builtin', title: `The folder of the configuration: ${configDir}` });
  chips.push({ text: '${env:}', label: 'env:…', kind: 'builtin', title: 'An environment variable: type its name after env:', back: 1 });
  return chips;
}

export interface VarProblem {
  name: string;
  message: string;
  /** It can be added as a variable. */
  canDefine: boolean;
}

/** ${NAME} that has no value in this text: not defined, a TC_ value outside a folder watch, a secret without value. */
export function varProblems(text: string, scope: VarScope | undefined): VarProblem[] {
  const config = draft.value;
  if (!config || !text.includes('${')) return [];
  const secrets = config.secrets ?? [];
  const known = new Set([...Object.keys(config.variables), ...secrets]);
  const locals = [...(scope?.inputs ?? []), ...(scope?.files ? FILE_VALUES.map((v) => v.name) : [])];
  const states = secretStates();
  const env = new Set((info.value?.envNames ?? []).map((n) => (info.value?.platform === 'win32' ? n.toUpperCase() : n)));
  const out: VarProblem[] = [];
  for (const name of namesIn(text)) {
    const reason = undefinedReason(name, known, locals);
    if (reason) {
      const isFile = FILE_VALUES.some((v) => v.name === name);
      const inEnv = env.has(info.value?.platform === 'win32' ? name.toUpperCase() : name);
      out.push({ name, message: inEnv && !isFile ? `${reason}. To use the environment variable, write \${env:${name}}` : reason, canDefine: !isFile });
    } else if (secrets.includes(name) && !locals.includes(name) && !states.get(name)?.set) {
      out.push({ name, message: `\${${name}} is a secret without a value on this PC: it is replaced by nothing. Set it in Variables`, canDefine: false });
    }
  }
  return out;
}

export function VarWarnings(props: { text: string; scope?: VarScope; testId?: string }) {
  const problems = varProblems(props.text, props.scope);
  if (!problems.length) return null;
  return (
    <div class="var-warn" data-testid={props.testId}>
      {problems.map((p) => (
        <span>
          <TriangleAlert size={12} />
          <span>{p.message}</span>
          {p.canDefine && (
            <button
              class="btn ghost sm"
              onClick={() => {
                mutate((c) => (c.variables[p.name] = ''));
                showToast(`Variable ${p.name} added: give it a value in Variables`);
              }}
            >
              <Plus size={12} /> Add variable
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** The chips under a text being edited: a click writes ${NAME} where the caret is. */
export function VarChips(props: { value: string; scope?: VarScope; onInsert: (text: string, back: number) => void; testId?: string }) {
  const config = draft.value;
  const chips = chipsFor(props.scope, config?.variables ?? {}, config?.secrets ?? [], info.value?.configDir ?? '');
  let last: Chip['kind'] | undefined;
  const groupName: Record<Chip['kind'], string> = { input: 'Values', file: 'File', variable: 'Variables', secret: 'Variables', builtin: 'Built in' };
  return (
    <div class="var-chips" data-testid={props.testId} role="toolbar" aria-label="Insert a variable">
      {chips.map((c) => {
        const group = groupName[c.kind];
        const head = last === undefined || groupName[last] !== group;
        last = c.kind;
        return (
          <>
            {head && <span class="var-sep">{group}</span>}
            <button
              type="button"
              class={`chip-btn${props.value.includes(c.text) && c.kind !== 'builtin' ? ' used' : ''}`}
              title={c.title}
              data-var={c.label}
              // the text keeps the focus (and the caret) while a chip is clicked
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onInsert(c.text, c.back ?? 0)}
            >
              {c.kind === 'secret' && <KeyRound size={11} />}
              {c.kind === 'builtin' ? c.text.replace('${env:}', '${env:…}') : c.text}
            </button>
          </>
        );
      })}
    </div>
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * A text where ${NAME} is replaced: while it is being edited, the variables it can use are shown
 * as chips to insert; names without a value are pointed out.
 */
export function VarField(props: {
  value: string;
  onInput: (v: string) => void;
  scope?: VarScope;
  multiline?: boolean;
  code?: boolean;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
  mono?: boolean;
  class?: string;
  style?: Record<string, string | number>;
  testId?: string;
  ariaLabel?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const [focused, setFocused] = useState(false);
  const own = useRef<Field>(null);
  const ref = (props.inputRef as RefObject<Field> | undefined) ?? own;

  const insert = (text: string, back: number) => {
    const el = ref.current;
    const value = props.value;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    props.onInput(`${value.slice(0, start)}${text}${value.slice(end)}`);
    const caret = start + text.length - back;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
    });
  };
  const blur = () => setFocused(false);

  return (
    <div class={`var-field${focused ? ' focused' : ''}`} style={props.style}>
      {props.multiline ? (
        <TextArea
          value={props.value}
          onInput={props.onInput}
          rows={props.rows}
          code={props.code}
          placeholder={props.placeholder}
          invalid={props.invalid}
          testId={props.testId}
          inputRef={ref as Ref<HTMLTextAreaElement>}
          onFocus={() => setFocused(true)}
          onBlur={blur}
          ariaLabel={props.ariaLabel}
        />
      ) : (
        <input
          ref={ref as Ref<HTMLInputElement>}
          class={props.class ?? `input${props.mono || props.code ? ' mono' : ''}${props.invalid ? ' invalid' : ''}`}
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          spellcheck={false}
          data-testid={props.testId}
          onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)}
          onFocus={() => setFocused(true)}
          onBlur={blur}
        />
      )}
      {focused && <VarChips value={props.value} scope={props.scope} onInsert={insert} testId={props.testId ? `${props.testId}-vars` : undefined} />}
      <VarWarnings text={props.value} scope={props.scope} testId={props.testId ? `${props.testId}-warn` : undefined} />
    </div>
  );
}
