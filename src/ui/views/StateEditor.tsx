import { useState } from 'preact/hooks';
import { CirclePlay } from 'lucide-preact';
import type { State } from '../../shared/config';
import type { TestResult } from '../../shared/api';
import { Field, Switch } from '../components/ui';
import { VarField } from '../components/VarField';
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

export function StateEditor(props: { value: State; onChange: (s: State) => void; hasOffAction?: boolean; label?: string }) {
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
        <VarField multiline code value={s.check} onInput={(check) => change({ check })} placeholder="e.g. Get-Process nginx -ErrorAction SilentlyContinue" testId="state-check" />
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
      <Field label="Name when OFF" hint="Shown instead of the name while OFF: in the menu, the tooltip of the tray and the launcher. Empty = the same name. Without an action, the entry is a title that follows the state.">
        <VarField value={s.labelOff ?? ''} placeholder={props.label || 'Same name'} onInput={(labelOff) => change({ labelOff: labelOff || undefined })} testId="state-label-off" />
      </Field>
      <div class="grid2">
        <Field label="Check after an action (ms)" hint="Wait before checking again after a click: empty = 700, 0 = at once">
          <input
            class="input"
            type="number"
            min={0}
            max={60000}
            value={s.recheckDelay ?? ''}
            placeholder="700"
            data-testid="state-recheck-delay"
            onInput={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value;
              change({ recheckDelay: raw === '' ? undefined : Math.min(60000, Math.max(0, Math.round(Number(raw)) || 0)) });
            }}
          />
        </Field>
        <Switch
          checked={!!s.optimistic}
          onChange={(v) => change({ optimistic: v || undefined })}
          disabled={!props.hasOffAction && !s.optimistic}
          label="Show the new state at once"
          hint={props.hasOffAction ? 'ON after the action, OFF after the OFF action, when they succeed; the check corrects it if wrong' : 'Needs an OFF action'}
          testId="state-optimistic"
        />
      </div>
      <div class="grid2">
        <Field label="Notify when it turns ON" hint="Empty = no notification">
          <VarField value={notifyValue(s.notify?.on)} placeholder="(none)" onInput={(v) => change({ notify: { ...s.notify, on: parseNotify(v) } })} testId="state-notify-on" />
        </Field>
        <Field label="Notify when it turns OFF">
          <VarField value={notifyValue(s.notify?.off)} placeholder="(none)" onInput={(v) => change({ notify: { ...s.notify, off: parseNotify(v) } })} testId="state-notify-off" />
        </Field>
      </div>
    </div>
  );
}
