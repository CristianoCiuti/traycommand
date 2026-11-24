import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, parseConfig, type Config, type ConfigInput } from '../../src/shared/config';
import { countRefs, namesIn, renameVariable, textFields, undefinedReason, undefinedReferences, useCounts, variableUses, FILE_VALUES } from '../../src/shared/varRefs';
import { buildExport, defaultExportSelection, exportDependencies, noChoices, packCount, planImport, readPack, sectionKeys, type Pack } from '../../src/shared/transfer';
import { Engine, type EngineDeps } from '../../src/main/engine';
import type { RunOptions, RunResult } from '../../src/main/runner';
import { SecretStore, type Cipher } from '../../src/main/secretStore';
import type { ExecutionLog } from '../../src/shared/api';

const config = (input: Partial<ConfigInput> = {}): Config => ConfigSchema.parse({ version: 2, ...input });

/** A configuration with a ${NAME} in every kind of text. */
const everywhere = () =>
  config({
    variables: { WS: 'C:/ws', URL: 'https://${HOST}/x', HOST: 'example.org' },
    secrets: ['TOKEN'],
    trays: [
      {
        id: 't',
        label: '${WS} tray',
        hotkey: 'Ctrl+Alt+T',
        hotkeyConfirm: { text: 'Run in ${WS}?', button: 'Go ${WS}' },
        action: {
          run: 'echo ${WS} ${NAME} ${TC_FILE}',
          cwd: '${WS}',
          env: { AUTH: '${TOKEN}' },
          notify: 'Done in ${WS}',
          confirm: 'Sure ${WS}?',
          inputs: [{ name: 'NAME', label: 'Name in ${WS}', optionsCommand: 'ls ${WS}' }, { name: 'PLAIN' }],
        },
        offAction: 'stop ${WS}',
        rightAction: { run: 'right ${WS}', notify: true },
        state: { check: 'check ${WS}', notify: { on: 'On ${WS}', off: true } },
        schedules: [
          {
            watch: { path: '${WS}/in' },
            values: { NAME: 'x' },
            if: 'test ${TC_FILE} ${NAME}',
            alert: {
              title: '${TC_FILE_NAME}',
              text: 'Arrived in ${WS}',
              choices: [
                { label: 'Move ${TC_FILE_NAME}', action: 'mv ${TC_FILE} ${WS}' },
                { label: 'Ask', action: { run: 'ask ${ASKED}', inputs: [{ name: 'ASKED' }] } },
                { label: 'Self', run: 'self' },
              ],
            },
          },
          { cron: '0 9 * * *', if: { check: 'ping ${HOST}' } },
          { cron: '0 10 * * *', alert: { text: 'plain' } },
        ],
        menu: [
          { separator: true },
          { label: '', action: 'echo ${MISSING}' },
          { label: 'Sub', menu: [{ label: 'Deep ${WS}', action: 'deep' }] },
        ],
      },
    ],
  });

describe('names in texts', () => {
  it('finds ${NAME} once each, never configDir or env:', () => {
    expect(namesIn('${A} ${B} ${A} ${configDir} ${env:PATH} $B {C}')).toEqual(['A', 'B']);
    expect(countRefs('${A}${A} ${AB}', 'A')).toBe(2);
  });
});

