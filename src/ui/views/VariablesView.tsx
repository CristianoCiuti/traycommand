import { useMemo, useState } from 'preact/hooks';
import { Braces, ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, LockOpen, PenLine, Plus, SquareArrowOutUpRight, Trash2, TriangleAlert, Eraser } from 'lucide-preact';
import type { Config } from '../../shared/config';
import { FILE_VALUES, VARIABLE_NAME, renameVariable, textFields, undefinedReferences, useCounts, variableUses } from '../../shared/varRefs';
import { changeSecrets, draft, info, mutate, navigate, secretOps, secretStates, secretValue, secretsInfo, showToast } from '../store';
import { Card, Dialog, Field, Switch } from '../components/ui';
import { VarField } from '../components/VarField';

/** Why a new name cannot be used, or undefined. */
export function nameProblem(config: Config, name: string, current?: string): string | undefined {
  if (!name) return 'Write a name';
  if (!VARIABLE_NAME.test(name)) return 'Only letters, numbers and "_"';
  if (name === 'configDir') return '${configDir} is built in';
  if (name !== current && (config.variables[name] !== undefined || (config.secrets ?? []).includes(name))) return `There is already a variable called ${name}`;
  return undefined;
}

/** Types the value of a secret: what is typed goes to the secret store on Save. */
function setSecretValue(name: string, value: string) {
  const ops = secretOps.value;
  const last = ops.at(-1);
  // typing: one change for the whole value, not one per key
  const base = last?.op === 'set' && last.name === name ? ops.slice(0, -1) : ops;
  secretOps.value = value === '' ? base : [...base, { op: 'set', name, value }];
}

function SecretValue(props: { name: string; testId: string }) {
  const state = secretStates().get(props.name);
  const [shown, setShown] = useState(false);
  const [revealed, setRevealed] = useState<string>();
  const available = secretsInfo.value.available;
  const value = state?.pending ?? (shown ? (revealed ?? '') : '');
  return (
    <span class="inline" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        class="input mono"
        style={{ flex: 1, minWidth: 0 }}
        type={shown ? 'text' : 'password'}
        value={value}
        disabled={!available}
        autocomplete="off"
        spellcheck={false}
        placeholder={state?.set ? '•••••••• saved on this PC: type to replace it' : 'No value on this PC: type it'}
        aria-label={`Value of ${props.name}`}
        data-testid={props.testId}
        onInput={(e) => setSecretValue(props.name, (e.currentTarget as HTMLInputElement).value)}
      />
      <button
        class="btn sm icon ghost"
        disabled={!state?.set}
        title={shown ? 'Hide the value' : 'Show the value'}
        aria-label={shown ? 'Hide the value' : 'Show the value'}
        data-testid={`${props.testId}-show`}
        onClick={async () => {
          if (!shown && state?.pending === undefined) setRevealed(await secretValue(props.name));
          setShown(!shown);
        }}
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        class="btn sm icon ghost"
        disabled={!state?.set}
        title="Remove the value from this PC (the secret stays)"
        aria-label="Remove the value"
        data-testid={`${props.testId}-clear`}
        onClick={() => {
          changeSecrets({ op: 'delete', name: props.name });
          setRevealed(undefined);
          setShown(false);
        }}
      >
        <Eraser size={14} />
      </button>
    </span>
  );
}

type RenameMode = 'all' | 'pick' | 'none';

