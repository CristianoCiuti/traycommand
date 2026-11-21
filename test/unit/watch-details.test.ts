/*
 * Folder watches and time windows with a fake fs.watch and a simulated clock: every path of the
 * watcher and of the engine's schedule code, deterministic (no waiting on real file system events).
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderWatch, type FileChange, type FolderWatchOptions } from '../../src/main/watcher';
import { Engine, type EngineDeps } from '../../src/main/engine';
import { ConfigSchema, type ConfigInput } from '../../src/shared/config';
import { fileMatcher, globError, globToRegExp } from '../../src/shared/glob';
import { describeDays, describeWindow, inWindow, nextWindowChange, nextWindowStart, parseBetween, parseDays, parseWindow, windowed, type TimeWindow } from '../../src/shared/window';
import type { RunResult } from '../../src/main/runner';
import type { ExecutionLog } from '../../src/shared/api';

const ok = (): RunResult => ({ code: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, killed: false });

/** A controllable fs.watch: `fire(name)` delivers an event, `fail(err)` an error. */
function fakeWatch() {
  const watchers: { dir: string; options: { recursive: boolean }; listener: (t: string, n: string | null) => void; emitter: EventEmitter; closed: boolean }[] = [];
  const watchFn: NonNullable<FolderWatchOptions['watchFn']> = (dir, options, listener) => {
    const emitter = new EventEmitter();
    const w = { dir, options, listener: listener as (t: string, n: string | null) => void, emitter, closed: false };
    watchers.push(w);
    return {
      on: ((event: string, fn: (...a: unknown[]) => void) => {
        emitter.on(event, fn);
        return undefined as never;
      }) as never,
      close: () => {
        w.closed = true;
      },
    };
  };
  const open = () => watchers.filter((w) => !w.closed);
  return {
    watchFn,
    watchers,
    open,
    fire: (name: string | null) => open().forEach((w) => w.listener('rename', name)),
    fail: (error: unknown) => open().forEach((w) => w.emitter.emit('error', error)),
  };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-watch-details-'));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, data = 'x') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), data);
};