describe('textFields', () => {
  it('lists every text TrayCommand expands, with its own values', () => {
    const fields = textFields(everywhere());
    const by = new Map(fields.map((f) => [f.path, f]));
    expect([...by.keys()]).toEqual([
      'variables.WS',
      'variables.URL',
      'variables.HOST',
      'trays[0].label',
      'trays[0].hotkeyConfirm.text',
      'trays[0].hotkeyConfirm.button',
      'trays[0].action.run',
      'trays[0].action.cwd',
      'trays[0].action.env.AUTH',
      'trays[0].action.notify',
      'trays[0].action.confirm',
      'trays[0].action.inputs[0].label',
      'trays[0].action.inputs[0].optionsCommand',
      'trays[0].offAction',
      'trays[0].rightAction.run',
      'trays[0].state.check',
      'trays[0].state.notify.on',
      'trays[0].schedules[0].watch.path',
      'trays[0].schedules[0].if',
      'trays[0].schedules[0].alert.title',
      'trays[0].schedules[0].alert.text',
      'trays[0].schedules[0].alert.choices[0].label',
      'trays[0].schedules[0].alert.choices[0].action',
      'trays[0].schedules[0].alert.choices[1].label',
      'trays[0].schedules[0].alert.choices[1].action.run',
      'trays[0].schedules[0].alert.choices[2].label',
      'trays[0].schedules[1].if.check',
      'trays[0].schedules[2].alert.text',
      'trays[0].menu[1].label',
      'trays[0].menu[1].action',
      'trays[0].menu[2].label',
      'trays[0].menu[2].menu[0].label',
      'trays[0].menu[2].menu[0].action',
    ]);
    // the action gets its inputs and, with a folder watch, the file
    expect(by.get('trays[0].action.run')!.locals).toEqual(['NAME', 'PLAIN', ...FILE_VALUES.map((v) => v.name)]);
    expect(by.get('trays[0].action.inputs[0].label')!.locals).toEqual([]);
    expect(by.get('trays[0].schedules[0].if')!.locals).toContain('NAME');
    expect(by.get('trays[0].schedules[0].alert.choices[1].action.run')!.locals).toContain('ASKED');
    expect(by.get('trays[0].schedules[1].if.check')!.locals).toEqual([]);
    expect(by.get('trays[0].menu[2].menu[0].action')!.owner).toBe('${WS} tray › Sub › Deep ${WS}');
    expect(by.get('trays[0].menu[1].label')!.owner).toBe('${WS} tray › (no label)');
    expect(by.get('variables.WS')!.owner).toBe('Variables');
    expect(by.get('trays[0].action.env.AUTH')!.where).toBe('Click › Environment variable AUTH');
  });

  it('an entry without a watch gives no file values; a hotkeyConfirm true has no texts', () => {
    const fields = textFields(config({ trays: [{ id: 'a', label: 'A', hotkey: 'Ctrl+Alt+A', hotkeyConfirm: true, action: { run: 'x', inputs: [{ name: 'I' }] }, state: { check: 'c' } }] }));
    expect(fields.map((f) => f.path)).toEqual(['trays[0].label', 'trays[0].action.run', 'trays[0].state.check']);
    expect(fields[1]!.locals).toEqual(['I']);
    const empty = textFields(config({ trays: [{ id: 'a', label: '', hotkey: 'Ctrl+Alt+A', hotkeyConfirm: {}, menu: [{ label: 'child' }] }] }));
    expect(empty.map((f) => [f.path, f.owner])).toEqual([
      ['trays[0].label', '(no label)'],
      ['trays[0].menu[0].label', '(no label) › child'],
    ]);
  });

  it('set writes the text back in the configuration it was made from', () => {
    const c = everywhere();
    for (const f of textFields(c)) f.set(`<${f.path}>`);
    expect(c.variables.WS).toBe('<variables.WS>');
    expect(c.trays[0]!.offAction).toBe('<trays[0].offAction>');
    expect((c.trays[0]!.hotkeyConfirm as { button: string }).button).toBe('<trays[0].hotkeyConfirm.button>');
    expect(c.trays[0]!.state!.notify!.on).toBe('<trays[0].state.notify.on>');
    const s = c.trays[0]!.schedules!;
    expect(s[0]!.watch!.path).toBe('<trays[0].schedules[0].watch.path>');
    expect(s[0]!.if).toBe('<trays[0].schedules[0].if>');
    expect((s[1]!.if as { check: string }).check).toBe('<trays[0].schedules[1].if.check>');
    expect(s[0]!.alert!.choices![0]!.action).toBe('<trays[0].schedules[0].alert.choices[0].action>');
    expect(textFields(c).every((f) => f.text === `<${f.path}>`)).toBe(true);
  });
});

describe('uses of a variable', () => {
  it('counts where the name means the variable, not an input of the same name', () => {
    const c = everywhere();
    const uses = variableUses(c, 'WS');
    expect(uses.reduce((n, u) => n + u.count, 0)).toBe(17);
    expect(useCounts(c).get('WS')).toBe(17);
    expect(useCounts(c).get('HOST')).toBe(2);
    // ${NAME} is the input of the action and the value of the schedule: never a use of a variable NAME
    expect(variableUses(c, 'NAME')).toEqual([]);
    expect(useCounts(c).has('NAME')).toBe(false);
  });
});

