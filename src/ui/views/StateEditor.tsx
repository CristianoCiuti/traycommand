import { useState } from 'preact/hooks';
import { CirclePlay } from 'lucide-preact';
import type { State } from '../../shared/config';
import type { TestResult } from '../../shared/api';
import { Field, TextArea } from '../components/ui';
import { ShellSelect, TestOutput } from './ActionEditor';
import { IconPicker } from './IconPicker';

function validRegex(source: string | undefined) {
  if (source === undefined) return true;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export function StateEditor(props: { value: State; onChange: (s: State) => void }) {
  const s = props.value;
  const [result, setResult] = useState<TestResult>();
  const [running, setRunning] = useState(false);
  const change = (patch: Partial<State>) => {
    const next = { ...s, ...patch } as State;
    for (const k of Object.keys(next) as (keyof State)[]) if (next[k] === undefined) delete next[k];
    props.onChange(next);
  };
  const test = async () => {
    setRunning(true);
    try {
      setResult(await window.traycommand.test({ run: s.check, shell: s.shell }, { on: s.on, off: s.off }));
    } finally {
      setRunning(false);
    }
  };
  const notifyValue = (v: string | boolean | undefined) => (v === undefined || v === false ? '' : v === true ? '(default)' : v);
  const parseNotify = (v: string) => (v === '' ? undefined : v === '(default)' ? true : v);

  return (
    <div class="card-body">
      <Field label="Check script" hint="Exit code ≠ 0 means OFF. Without patterns, exit code 0 means ON.">
        <TextArea code value={s.check} onInput={(check) => change({ check })} placeholder="e.g. Get-Process nginx -ErrorAction SilentlyContinue" testId="state-check" />
      </Field>
      <div class="grid2">
        <Field label="ON when output matches" hint="Regular expression (optional)">
          <input class={`input mono${validRegex(s.on) ? '' : ' invalid'}`} value={s.on ?? ''} placeholder="e.g. running" onInput={(e) => change({ on: (e.currentTarget as HTMLInputElement).value || undefined })} />
        </Field>
        <Field label="OFF when output matches" hint="Checked first (optional)">
          <input class={`input mono${validRegex(s.off) ? '' : ' invalid'}`} value={s.off ?? ''} placeholder="e.g. ^null$" onInput={(e) => change({ off: (e.currentTarget as HTMLInputElement).value || undefined })} />
        </Field>
      </div>
      <div class="row" style={{ alignItems: 'center' }}>
        <button class="btn sm" onClick={test} disabled={!s.check || running} data-testid="state-test">
          <CirclePlay size={14} /> Test check
        </button>
      </div>
      <TestOutput result={result} running={running} checkMode />
      <div class="grid3">
        <Field label="Check every (seconds)">
          <input class="input" type="number" min={2} value={s.interval} onInput={(e) => change({ interval: Math.max(2, Number((e.currentTarget as HTMLInputElement).value) || 60) })} />
        </Field>
        <Field label="Shell">
          <ShellSelect value={s.shell} onChange={(shell) => change({ shell })} />
        </Field>
        <Field label="Icon when OFF">
          <IconPicker value={s.iconOff} onChange={(iconOff) => change({ iconOff })} compact />
        </Field>
      </div>
      <div class="grid2">
        <Field label="Notify when it turns ON" hint="Empty = no notification">
          <input class="input" value={notifyValue(s.notify?.on)} placeholder="(none)" onInput={(e) => change({ notify: { ...s.notify, on: parseNotify((e.currentTarget as HTMLInputElement).value) } })} />
        </Field>
        <Field label="Notify when it turns OFF">
          <input class="input" value={notifyValue(s.notify?.off)} placeholder="(none)" onInput={(e) => change({ notify: { ...s.notify, off: parseNotify((e.currentTarget as HTMLInputElement).value) } })} />
        </Field>
      </div>
    </div>
  );
}
