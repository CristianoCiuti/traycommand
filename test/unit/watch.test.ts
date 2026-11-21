import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileMatcher, globError, patternList, splitPatterns } from '../../src/shared/glob';
import { daysText, describeWindow, inWindow, nextWindowChange, parseWindow, windowError, windowed } from '../../src/shared/window';
import { FolderWatch, type FileChange } from '../../src/main/watcher';
import { Engine } from '../../src/main/engine';
import { ConfigSchema, parseConfig } from '../../src/shared/config';
import type { RunOptions, RunResult } from '../../src/main/runner';
import type { ExecutionLog } from '../../src/shared/api';

const at = (s: string) => new Date(s);
const ok = (): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false });

describe('file patterns', () => {
  it('matches names in any folder, or paths with "/"', () => {
    const m = fileMatcher(['*.txt', 'report-??.{csv,xlsx}', 'in/**/*.log']);
    expect(m('a.txt')).toBe(true);
    expect(m('sub/deep/b.TXT')).toBe(true);
    expect(m('a.txt.tmp')).toBe(false);
    expect(m('report-01.csv')).toBe(true);
    expect(m('report-001.csv')).toBe(false);
    expect(m('report-02.xlsx')).toBe(true);
    expect(m('in/x.log')).toBe(true);
    expect(m('in/a/b/x.log')).toBe(true);
    expect(m('out/x.log')).toBe(false);
    expect(fileMatcher([])('anything.bin')).toBe(true);
    expect(fileMatcher(['[!~]*.docx'])('~$lock.docx')).toBe(false);
    expect(fileMatcher(['[!~]*.docx'])('letter.docx')).toBe(true);
    expect(fileMatcher(['*.TXT'], false)('a.txt')).toBe(false);
  });
  it('splits lists and reports bad patterns', () => {
    expect(splitPatterns('*.txt, *.{csv,xlsx} ,a.pdf')).toEqual(['*.txt', '*.{csv,xlsx}', 'a.pdf']);
    expect(patternList(['*.a', ' '])).toEqual(['*.a']);
    expect(patternList(undefined)).toEqual([]);
    expect(globError('*.{a,b')).toMatch(/Unclosed/);
    expect(globError('[abc')).toMatch(/Unclosed/);
    expect(globError('*.txt')).toBeUndefined();
  });
});

describe('time windows', () => {
  it('daytime window on weekdays', () => {
    const w = parseWindow('08:30-18:00', 'mon-fri')!;
    expect(inWindow(w, at('2026-11-20T08:29:59'))).toBe(false); // Friday
    expect(inWindow(w, at('2026-11-20T08:30:00'))).toBe(true);
    expect(inWindow(w, at('2026-11-20T17:59:59'))).toBe(true);
    expect(inWindow(w, at('2026-11-20T18:00:00'))).toBe(false);
    expect(inWindow(w, at('2026-11-21T10:00:00'))).toBe(false); // Saturday
    expect(nextWindowChange(w, at('2026-11-20T12:00:00'))).toEqual(at('2026-11-20T18:00:00'));
    expect(nextWindowChange(w, at('2026-11-20T18:00:00'))).toEqual(at('2026-11-23T08:30:00'));
  });
  it('a window across midnight belongs to the day it starts', () => {
    const w = parseWindow('22:00-06:00', 'fri')!;
    expect(inWindow(w, at('2026-11-20T23:00:00'))).toBe(true); // Friday night
    expect(inWindow(w, at('2026-11-21T05:59:00'))).toBe(true); // Saturday morning, still Friday's window
    expect(inWindow(w, at('2026-11-21T23:00:00'))).toBe(false); // Saturday night
    expect(inWindow(w, at('2026-11-20T05:00:00'))).toBe(false); // Friday morning = Thursday's window
  });
  it('days only, 24:00 and errors', () => {
    expect(inWindow(parseWindow(undefined, 'sat,sun'), at('2026-11-21T00:00:00'))).toBe(true);
    expect(inWindow(parseWindow(undefined, 'sat,sun'), at('2026-11-20T23:59:00'))).toBe(false);
    expect(inWindow(parseWindow('20:00-24:00'), at('2026-11-20T23:59:59'))).toBe(true);
    expect(inWindow(undefined, new Date())).toBe(true);
    expect(windowError('9-18')).toEqual({ between: expect.stringMatching(/not a time/) });
    expect(windowError('09:00-09:00')).toEqual({ between: 'Start and end are the same time' });
    expect(windowError('09:00-25:00')?.between).toMatch(/not a time/);
    expect(windowError(undefined, 'funday')?.days).toMatch(/not valid for days/);
    expect(windowError('09:00-18:00', 'mon-fri')).toBeUndefined();
  });
  it('describes and writes days', () => {
    expect(describeWindow('09:00-18:00', 'mon-fri')).toBe('from 09:00 to 18:00 on weekdays');
    expect(describeWindow('22:00-06:00')).toBe('from 22:00 to 06:00 (next day)');
    expect(describeWindow(undefined, 'mon,wed,sat')).toBe('on Mon, Wed, Sat');
    expect(daysText([1, 2, 3, 4, 5])).toBe('mon-fri');
    expect(daysText([0, 6])).toBe('sun,sat');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBeUndefined();
  });
  it('restricts the runs of a schedule to the window', () => {
    const w = parseWindow('09:00-10:00', 'mon-fri');
    const every20m = (from: number) => Math.floor(from / 1_200_000) * 1_200_000 + 1_200_000;
    const next = windowed(w, every20m);
    const fmt = (t: number | undefined) => t && new Date(t).toTimeString().slice(0, 5) + ' ' + new Date(t).getDay();
    // Friday 10:30 → Monday 09:00
    expect(fmt(next(at('2026-11-20T10:30:00').getTime()))).toBe('09:00 1');
    expect(fmt(next(at('2026-11-23T09:00:00').getTime()))).toBe('09:20 1');
  });
});