describe('renameVariable', () => {
  it('renames everywhere by default, keeping the order of the variables', () => {
    const c = everywhere();
    const next = renameVariable(c, 'WS', 'ROOT');
    expect(Object.keys(next.variables)).toEqual(['ROOT', 'URL', 'HOST']);
    expect(next.trays[0]!.action).toMatchObject({ run: 'echo ${ROOT} ${NAME} ${TC_FILE}', cwd: '${ROOT}' });
    expect(useCounts(next).get('ROOT')).toBe(17);
    expect(c.variables.WS).toBe('C:/ws'); // the original is not touched
  });

  it('only the places chosen, or none', () => {
    const c = everywhere();
    const some = renameVariable(c, 'WS', 'ROOT', ['trays[0].label', 'trays[0].offAction']);
    expect(some.trays[0]!.label).toBe('${ROOT} tray');
    expect(some.trays[0]!.offAction).toBe('stop ${ROOT}');
    expect((some.trays[0]!.action as { cwd: string }).cwd).toBe('${WS}');
    const none = renameVariable(c, 'WS', 'ROOT', []);
    expect(none.variables.ROOT).toBe('C:/ws');
    expect(none.trays[0]!.label).toBe('${WS} tray');
  });

  it('renames a secret and leaves inputs of the same name alone', () => {
    const c = everywhere();
    const next = renameVariable(c, 'TOKEN', 'API_KEY');
    expect(next.secrets).toEqual(['API_KEY']);
    expect((next.trays[0]!.action as { env: Record<string, string> }).env.AUTH).toBe('${API_KEY}');
    const shadow = renameVariable(config({ variables: { NAME: 'n' }, trays: [{ id: 'a', label: '${NAME}', action: { run: '${NAME}', inputs: [{ name: 'NAME' }] } }] }), 'NAME', 'WHO');
    expect(shadow.trays[0]!.label).toBe('${WHO}');
    expect((shadow.trays[0]!.action as { run: string }).run).toBe('${NAME}');
    expect(shadow.secrets).toBeUndefined();
  });
});

describe('undefined references', () => {
  it('reports names with no value where they are written', () => {
    const refs = undefinedReferences(everywhere());
    expect(refs.map((r) => `${r.path} ${r.name}`)).toEqual(['trays[0].menu[1].action MISSING']);
    const tc = undefinedReferences(config({ trays: [{ id: 'a', label: 'A', action: 'echo ${TC_FILE} ${HOME}' }] }));
    expect(tc[0]!.message).toContain('only in runs started by a folder watch');
    expect(tc[1]!.message).toContain('is not a variable');
    expect(undefinedReason('X', new Set(['X']), [])).toBeUndefined();
    expect(undefinedReason('X', new Set(), ['X'])).toBeUndefined();
  });

  it('are warnings of the configuration, never errors', () => {
    const r = parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'echo ${HOME}' }] });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings).toEqual([{ path: 'trays[0].action', message: '${HOME} is not a variable: it is left as written (fine if it is meant for the shell)' }]);
  });
});

describe('secrets in the configuration', () => {
  it('a name listed twice, or both a variable and a secret, is an error', () => {
    const twice = parseConfig({ version: 2, secrets: ['A', 'A'] });
    expect(!twice.ok && twice.issues).toEqual([{ path: 'secrets[1]', message: 'The secret "A" is listed twice' }]);
    const both = parseConfig({ version: 2, variables: { A: 'x' }, secrets: ['A'] });
    expect(!both.ok && both.issues[0]!.message).toBe('"A" is both a variable and a secret: keep only one');
    expect(parseConfig({ version: 2, secrets: ['bad name'] }).ok).toBe(false);
    expect(parseConfig({ version: 2, secrets: ['A'], trays: [{ id: 'a', label: '${A}' }] })).toMatchObject({ ok: true, warnings: [] });
  });
});

/* ---------------- engine ---------------- */

const ok = (stdout = '', stderr = ''): RunResult => ({ code: 0, stdout, stderr, durationMs: 1, timedOut: false, killed: false });

function engineWith(input: Partial<ConfigInput>, secrets: Record<string, string>, responder: (script: string, o: RunOptions) => RunResult = () => ok()) {
  const calls: { script: string; options: RunOptions }[] = [];
  const logs: ExecutionLog[] = [];
  const notify = vi.fn();
  const confirm = vi.fn(async () => true);
  const deps: EngineDeps = {
    run: async (script, options) => {
      calls.push({ script, options });
      return responder(script, options);
    },
    runAdmin: async () => ok(),
    notify,
    confirm,
    log: (l) => logs.push(l),
    env: {},
    platform: 'win32',
    recheckDelay: 1,
  };
  const engine = new Engine(deps);
  engine.load(config(input), 'C:\\cfg', secrets);
  return { engine, calls, logs, notify, confirm };
}