describe('FolderWatch with a fake fs.watch', () => {
  function make(o: Partial<FolderWatchOptions> = {}) {
    const fake = fakeWatch();
    const changes: FileChange[][] = [];
    const states: (string | undefined)[] = [];
    const w = new FolderWatch({
      dir,
      match: fileMatcher(['*.txt']),
      subfolders: true,
      events: new Set(['add', 'change', 'remove']),
      settleMs: 100,
      retryMs: 1000,
      onChanges: (c) => changes.push(c),
      onState: (e) => states.push(e),
      watchFn: fake.watchFn,
      ...o,
    });
    const rel = () => changes.map((b) => b.map((c) => `${c.event}:${path.relative(dir, c.file).replace(/\\/g, '/')}`).sort());
    return { w, fake, changes, states, rel };
  }

  it('passes the options to fs.watch and collects a burst into one report', async () => {
    vi.useFakeTimers();
    const { w, fake, rel } = make({ subfolders: false });
    w.start();
    expect(fake.watchers[0]).toMatchObject({ dir, options: { recursive: false } });
    write('a.txt');
    fake.fire('a.txt');
    await vi.advanceTimersByTimeAsync(50);
    fake.fire('a.txt'); // the quiet time restarts
    await vi.advanceTimersByTimeAsync(60);
    expect(rel()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    expect(rel()).toEqual([['add:a.txt']]);
    // same size and time: nothing
    fake.fire('a.txt');
    await vi.advanceTimersByTimeAsync(200);
    expect(rel()).toHaveLength(1);
    // sub folder names without "subfolders" are ignored; not matching names too
    write('sub/b.txt');
    write('c.csv');
    fake.fire('sub\\b.txt');
    fake.fire('c.csv');
    await vi.advanceTimersByTimeAsync(200);
    expect(rel()).toHaveLength(1);
    w.close();
  });

  it('an event without a name rescans the folder', async () => {
    vi.useFakeTimers();
    write('gone.txt');
    const { w, fake, rel } = make();
    w.start();
    fs.unlinkSync(path.join(dir, 'gone.txt'));
    write('new.txt');
    write('deep/one.txt');
    fake.fire(null);
    await vi.advanceTimersByTimeAsync(150);
    expect(rel()).toEqual([['add:deep/one.txt', 'add:new.txt', 'remove:gone.txt']]);
    w.close();
  });

  it('folders: copied in, emptied, renamed away, a file replaced by a folder', async () => {
    vi.useFakeTimers();
    write('keep/old.txt');
    write('swap.txt');
    const { w, fake, rel } = make();
    w.start();
    // a folder copied in: one event for the folder
    write('in/a.txt');
    write('in/deep/b.txt');
    fake.fire('in');
    await vi.advanceTimersByTimeAsync(150);
    expect(rel().at(-1)).toEqual(['add:in/a.txt', 'add:in/deep/b.txt']);
    // a file deleted inside a folder, reported only as the folder
    fs.unlinkSync(path.join(dir, 'in', 'a.txt'));
    fake.fire('in');
    await vi.advanceTimersByTimeAsync(150);
    expect(rel().at(-1)).toEqual(['remove:in/a.txt']);
    // a folder renamed away
    fs.renameSync(path.join(dir, 'keep'), path.join(dir, 'kept'));
    fake.fire('keep');
    await vi.advanceTimersByTimeAsync(150);
    expect(rel().at(-1)).toEqual(['remove:keep/old.txt']);
    // a file replaced by a folder with the same name
    fs.unlinkSync(path.join(dir, 'swap.txt'));
    fs.mkdirSync(path.join(dir, 'swap.txt'));
    fake.fire('swap.txt');
    await vi.advanceTimersByTimeAsync(150);
    expect(rel().at(-1)).toEqual(['remove:swap.txt']);
    w.close();
  });

  it('without sub folders a new folder is skipped, a replaced file is still removed', async () => {
    vi.useFakeTimers();
    write('x.txt');
    write('old/inside.txt'); // a folder already there: not scanned
    write('other.csv'); // not matching
    const { w, fake, rel } = make({ subfolders: false });
    w.start();
    fs.mkdirSync(path.join(dir, 'newdir'));
    write('newdir/in.txt');
    fake.fire('newdir');
    fs.unlinkSync(path.join(dir, 'x.txt'));
    fs.mkdirSync(path.join(dir, 'x.txt'));
    fake.fire('x.txt');
    fake.fire('never-there.txt'); // created and deleted within the quiet time
    await vi.advanceTimersByTimeAsync(150);
    expect(rel()).toEqual([['remove:x.txt']]);
    w.close();
  });

  it('the watched folder itself disappears: its files are removed', async () => {
    vi.useFakeTimers();
    write('a.txt');
    const { w, fake, rel } = make();
    w.start();
    fs.rmSync(dir, { recursive: true, force: true });
    fake.fire(null);
    await vi.advanceTimersByTimeAsync(150);
    expect(rel()).toEqual([['remove:a.txt']]);
    w.close();
    fs.mkdirSync(dir);
  });

  it('only the chosen events; files already there only when "add" is chosen', async () => {
    vi.useFakeTimers();
    write('a.txt');
    const onlyRemove = make({ events: new Set(['remove']) });
    onlyRemove.w.start(true);
    expect(onlyRemove.rel()).toEqual([]);
    write('b.txt');
    onlyRemove.fake.fire('b.txt');
    await vi.advanceTimersByTimeAsync(150);
    expect(onlyRemove.rel()).toEqual([]);
    fs.unlinkSync(path.join(dir, 'a.txt'));
    onlyRemove.fake.fire('a.txt');
    await vi.advanceTimersByTimeAsync(150);
    expect(onlyRemove.rel()).toEqual([['remove:a.txt']]);
    onlyRemove.w.close();
    // nothing there: no empty report
    const empty = make();
    fs.rmSync(path.join(dir, 'b.txt'));
    empty.w.start(true);
    empty.w.reportExisting();
    expect(empty.changes).toEqual([]);
    empty.w.close();
  });

  it('errors: messages, retry until the folder works again, nothing after close', async () => {
    vi.useFakeTimers();
    const { w, fake, states } = make();
    w.start();
    expect(states).toEqual([undefined]);
    fake.fail(Object.assign(new Error('x'), { code: 'EPERM' }));
    expect(w.error).toBe('Access denied');
    expect(fake.open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.error).toBeUndefined();
    expect(fake.open()).toHaveLength(1);
    fake.fail(Object.assign(new Error('x'), { code: 'EACCES' }));
    expect(w.error).toBe('Access denied');
    await vi.advanceTimersByTimeAsync(1000);
    fake.fail(new Error('Something else'));
    expect(w.error).toBe('Something else');
    await vi.advanceTimersByTimeAsync(1000);
    fake.fail('plain');
    expect(w.error).toBe('plain');
    const last = fake.watchers.at(-1)!;
    w.close();
    last.emitter.emit('error', new Error('late')); // an error after close: no retry
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.open()).toHaveLength(0);
    // after close nothing restarts or reports
    w.start();
    expect(fake.open()).toHaveLength(0);
    expect(states.at(-1)).toBe('plain');
  });

  it('a path that is a file, a missing folder, the default retry delay, events after close', async () => {
    vi.useFakeTimers();
    write('file.txt');
    const onFile = make({ dir: path.join(dir, 'file.txt') });
    onFile.w.start();
    expect(onFile.w.error).toBe('Not a folder');
    onFile.w.close();
    const missing = make({ dir: path.join(dir, 'nope'), retryMs: undefined });
    missing.w.start();
    expect(missing.w.error).toBe('Folder not found');
    fs.mkdirSync(path.join(dir, 'nope'));
    await vi.advanceTimersByTimeAsync(4900);
    expect(missing.w.error).toBe('Folder not found');
    await vi.advanceTimersByTimeAsync(200);
    expect(missing.w.error).toBeUndefined();
    // an event arriving after close, and a flush already scheduled
    write('nope/late.txt');
    missing.fake.fire('late.txt');
    missing.w.close();
    missing.fake.watchers.at(-1)!.listener('rename', 'late.txt');
    await vi.advanceTimersByTimeAsync(500);
    expect(missing.changes).toEqual([]);
  });

  it('a junction to a folder matching the pattern is not a file', () => {
    fs.mkdirSync(path.join(dir, 'target'));
    try {
      fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link.txt'), 'junction');
    } catch {
      return; // no links on this system
    }
    const { w, changes } = make({ subfolders: false });
    w.start(true);
    expect(changes).toEqual([]);
    w.close();
  });
});