function RenameDialog(props: { name: string; secret: boolean; onClose: () => void }) {
  const config = draft.value!;
  const uses = useMemo(() => variableUses(config, props.name), [config, props.name]);
  const [to, setTo] = useState(props.name);
  const [mode, setMode] = useState<RenameMode>('all');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(uses.map((u) => u.field.path)));
  const problem = to === props.name ? 'Write the new name' : nameProblem(config, to, props.name);
  const total = uses.reduce((n, u) => n + u.count, 0);
  const apply = () => {
    if (problem) return;
    const paths = mode === 'all' ? undefined : mode === 'pick' ? [...picked] : [];
    draft.value = renameVariable(config, props.name, to, paths);
    if (props.secret) changeSecrets({ op: 'rename', from: props.name, to });
    showToast(`${props.name} renamed to ${to}`);
    props.onClose();
  };
  const option = (value: RenameMode, label: string, hint: string) => (
    <label class="xfer-row" data-testid={`rename-${value}`}>
      <input type="radio" name="rename-mode" checked={mode === value} onChange={() => setMode(value)} />
      <span class="xfer-label">{label}</span>
      <span class="xfer-meta">{hint}</span>
    </label>
  );
  return (
    <Dialog
      title={`Rename \${${props.name}}`}
      icon={<PenLine size={16} />}
      onClose={props.onClose}
      testId="rename-dialog"
      wide={uses.length > 0}
      footer={
        <>
          <button class="btn ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn primary" disabled={!!problem || (mode === 'pick' && picked.size === 0)} onClick={apply} data-testid="rename-apply">
            Rename
          </button>
        </>
      }
    >
      <Field label="New name" hint={problem && to !== props.name ? <span style={{ color: 'var(--danger)' }}>{problem}</span> : 'Letters, numbers and "_"'}>
        <input class="input mono" value={to} autoFocus onInput={(e) => setTo((e.currentTarget as HTMLInputElement).value.replace(/[^A-Za-z0-9_]/g, '_'))} onKeyDown={(e) => e.key === 'Enter' && apply()} data-testid="rename-name" />
      </Field>
      {uses.length > 0 ? (
        <>
          <div class="hint">
            {`\${${props.name}}`} is written in {uses.length} {uses.length === 1 ? 'place' : 'places'} ({total} {total === 1 ? 'time' : 'times'}). What should change there?
          </div>
          <div class="var-uses">
            {option('all', 'Everywhere', `every \${${props.name}} becomes \${${to || '…'}}`)}
            {option('pick', 'Only where I choose', 'tick the places below')}
            {option('none', 'Nowhere', `they keep \${${props.name}}, which will not be a variable any more`)}
          </div>
          {mode !== 'none' && (
            <div class="var-uses" data-testid="rename-uses">
              {uses.map((u) => (
                <label class="xfer-row" data-testid="rename-use">
                  <input
                    type="checkbox"
                    disabled={mode === 'all'}
                    checked={mode === 'all' || picked.has(u.field.path)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if ((e.currentTarget as HTMLInputElement).checked) next.add(u.field.path);
                      else next.delete(u.field.path);
                      setPicked(next);
                    }}
                  />
                  <span class="xfer-label">{u.field.owner}</span>
                  <span class="xfer-meta">
                    {u.field.where}
                    {u.count > 1 ? ` (${u.count} times)` : ''}
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      ) : (
        <div class="hint">{`\${${props.name}}`} is not used anywhere yet.</div>
      )}
    </Dialog>
  );
}

/** The places where a variable is written, each one a link to its entry. */
function Uses(props: { config: Config; name: string }) {
  const uses = variableUses(props.config, props.name);
  return (
    <div class="var-uses" data-testid={`uses-${props.name}`}>
      {uses.map((u) => (
        <div class="xfer-row">
          <span class="xfer-label">{u.field.owner}</span>
          <span class="xfer-meta">
            {u.field.where}
            {u.count > 1 ? ` (${u.count} times)` : ''}
          </span>
          {u.field.entry && (
            <button class="btn ghost sm" onClick={() => navigate(`/entry/${encodeURIComponent(u.field.entry!)}`)} title="Open the entry">
              <SquareArrowOutUpRight size={13} /> Open
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddVariable(props: { config: Config }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(false);
  const problem = name ? nameProblem(props.config, name) : undefined;
  const add = () => {
    if (!name || problem) return;
    if (secret && !secretsInfo.value.available) return showToast('Secrets cannot be stored safely on this system', 'error');
    mutate((c) => {
      if (secret) c.secrets = [...(c.secrets ?? []), name];
      else c.variables[name] = value;
    });
    if (secret && value) changeSecrets({ op: 'set', name, value });
    setName('');
    setValue('');
  };
  return (
    <div class="var-add" data-testid="add-variable">
      <Field label="Name" hint={problem ? <span style={{ color: 'var(--danger)' }}>{problem}</span> : undefined}>
        <input class={`input mono${problem ? ' invalid' : ''}`} value={name} placeholder="e.g. PROJECTS" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value.replace(/[^A-Za-z0-9_]/g, '_'))} onKeyDown={(e) => e.key === 'Enter' && add()} data-testid="add-variable-name" />
      </Field>
      <Field label="Value">
        {secret ? (
          <input class="input mono" type="password" autocomplete="off" value={value} placeholder="encrypted on this PC" onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && add()} data-testid="add-variable-value" />
        ) : (
          <input class="input mono" value={value} placeholder="e.g. D:\Projects" onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && add()} data-testid="add-variable-value" />
        )}
      </Field>
      <Switch checked={secret} onChange={setSecret} label="Secret" hint="Encrypted on this PC, never in the file" disabled={!secretsInfo.value.available} testId="add-variable-secret" />
      <button class="btn primary sm" disabled={!name || !!problem} onClick={add} data-testid="add-variable-button">
        <Plus size={14} /> Add
      </button>
    </div>
  );
}

export function VariablesView() {
  const config = draft.value!;
  const [open, setOpen] = useState<string>();
  const [renaming, setRenaming] = useState<{ name: string; secret: boolean }>();
  const counts = useMemo(() => useCounts(config), [config]);
  const states = secretStates();
  const secrets = config.secrets ?? [];
  const fields = useMemo(() => new Map(textFields(config).map((f) => [f.path, f])), [config]);
  const missing = useMemo(() => {
    const byName = new Map<string, { message: string; places: string[] }>();
    for (const r of undefinedReferences(config)) {
      const f = fields.get(r.path)!;
      const item = byName.get(r.name) ?? { message: r.message, places: [] };
      item.places.push(`${f.owner} · ${f.where}`);
      byName.set(r.name, item);
    }
    return [...byName];
  }, [config, fields]);

  const remove = async (name: string, secret: boolean) => {
    const n = counts.get(name) ?? 0;
    if (n && !confirm(`\${${name}} is used ${n} ${n === 1 ? 'time' : 'times'}: there it will stay written as it is. Delete ${name}?`)) return;
    mutate((c) => {
      if (secret) c.secrets = (c.secrets ?? []).filter((s) => s !== name);
      else delete c.variables[name];
      if (c.secrets && !c.secrets.length) delete c.secrets;
    });
    if (secret) changeSecrets({ op: 'delete', name });
  };

  const makeSecret = (name: string) => {
    if (!secretsInfo.value.available) return showToast('Secrets cannot be stored safely on this system', 'error');
    const value = config.variables[name] ?? '';
    mutate((c) => {
      delete c.variables[name];
      c.secrets = [...(c.secrets ?? []), name];
    });
    if (value) changeSecrets({ op: 'set', name, value });
  };

  const makePlain = async (name: string) => {
    if (!confirm(`The value of ${name} will be written in the configuration file, where anyone who opens it can read it, and it will be exported with it. Continue?`)) return;
    const value = (await secretValue(name)) ?? '';
    mutate((c) => {
      c.secrets = (c.secrets ?? []).filter((s) => s !== name);
      if (!c.secrets.length) delete c.secrets;
      c.variables[name] = value;
    });
    changeSecrets({ op: 'delete', name });
  };

  const row = (name: string, secret: boolean) => {
    const n = counts.get(name) ?? 0;
    const isOpen = open === name;
    return (
      <>
        <tr data-testid="variable-row" data-name={name} data-secret={secret ? 'true' : undefined}>
          <td class="mono">
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {secret && <KeyRound size={13} />}
              {`\${${name}}`}
            </span>
          </td>
          <td>{secret ? <SecretValue name={name} testId={`secret-${name}`} /> : <VarField mono value={config.variables[name] ?? ''} onInput={(v) => mutate((c) => (c.variables[name] = v))} testId={`variable-${name}`} placeholder="(empty)" />}</td>
          <td>
            <button class="disclosure" disabled={!n} onClick={() => setOpen(isOpen ? undefined : name)} data-testid={`uses-toggle-${name}`}>
              {n ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
              {n ? `${n} ${n === 1 ? 'use' : 'uses'}` : 'not used'}
            </button>
          </td>
          <td>
            <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button class="btn sm icon ghost" title="Rename" aria-label="Rename" onClick={() => setRenaming({ name, secret })} data-testid={`rename-${name}`}>
                <PenLine size={14} />
              </button>
              {secret ? (
                <button class="btn sm icon ghost" title="Make it a plain variable (the value goes in the file)" aria-label="Make it a plain variable" onClick={() => void makePlain(name)} data-testid={`plain-${name}`}>
                  <LockOpen size={14} />
                </button>
              ) : (
                <button class="btn sm icon ghost" title="Make it a secret (the value leaves the file)" aria-label="Make it a secret" onClick={() => makeSecret(name)} data-testid={`secret-make-${name}`}>
                  <KeyRound size={14} />
                </button>
              )}
              <button class="btn sm icon ghost danger" title="Delete" aria-label="Delete" onClick={() => void remove(name, secret)} data-testid={`delete-${name}`}>
                <Trash2 size={14} />
              </button>
            </span>
          </td>
        </tr>
        {isOpen && (
          <tr>
            <td colSpan={4}>
              <Uses config={config} name={name} />
            </td>
          </tr>
        )}
      </>
    );
  };

  const names = Object.keys(config.variables);
  const unset = secrets.filter((s) => !states.get(s)?.set);
  return (
    <div class="page" data-testid="variables-view">
      <div class="page-inner">
        <div>
          <h1 data-hud="SYS // 02 · VARIABLES">Variables</h1>
          <p class="lead">
            Values you write once and use everywhere as <code>{'${NAME}'}</code>: in scripts, folders, labels, notifications. Every tray and menu sees the same variables; an action's own asked values (and the file of a folder watch) take precedence inside that action.
          </p>
        </div>

        {!secretsInfo.value.available && (
          <div class="issues">
            <b>Secrets are not available</b>
            <ul>
              <li>This system offers no encryption for your account (on Linux: no keyring is running). Plain variables work as usual.</li>
            </ul>
          </div>
        )}
        {unset.length > 0 && (
          <div class="issues" data-testid="secrets-unset">
            <b>Secrets without a value on this PC</b>
            <ul>
              <li>
                {unset.map((s) => `\${${s}}`).join(', ')}: {unset.length === 1 ? 'it is' : 'they are'} replaced by nothing until you type {unset.length === 1 ? 'its value' : 'their values'} below.
              </li>
            </ul>
          </div>
        )}

        <Card title="Variables" icon={<Braces size={16} />} desc={`${names.length + secrets.length} defined`} testId="variables-card">
          <div class="card-body">
            {names.length + secrets.length > 0 ? (
              <table class="var-table" data-testid="variables-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                    <th>Used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {names.map((n) => row(n, false))}
                  {secrets.map((n) => row(n, true))}
                </tbody>
              </table>
            ) : (
              <div class="hint">No variables yet: add the first one below.</div>
            )}
            <AddVariable config={config} />
            <div class="hint">
              <KeyRound size={12} style={{ verticalAlign: -2 }} /> A <b>secret</b> (password, token) is used like any variable, but its value is never written in the configuration file: it is kept encrypted on this PC for your account, hidden as •••• in the activity log, in notifications and in test output, and left out of exports (only its name travels). The safest way to hand it to a script is an environment variable of the action: <code>{'TOKEN=${TOKEN}'}</code>, then <code>$env:TOKEN</code>.
            </div>
          </div>
        </Card>

        {missing.length > 0 && (
          <Card title="Written but not defined" icon={<TriangleAlert size={16} />} desc="Left as written when they run" testId="variables-missing">
            <div class="card-body">
              {missing.map(([name, m]) => (
                <div class="xfer-row" data-testid="missing-variable" data-name={name}>
                  <span class="xfer-label mono">{`\${${name}}`}</span>
                  <span class="xfer-meta" title={m.places.join('\n')}>
                    {m.places.length === 1 ? m.places[0] : `${m.places[0]} and ${m.places.length - 1} more`}
                  </span>
                  {!FILE_VALUES.some((v) => v.name === name) && (
                    <button class="btn sm" onClick={() => mutate((c) => (c.variables[name] = ''))} data-testid={`define-${name}`}>
                      <Plus size={13} /> Add variable
                    </button>
                  )}
                </div>
              ))}
              <div class="hint">Fine when they are meant for the shell (like {'${HOME}'} in bash); otherwise add them, or correct the name.</div>
            </div>
          </Card>
        )}

        <Card title="Built in" desc="Always available">
          <div class="card-body">
            <table class="var-table">
              <tbody>
                <tr>
                  <td class="mono">{'${configDir}'}</td>
                  <td colSpan={3} class="mono">{info.value?.configDir}</td>
                </tr>
                <tr>
                  <td class="mono">{'${env:NAME}'}</td>
                  <td colSpan={3}>The environment variable NAME (empty when it is not set), e.g. {'${env:USERPROFILE}'}</td>
                </tr>
                {FILE_VALUES.map((v) => (
                  <tr>
                    <td class="mono">{`\${${v.name}}`}</td>
                    <td colSpan={3}>{v.hint}: only in runs started by a folder watch (also as an environment variable)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {renaming && <RenameDialog name={renaming.name} secret={renaming.secret} onClose={() => setRenaming(undefined)} />}
    </div>
  );
}