describe('Engine with secrets', () => {
  it('uses the value in scripts and hides it in everything shown or logged', async () => {
    const { engine, calls, logs, notify, confirm } = engineWith(
      {
        secrets: ['TOKEN', 'EMPTY'],
        variables: { URL: 'https://api?t=${TOKEN}' },
        trays: [{ id: 'a', label: 'Use ${TOKEN}', action: { run: 'curl ${URL} ${EMPTY}', env: { AUTH: '${TOKEN}' }, notify: 'Sent ${TOKEN}', confirm: 'Send ${TOKEN}?' } }],
      },
      { TOKEN: 's3cr3t', OTHER: 'not declared' },
      () => ok('got s3cr3t back', 'err s3cr3t'),
    );
    await engine.click('a');
    expect(calls[0]!.script).toBe('curl https://api?t=s3cr3t ');
    expect(calls[0]!.options.env).toEqual({ AUTH: 's3cr3t' });
    expect(confirm).toHaveBeenCalledWith('Use ••••', 'Send ••••?', 'Run');
    expect(logs[0]).toMatchObject({ label: 'Use ••••', stdout: 'got •••• back', stderr: 'err ••••', script: 'curl ${URL} ${EMPTY}' });
    expect(notify).toHaveBeenCalledWith('Use ••••', 'Sent ••••', 'info');
    // a name that is not declared as a secret is not a variable
    expect(engine.expandText('${OTHER}')).toBe('${OTHER}');
    expect(engine.redact('a s3cr3t b', ['b'])).toBe('a •••• ••••');
  });

  it('hides the longest value first, so that a secret inside another one leaves nothing behind', () => {
    const { engine } = engineWith({ secrets: ['SHORT', 'LONG'] }, { SHORT: 'abc', LONG: 'xxabcxx' });
    expect(engine.redact('xxabcxx abc')).toBe('•••• ••••');
  });

  it('the editor test hides secrets and typed passwords', async () => {
    const prompt = vi.fn(async () => ({ PW: 'hunter2' }));
    const { engine } = engineWith({ secrets: ['TOKEN'] }, { TOKEN: 'abc123' }, () => ok('abc123 hunter2', 'abc123'));
    (engine as unknown as { deps: EngineDeps }).deps.prompt = prompt;
    const r = await engine.test({ run: 'x', inputs: [{ name: 'PW', type: 'password' }] });
    expect(r).toMatchObject({ stdout: '•••• ••••', stderr: '••••', error: undefined });
    const failed = engineWith({ secrets: ['TOKEN'] }, { TOKEN: 'abc123' }, () => ({ ...ok(), code: null, error: 'cannot run abc123' }));
    expect((await failed.engine.test({ run: 'x' })).error).toBe('cannot run ••••');
  });
});

/* ---------------- export & import ---------------- */

describe('secrets in exports', () => {
  it('travel as names only, selected with the variables', () => {
    const c = config({ variables: { A: '1' }, secrets: ['TOKEN'], trays: [{ id: 't', label: 'T', action: 'x ${TOKEN}' }] });
    expect(sectionKeys(c, 'variables')).toEqual(['A', 'TOKEN']);
    const sel = defaultExportSelection(c);
    const pack = buildExport(c, sel).pack;
    expect(pack.secrets).toEqual(['TOKEN']);
    expect(JSON.stringify(pack)).not.toContain('s3cr3t');
    expect(packCount(pack)).toBe(3);
    // the tray needs the secret: left out, it is listed
    const without = { ...sel, variables: new Set(['A']) };
    expect(buildExport(c, without).pack.secrets).toBeUndefined();
    expect(exportDependencies(c, without).variables).toEqual([{ name: 'TOKEN', by: 'T' }]);
    expect(exportDependencies(config({ variables: { U: '${TOKEN}' }, secrets: ['TOKEN'] }), { ...sel, variables: new Set(['U']) }).variables).toEqual([{ name: 'TOKEN', by: '${U}' }]);
    // a name that is neither a variable nor a secret (shell syntax) is not something to export
    const shell = config({ trays: [{ id: 't', label: 'T', action: 'echo ${HOME}' }] });
    expect(exportDependencies(shell, defaultExportSelection(shell)).variables).toEqual([]);
  });

  it('are imported as names, to be given a value here', () => {
    const read = readPack({ traycommandExport: 1, trays: [], variables: {}, secrets: ['TOKEN', 'KNOWN', 'PLAIN'], settings: {} });
    expect(read.ok).toBe(true);
    const pack = (read as { pack: Pack }).pack;
    const here = config({ variables: { PLAIN: 'p' }, secrets: ['KNOWN'] });
    const plan = planImport(here, pack, noChoices());
    expect(plan.variables).toEqual([
      { name: 'TOKEN', value: undefined, current: undefined, status: 'new', checked: true, secret: true },
      { name: 'KNOWN', value: undefined, current: undefined, status: 'same', checked: false, secret: true },
      { name: 'PLAIN', value: undefined, current: undefined, status: 'same', checked: false, secret: true },
    ]);
    expect(plan.config.secrets).toEqual(['KNOWN', 'TOKEN']);
    expect(planImport(config(), pack, { ...noChoices(), variables: { TOKEN: false } }).config.secrets).toEqual(['KNOWN', 'PLAIN']);
    // a whole configuration file brings its secrets too
    const file = readPack({ version: 2, secrets: ['S'] });
    expect(file.ok && file.pack.secrets).toEqual(['S']);
    const noSecrets = readPack({ version: 2 });
    expect(noSecrets.ok && noSecrets.pack.secrets).toBeUndefined();
  });
});