describe('glob and window details', () => {
  it('pattern forms', () => {
    expect(globToRegExp('**').test('a/b/c')).toBe(true);
    expect(globToRegExp('a/**').test('a/b/c.txt')).toBe(true);
    expect(globToRegExp('./x.txt').test('x.txt')).toBe(true);
    expect(globToRegExp('a}b').test('a}b')).toBe(true);
    expect(globToRegExp('a,b').test('a,b')).toBe(true);
    expect(globToRegExp('(x)+.txt').test('(x)+.txt')).toBe(true);
    expect(globToRegExp('[a-c].txt').test('b.txt')).toBe(true);
    expect(fileMatcher(['sub\\*.txt'])('sub/a.txt')).toBe(true);
    expect(fileMatcher(['*.txt'])('a\\b.txt')).toBe(true);
    expect(globError('  ')).toBe('Empty pattern');
  });

  it('parsing errors', () => {
    expect(() => parseBetween('09:00')).toThrow(/two times/);
    expect(() => parseBetween('24:00-02:00')).toThrow(/before 24:00/);
    expect(() => parseBetween('24:30-02:00')).toThrow(/not a time/);
    expect(() => parseDays(' ')).toThrow(/No days/);
    expect(parseWindow('bad')).toBeUndefined();
    expect(parseWindow('08:00-09:00', 'sun-sat')!.days).toBeUndefined(); // every day
    expect(describeWindow('bad')).toBe('invalid time window');
    expect(describeWindow()).toBe('');
    expect(describeWindow('08:00-09:00', 'sat,sun')).toBe('from 08:00 to 09:00 on weekends');
    expect(describeWindow(undefined, 'tue')).toBe('on Tue');
    expect(describeWindow(undefined, 'mon-wed,fri,sun')).toBe('on Mon–Wed, Fri, Sun');
    expect(describeDays(new Set([0, 1, 2, 3, 4, 5, 6]))).toBe('every day');
  });

  it('edges of windows', () => {
    const night = parseWindow('22:00-06:00')!;
    expect(inWindow(night, new Date('2026-11-20T12:00:00'))).toBe(false);
    expect(nextWindowChange(night, new Date('2026-11-20T12:00:00'))).toEqual(new Date('2026-11-20T22:00:00'));
    expect(nextWindowChange(night, new Date('2026-11-20T23:00:00'))).toEqual(new Date('2026-11-21T06:00:00'));
    // a window that can never open (no days: only possible when built by hand)
    const never: TimeWindow = { start: 60, end: 120, days: new Set() };
    expect(nextWindowStart(never, new Date())).toBeUndefined();
    expect(nextWindowChange(never, new Date())).toBeUndefined();
    expect(windowed(never, (f) => f + 1000)(Date.now())).toBeUndefined();
    // no next run at all, and a runner that never lands in the window
    expect(windowed(parseWindow('08:00-09:00'), () => undefined)(Date.now())).toBeUndefined();
    const always10 = new Date('2026-11-20T10:00:00').getTime();
    expect(windowed(parseWindow('08:00-09:00'), () => always10)(0)).toBeUndefined();
    expect(windowed(undefined, () => 5)(0)).toBe(5);
  });
});