describe('folder watch', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-watch-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const watchFor = (o: Partial<ConstructorParameters<typeof FolderWatch>[0]> = {}) => {
    const changes: FileChange[][] = [];
    const states: (string | undefined)[] = [];
    const w = new FolderWatch({
      dir,
      match: fileMatcher(['*.txt']),
      subfolders: false,
      events: new Set(['add', 'change', 'remove']),
      settleMs: 150,
      retryMs: 100,
      onChanges: (c) => changes.push(c),
      onState: (e) => states.push(e),
      ...o,
    });
    return { w, changes, states };
  };
  const rel = (c: FileChange[][]) => c.map((batch) => batch.map((x) => `${x.event}:${path.relative(dir, x.file).replace(/\\/g, '/')}`));

  it('reports added, changed and removed matching files once per burst', async () => {
    const { w, changes } = watchFor();
    w.start();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1');
    fs.writeFileSync(path.join(dir, 'skip.csv'), '1');
    fs.appendFileSync(path.join(dir, 'a.txt'), '2');
    await vi.waitFor(() => expect(rel(changes)).toEqual([['add:a.txt']]), { timeout: 3000 });
    fs.appendFileSync(path.join(dir, 'a.txt'), '3333');
    await vi.waitFor(() => expect(rel(changes)).toEqual([['add:a.txt'], ['change:a.txt']]), { timeout: 3000 });
    fs.renameSync(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'));
    await vi.waitFor(() => expect(rel(changes).at(-1)!.sort()).toEqual(['add:b.txt', 'remove:a.txt']), { timeout: 3000 });
    w.close();
  });

  it('only the chosen events, sub folders, files already there', async () => {
    fs.writeFileSync(path.join(dir, 'old.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'sub'));
    const { w, changes } = watchFor({ events: new Set(['add']), subfolders: true });
    w.start(true);
    expect(rel(changes)).toEqual([['add:old.txt']]);
    fs.writeFileSync(path.join(dir, 'sub', 'deep.txt'), 'x');
    fs.unlinkSync(path.join(dir, 'old.txt'));
    await vi.waitFor(() => expect(rel(changes)).toEqual([['add:old.txt'], ['add:sub/deep.txt']]), { timeout: 3000 });
    w.close();
  });

  it('waits for a folder that does not exist yet', async () => {
    const missing = path.join(dir, 'later');
    const { w, changes, states } = watchFor({ dir: missing });
    w.start();
    expect(w.error).toBe('Folder not found');
    expect(states).toEqual(['Folder not found']);
    fs.mkdirSync(missing);
    await vi.waitFor(() => expect(w.error).toBeUndefined(), { timeout: 3000 });
    fs.writeFileSync(path.join(missing, 'n.txt'), 'x');
    await vi.waitFor(() => expect(changes.length).toBe(1), { timeout: 3000 });
    w.close();
  });
});

describe('watch schedules in the engine', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-engine-watch-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function setup(schedule: object, run: (script: string, o: RunOptions) => Promise<RunResult> = async () => ok()) {
    const calls: { script: string; env: Record<string, string | undefined> }[] = [];
    const logs: ExecutionLog[] = [];
    const engine = new Engine({
      run: async (script, o) => {
        calls.push({ script, env: { ...o.env } });
        return run(script, o);
      },
      runAdmin: async () => ok(),
      notify: () => undefined,
      confirm: async () => false,
      log: (l) => logs.push(l),
      env: {},
      platform: process.platform,
      startupDelay: 1,
      watchRetry: 100,
    });
    const config = { version: 2 as const, trays: [{ id: 'w', label: 'W', action: { run: 'process ${TC_FILE_NAME}', confirm: 'Sure?' }, schedules: [schedule] }] };
    expect(parseConfig(config).ok).toBe(true);
    engine.load(ConfigSchema.parse(config), dir);
    return { engine, calls, logs };
  }

  it('runs once per new file, one after the other, with the file in variables; never asks', async () => {
    let running = 0;
    let max = 0;
    const { engine, calls, logs } = setup({ watch: { path: '.', files: '*.txt', settle: '1s' } }, async () => {
      max = Math.max(max, ++running);
      await new Promise((r) => setTimeout(r, 50));
      running--;
      return ok();
    });
    engine.start();
    expect(engine.status(engine.get('w')!).watches).toEqual([{ index: 0, path: dir, state: 'watching', error: undefined }]);
    fs.writeFileSync(path.join(dir, 'one.txt'), '1');
    fs.writeFileSync(path.join(dir, 'two.txt'), '2');
    fs.writeFileSync(path.join(dir, 'no.csv'), '3');
    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 5000 });
    expect(max).toBe(1);
    expect(calls.map((c) => c.script).sort()).toEqual(['process one.txt', 'process two.txt']);
    const one = calls.find((c) => c.script.endsWith('one.txt'))!;
    expect(one.env.TC_FILE).toBe(path.join(dir, 'one.txt'));
    expect(one.env.TC_EVENT).toBe('add');
    expect(one.env.TC_WATCH_DIR).toBe(dir);
    await vi.waitFor(() => expect(logs.map((l) => l.source)).toEqual(['watch', 'watch']));
    expect(logs[0]!.inputs).toMatchObject({ TC_EVENT: 'add' });
    engine.stop();
  });

  it('batch: one run for the files arriving together', async () => {
    const { engine, calls } = setup({ watch: { path: dir, files: ['*.txt'], batch: true, settle: '1s' } });
    engine.start();
    fs.writeFileSync(path.join(dir, 'a.txt'), '1');
    fs.writeFileSync(path.join(dir, 'b.txt'), '2');
    await vi.waitFor(() => expect(calls.length).toBe(1), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.length).toBe(1);
    expect(calls[0]!.env.TC_FILES!.split('\n').map((f) => path.basename(f)).sort()).toEqual(['a.txt', 'b.txt']);
    engine.stop();
  });

  it('files already there, outside the time window, paused', async () => {
    fs.writeFileSync(path.join(dir, 'ready.txt'), '1');
    const now = new Date();
    const closed = `${String((now.getHours() + 2) % 24).padStart(2, '0')}:00-${String((now.getHours() + 3) % 24).padStart(2, '0')}:00`;
    const outside = setup({ watch: { path: dir, files: '*.txt', existing: true, settle: '1s' }, between: closed });
    outside.engine.start();
    expect(outside.engine.status(outside.engine.get('w')!).watches![0]!.state).toBe('waiting');
    fs.writeFileSync(path.join(dir, 'late.txt'), '1');
    await new Promise((r) => setTimeout(r, 1600));
    expect(outside.calls).toEqual([]);
    outside.engine.stop();

    const inside = setup({ watch: { path: dir, files: '*.txt', existing: true, settle: '1s' } });
    inside.engine.start();
    await vi.waitFor(() => expect(inside.calls.map((c) => c.script).sort()).toEqual(['process late.txt', 'process ready.txt']), { timeout: 3000 });
    inside.engine.setSchedulesPaused(true);
    expect(inside.engine.status(inside.engine.get('w')!).watches![0]!.state).toBe('waiting');
    fs.writeFileSync(path.join(dir, 'paused.txt'), '1');
    await new Promise((r) => setTimeout(r, 1600));
    expect(inside.calls.length).toBe(2);
    inside.engine.stop();
  });

  it('reports a missing folder in the status', async () => {
    const { engine } = setup({ watch: { path: 'nope', settle: '1s' } });
    engine.start();
    expect(engine.status(engine.get('w')!).watches![0]).toMatchObject({ state: 'error', error: 'Folder not found', path: path.join(dir, 'nope') });
    engine.stop();
  });
});

describe('watch and window validation', () => {
  it('reports wrong watches and windows', () => {
    const bad = parseConfig({
      version: 2,
      trays: [
        {
          id: 'a',
          label: 'A',
          action: 'x',
          schedules: [
            { watch: { path: ' ', files: '*.{a', events: [], settle: '2x' } },
            { every: '1m', between: '9-18', days: 'xyz' },
            { watch: { path: 'C:\\in' }, every: '5m' },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
    const messages = bad.ok ? [] : bad.issues.map((i) => `${i.path}: ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        'trays[0].schedules[0].watch.path: Choose the folder to watch',
        expect.stringMatching(/^trays\[0\]\.schedules\[0\]\.watch\.files: Unclosed/),
        'trays[0].schedules[0].watch.events: Choose at least one event',
        expect.stringMatching(/^trays\[0\]\.schedules\[0\]\.watch\.settle:/),
        expect.stringMatching(/^trays\[0\]\.schedules\[1\]\.between: "9" is not a time/),
        expect.stringMatching(/^trays\[0\]\.schedules\[1\]\.days:/),
        'trays[0].schedules[2]: Set exactly one of cron, every, startup or watch',
      ]),
    );
  });
});