/* ---------------- the encrypted store ---------------- */

/** A stand-in for safeStorage: reversible, and failing on data it did not write. */
const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (t) => Buffer.from(`enc:${t}`),
  decrypt: (b) => {
    const s = b.toString();
    if (!s.startsWith('enc:')) throw new Error('not ours');
    return s.slice(4);
  },
});

describe('SecretStore', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-secrets-'));
    dirs.push(d);
    return path.join(d, 'data', 'secrets.json');
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('keeps the values encrypted in its own file', () => {
    const file = tmp();
    const store = new SecretStore(file, fakeCipher());
    expect(store.available).toBe(true);
    expect(store.apply([])).toEqual({ ok: true });
    expect(store.apply([{ op: 'set', name: 'A', value: 'one' }, { op: 'set', name: 'B', value: 'two' }, { op: 'rename', from: 'B', to: 'C' }, { op: 'rename', from: 'none', to: 'D' }, { op: 'delete', name: 'A' }])).toEqual({ ok: true });
    expect(store.names()).toEqual(['C']);
    expect(store.read(['A', 'C'])).toEqual({ C: 'two' });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('two');
    expect(JSON.parse(raw)).toEqual({ version: 1, values: { C: Buffer.from('enc:two').toString('base64') } });
    // read again from the file
    expect(new SecretStore(file, fakeCipher()).get('C')).toBe('two');
  });

  it('ignores what it cannot read, refuses values it cannot protect', () => {
    const file = tmp();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ version: 1, values: { X: Buffer.from('plain').toString('base64'), N: 5 } })}`);
    const store = new SecretStore(file, fakeCipher(false));
    expect(store.names()).toEqual([]);
    expect(store.get('X')).toBeUndefined();
    expect(store.get('N')).toBeUndefined();
    expect(store.available).toBe(false);
    expect(store.apply([{ op: 'set', name: 'A', value: 'v' }])).toEqual({ ok: false, error: 'Secrets cannot be stored safely on this system (no encryption available for this user)' });
    expect(store.apply([{ op: 'delete', name: 'X' }])).toEqual({ ok: true });
    const broken = new SecretStore(tmp(), { ...fakeCipher(), available: () => { throw new Error('no keyring'); } });
    expect(broken.available).toBe(false);
    fs.writeFileSync(file, 'not json');
    expect(new SecretStore(file, fakeCipher()).names()).toEqual([]);
    fs.writeFileSync(file, 'null');
    expect(new SecretStore(file, fakeCipher()).names()).toEqual([]);
  });

  it('reports a file that cannot be written and changes nothing', () => {
    const file = tmp();
    const store = new SecretStore(file, fakeCipher());
    store.apply([{ op: 'set', name: 'A', value: 'one' }]);
    fs.mkdirSync(`${file}.tmp`); // the temporary file cannot be created
    const r = store.apply([{ op: 'set', name: 'A', value: 'two' }]);
    expect(r.ok).toBe(false);
    expect(store.get('A')).toBe('one');
  });
});