describe('engine: schedules with a simulated clock', () => {
  function setup(trays: ConfigInput['trays'], extra: Partial<EngineDeps> = {}, run?: (script: string) => Promise<RunResult>) {
    const fake = fakeWatch();
    const calls: { script: string; env: Record<string, string | undefined> }[] = [];
    const logs: ExecutionLog[] = [];
    const deps: EngineDeps = {
      run: async (script, o) => {
        calls.push({ script, env: { ...o.env } });
        return run ? run(script) : ok();
      },
      runAdmin: async () => ok(),
      notify: () => undefined,
      confirm: async () => true,
      log: (l) => logs.push(l),
      env: {},
      platform: 'win32',
      recheckDelay: 1,
      startupDelay: 10,
      watchRetry: 1000,
      watchFn: fake.watchFn,
      ...extra,
    };
    const engine = new Engine(deps);
    const load = (t: ConfigInput['trays']) => engine.load(ConfigSchema.parse({ version: 2, trays: t }), dir);
    load(trays);
    return { engine, calls, logs, fake, load };
  }
  const state = (engine: Engine, id = 'w') => engine.status(engine.get(id)!).watches?.map((w) => w.state);

  it('a watch with a time window: waits, reports the files there when it opens, stops when it closes', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T07:59:50') }); // Monday
    write('ready.txt');
    const { engine, calls, fake } = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: '.', files: '*.txt', existing: true, settle: '1s' }, between: '08:00-09:00', days: 'mon-fri' }] }]);
    engine.start();
    expect(state(engine)).toEqual(['waiting']);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state(engine)).toEqual(['watching']);
    expect(calls.map((c) => c.env.TC_FILE_NAME)).toEqual(['ready.txt']);
    // inside the window: events run
    write('b.txt');
    fake.fire('b.txt');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls.map((c) => c.env.TC_FILE_NAME)).toEqual(['ready.txt', 'b.txt']);
    // after 09:00: waiting, events ignored
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(state(engine)).toEqual(['waiting']);
    write('c.txt');
    fake.fire('c.txt');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
    // Tuesday 08:00 opens again: c.txt is there and is reported
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
    // (the files still in the folder: here nothing moved them away)
    expect(calls.map((c) => c.env.TC_FILE_NAME)).toEqual(['ready.txt', 'b.txt', 'b.txt', 'c.txt', 'ready.txt']);
    expect(calls.map((c) => c.env.TC_EVENT)).toEqual(['add', 'add', 'add', 'add', 'add']);
    engine.stop();
  });

  it('without "existing" the opening of the window reports nothing; while paused neither', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T07:59:50') });
    write('ready.txt');
    const plain = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: '.' }, between: '08:00-09:00' }] }]);
    plain.engine.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(plain.calls).toEqual([]);
    plain.engine.stop();
    vi.setSystemTime(new Date('2026-11-23T07:59:50'));
    const paused = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: '.', existing: true }, between: '08:00-09:00' }] }]);
    paused.engine.setSchedulesPaused(true);
    paused.engine.start();
    expect(state(paused.engine)).toEqual(['waiting']);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(paused.calls).toEqual([]);
    paused.engine.stop();
  });

  it('every and cron within a window: the next run is the first one inside it', () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T17:50:00') }); // Friday
    const { engine } = setup([
      { id: 'every', label: 'E', action: 'e', schedules: [{ every: '20m', between: '08:00-18:00', days: 'mon-fri' }] },
      { id: 'cron', label: 'C', action: 'c', schedules: [{ cron: '0 * * * *', between: '10:00-12:00' }] },
    ]);
    engine.start();
    expect(new Date(engine.status(engine.get('every')!).nextRun!)).toEqual(new Date('2026-11-23T08:10:00'));
    expect(new Date(engine.status(engine.get('cron')!).nextRun!)).toEqual(new Date('2026-11-21T10:00:00'));
    engine.stop();
  });

  it('startup schedules respect their window', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T12:00:00') });
    const { engine, calls } = setup([
      { id: 'in', label: 'In', action: 'in', schedules: [{ startup: true, between: '11:00-13:00' }] },
      { id: 'out', label: 'Out', action: 'out', schedules: [{ startup: true, days: 'sat,sun' }] },
    ]);
    engine.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.map((c) => c.script)).toEqual(['in']);
    engine.stop();
  });

  it('runs of a watch wait for a run in progress; stopping drops the queue', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const { engine, calls, fake } = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: '.', settle: '1s' } }] }], {}, (script) =>
      script === 'go' && calls.length === 1 ? new Promise((r) => (release = () => r(ok()))) : Promise.resolve(ok()),
    );
    engine.start();
    const click = engine.click('w');
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.get('w')!.busy).toBe(true);
    write('a.txt');
    write('b.txt');
    fake.fire('a.txt');
    fake.fire('b.txt');
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(1); // still the click
    release();
    await click;
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.map((c) => c.env.TC_FILE_NAME)).toEqual([undefined, 'a.txt', 'b.txt']);
    // queued runs after a stop are dropped
    let hold!: () => void;
    const slow = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: '.', settle: '1s', events: ['change'] } }] }], {}, () => new Promise((r) => (hold = () => r(ok()))));
    slow.engine.start();
    fs.appendFileSync(path.join(dir, 'a.txt'), 'more');
    fs.appendFileSync(path.join(dir, 'b.txt'), 'more');
    slow.fake.fire('a.txt');
    slow.fake.fire('b.txt');
    await vi.advanceTimersByTimeAsync(1500);
    expect(slow.calls).toHaveLength(1);
    slow.engine.stop();
    hold();
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow.calls).toHaveLength(1);
    expect(slow.calls[0]!.env.TC_EVENT).toBe('change');
  });

  it('a disabled entry or a stopped engine ignores files; disabled shows as waiting', async () => {
    vi.useFakeTimers();
    const { engine, calls, fake } = setup([{ id: 'w', label: 'W', disabled: true, action: 'go', schedules: [{ watch: { path: '.', existing: true, settle: '1s' } }] }]);
    write('a.txt');
    engine.start();
    expect(state(engine)).toEqual(['waiting']);
    fake.fire('a.txt');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([]);
    engine.stop();
  });

  it('reloads: the same watch does not report the files again, a changed one does; rearm keeps one watcher', async () => {
    vi.useFakeTimers();
    write('a.txt');
    const watch = { path: '.', existing: true, settle: '1s' };
    const { engine, calls, fake, load } = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch }] }]);
    engine.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(1);
    load([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch }] }]);
    engine.start();
    expect(calls).toHaveLength(1);
    load([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { ...watch, files: '*.txt' } }] }]);
    engine.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);
    expect(fake.open()).toHaveLength(1);
    engine.rearmSchedules();
    expect(fake.open()).toHaveLength(1);
    engine.stop();
    expect(fake.open()).toHaveLength(0);
    engine.rearmSchedules(); // stopped: nothing
    expect(fake.open()).toHaveLength(0);
  });

  it('a missing folder is reported, retried and then watched', async () => {
    vi.useFakeTimers();
    const { engine, fake } = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ watch: { path: 'later' } }] }]);
    const changes: (string | undefined)[] = [];
    engine.onChange((k) => changes.push(k));
    engine.start();
    expect(engine.status(engine.get('w')!).watches![0]).toMatchObject({ state: 'error', error: 'Folder not found' });
    fs.mkdirSync(path.join(dir, 'later'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state(engine)).toEqual(['watching']);
    expect(fake.open()).toHaveLength(1);
    expect(changes).toContain('trays[0]');
    engine.stop();
  });

  it('invalid or disabled schedules are skipped; unused anchors are dropped', () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T08:00:00') });
    const { engine, fake, load } = setup([
      {
        id: 'w',
        label: 'W',
        action: 'go',
        schedules: [{ every: 'bad' }, { cron: 'bad' }, { watch: { path: '.', files: '*.{x' } }, { every: '10s', disabled: true }, { cron: '0 0 30 2 *' }, { every: '1m' }],
      },
    ]);
    engine.start();
    expect(fake.watchers).toHaveLength(0);
    expect(engine.get('w')!.nextRuns.has(4)).toBe(false); // February 30th never comes
    expect(engine.status(engine.get('w')!).nextRun).toBe(Date.now() + 60_000);
    const anchors = (engine as unknown as { anchors: Map<string, number> }).anchors;
    expect(anchors.size).toBe(1);
    load([{ id: 'w', label: 'W', action: 'go' }]);
    engine.start();
    expect(anchors.size).toBe(0);
    engine.stop();
  });

  it('a long wait is split; when the clock moves the next run is computed again', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T08:00:00') });
    const { engine, calls } = setup([{ id: 'w', label: 'W', action: 'go', schedules: [{ cron: '0 6,12 * * *' }] }]);
    engine.start();
    expect(new Date(engine.status(engine.get('w')!).nextRun!)).toEqual(new Date('2026-11-23T12:00:00'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // one part of the wait
    expect(calls).toEqual([]);
    vi.setSystemTime(new Date('2026-11-23T04:30:00')); // the clock goes back
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(new Date(engine.status(engine.get('w')!).nextRun!)).toEqual(new Date('2026-11-23T06:00:00'));
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(calls).toHaveLength(1);
    engine.stop();
  });

  it('"off" and "right" schedules, a toggle checked first, and a run outside the window', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T08:00:00') });
    const { engine, calls } = setup(
      [
        {
          id: 'w',
          label: 'W',
          action: 'on-run',
          offAction: 'off-run',
          rightAction: 'right-run',
          state: { check: 'check', interval: 3600 },
          schedules: [{ every: '10s', run: 'off' }, { every: '10s', run: 'right' }],
        },
      ],
      {},
      async () => ok(),
    );
    engine.start();
    await vi.advanceTimersByTimeAsync(10_500);
    const scripts = calls.map((c) => c.script);
    expect(scripts).toContain('off-run');
    expect(scripts).toContain('right-run');
    // fired by hand outside its window: nothing
    const before = calls.length;
    await engine.fireSchedule(engine.get('w')!, { every: '10s', between: '20:00-21:00' });
    expect(calls).toHaveLength(before);
    engine.stop();
  });
});
