import { describe, expect, it } from 'vitest';
import {
  betweenOf,
  cleanSchedule,
  cronOf,
  filesText,
  modeOf,
  patchWatch,
  scheduleCardText,
  settleOf,
  settleSeconds,
  timesOf,
  toggleEvent,
  watchEvents,
  watchStateText,
  watchText,
  watchTooltip,
  windowTimes,
  withDays,
  withMode,
  withTimes,
  withWindow,
} from '../../src/shared/scheduleForm';
import { parseConfig } from '../../src/shared/config';
import type { WatchStatus } from '../../src/shared/api';

describe('schedule editor: kinds', () => {
  it('recognises the kind of a schedule', () => {
    expect(modeOf({ watch: { path: 'x' } })).toBe('watch');
    expect(modeOf({ startup: true })).toBe('startup');
    expect(modeOf({ every: '5m' })).toBe('every');
    expect(modeOf({ cron: '0 9 * * 1-5' })).toBe('times');
    expect(modeOf({ cron: '*/5 * * * *' })).toBe('cron');
    expect(modeOf({ cron: 'bad' })).toBe('cron');
  });

  it('switching kind keeps run, values, window and disabled', () => {
    const base = { cron: '0 9 * * *', run: 'on' as const, values: { A: '1' }, between: '08:00-10:00', disabled: true };
    const common = { run: 'on', values: { A: '1' }, between: '08:00-10:00', disabled: true };
    expect(withMode(base, 'every')).toEqual({ ...common, every: '15m' });
    expect(withMode(base, 'startup')).toEqual({ ...common, startup: true });
    expect(withMode(base, 'watch')).toEqual({ ...common, watch: { path: '', files: '*.txt' } });
    expect(withMode(base, 'times')).toEqual({ ...common, cron: '0 9 * * 1-5' });
    expect(withMode(base, 'cron')).toEqual({ ...common, cron: '0 9 * * *' });
    expect(withMode({ every: '1m' }, 'cron')).toEqual({ cron: '*/30 9-18 * * 1-5' });
    expect(cleanSchedule({ every: '1m', between: undefined, days: undefined })).toEqual({ every: '1m' });
  });

  it('"At set times" reads and writes simple crons', () => {
    expect(timesOf('30 8,13 * * 1,3')).toEqual({ times: ['08:30', '13:30'], days: [1, 3] });
    expect(timesOf('0 9 * * *')).toEqual({ times: ['09:00'], days: [0, 1, 2, 3, 4, 5, 6] });
    expect(timesOf('0 9 1 * *')).toBeUndefined();
    expect(timesOf('0,30 9 * * *')).toBeUndefined();
    expect(timesOf('nope')).toBeUndefined();
    expect(cronOf(['08:15', ' 17:45', '25:00', 'x'], [5, 1])).toBe('15 8,17 * * 1,5');
    expect(cronOf([], [])).toBe('0 9 * * *');
    expect(cronOf(['7:05'], [0, 1, 2, 3, 4, 5, 6])).toBe('5 7 * * *');
  });
});

describe('schedule editor: time window', () => {
  it('turns the window on and off', () => {
    expect(withWindow({ every: '1m' }, true)).toEqual({ every: '1m', between: '09:00-18:00', days: 'mon-fri' });
    expect(cleanSchedule(withWindow({ every: '1m', between: '01:00-02:00', days: 'sat' }, false))).toEqual({ every: '1m' });
  });

  it('shows and writes the times; the whole day is no "between"', () => {
    expect(windowTimes('08:30-24:00', true)).toEqual({ from: '08:30', to: '00:00' });
    expect(windowTimes(undefined, true)).toEqual({ from: '00:00', to: '00:00' }); // days only = the whole day
    expect(windowTimes(undefined, false)).toEqual({ from: '09:00', to: '18:00' });
    expect(windowTimes('bad', true)).toEqual({ from: 'bad', to: '00:00' });
    expect(betweenOf('08:00', '17:30')).toBe('08:00-17:30');
    expect(betweenOf('20:00', '00:00')).toBe('20:00-24:00');
    expect(betweenOf('', '')).toBeUndefined();
    expect(betweenOf('00:00', '00:00')).toBeUndefined();
    expect(betweenOf('22:00', '06:00')).toBe('22:00-06:00');
  });

  it('a whole-day window keeps the switch on through the days, and every written value is valid', () => {
    const check = (s: object) => expect(parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', schedules: [s] }] }).ok).toBe(true);
    const wholeDay = withTimes({ every: '1m', between: '09:00-18:00' }, '00:00', '00:00');
    expect(cleanSchedule(wholeDay)).toEqual({ every: '1m', days: 'sun-sat' });
    check(cleanSchedule(wholeDay));
    expect(withTimes({ every: '1m', days: 'mon' }, '', '')).toEqual({ every: '1m', between: undefined, days: 'mon' });
    expect(withTimes({ every: '1m' }, '10:00', '11:00')).toEqual({ every: '1m', between: '10:00-11:00', days: undefined });
    // days
    expect(withDays({ every: '1m', between: '10:00-11:00' }, [])).toBeUndefined();
    expect(withDays({ every: '1m', between: '10:00-11:00' }, [6, 0])).toEqual({ every: '1m', between: '10:00-11:00', days: 'sun,sat' });
    expect(withDays({ every: '1m', between: '10:00-11:00', days: 'mon' }, [0, 1, 2, 3, 4, 5, 6])).toEqual({ every: '1m', between: '10:00-11:00', days: undefined });
    const allDays = withDays({ every: '1m', days: 'mon' }, [0, 1, 2, 3, 4, 5, 6])!;
    expect(allDays).toEqual({ every: '1m', days: 'sun-sat' });
    check(allDays);
    check(withWindow({ every: '1m' }, true));
  });
});

describe('schedule editor: folder watch', () => {
  it('writes only what differs from the defaults', () => {
    const w = { path: 'C:\\in', files: '*.txt' };
    expect(patchWatch(w, { subfolders: true })).toEqual({ ...w, subfolders: true });
    expect(patchWatch({ ...w, subfolders: true, batch: true }, { subfolders: false, files: undefined })).toEqual({ path: 'C:\\in', batch: true });
  });

  it('events: default "add", never empty, in a fixed order', () => {
    expect(watchEvents({ path: 'x' })).toEqual(['add']);
    expect(watchEvents({ path: 'x', events: [] })).toEqual(['add']);
    expect(toggleEvent(['add'], 'remove')).toEqual(['add', 'remove']);
    expect(toggleEvent(['remove', 'add'], 'change')).toEqual(['add', 'change', 'remove']);
    expect(toggleEvent(['add', 'change'], 'change')).toBeUndefined();
    expect(toggleEvent(['add'], 'add')).toBe('unchanged');
    expect(toggleEvent(['add', 'remove'], 'add')).toEqual(['remove']);
  });

  it('files and quiet time fields', () => {
    expect(filesText({ path: 'x', files: ['*.a', '*.b'] })).toBe('*.a, *.b');
    expect(filesText({ path: 'x', files: '*.a' })).toBe('*.a');
    expect(filesText({ path: 'x' })).toBe('');
    expect(settleSeconds({ path: 'x' })).toBe(2);
    expect(settleSeconds({ path: 'x', settle: '1m' })).toBe(60);
    expect(settleSeconds({ path: 'x', settle: 'bad' })).toBe(2);
    expect(settleOf('2')).toBeUndefined();
    expect(settleOf('10')).toBe('10s');
    expect(settleOf('0')).toBeUndefined(); // empty or 0 = the default
    expect(settleOf('-5')).toBe('1s');
    expect(settleOf('99999')).toBe('3600s');
    expect(settleOf('2.6')).toBe('3s');
  });

  it('describes the watch', () => {
    expect(watchText({ path: 'C:\\in', files: '*.txt' })).toBe('When a file *.txt appears in C:\\in');
    expect(watchText({ path: '', files: ['*.a', '*.b'], events: ['add', 'change', 'remove'], subfolders: true })).toBe(
      'When a file *.a or *.b appears, changes or is deleted in (choose a folder) or its sub folders',
    );
    expect(watchText({ path: '${env:X}', events: ['remove'] }, 'C:\\resolved')).toBe('When a file is deleted in C:\\resolved');
  });

  it('state texts, tray tooltip and Schedule card', () => {
    const st = (state: WatchStatus['state'], path = 'C:\\data\\inbox\\', error?: string): WatchStatus => ({ index: 0, path, state, error });
    expect(watchStateText(st('watching'))).toBe('watching now');
    expect(watchStateText(st('waiting'))).toMatch(/^not now/);
    expect(watchStateText(st('error', 'x', 'Folder not found'))).toBe('Folder not found: trying again every few seconds');
    expect(watchTooltip([st('watching'), st('watching', '/home/me/scans')])).toBe('watching inbox, scans');
    expect(watchTooltip([st('watching'), st('error', 'x', 'Access denied')])).toBe('folder watch: Access denied');
    expect(watchTooltip([st('waiting')])).toBeUndefined();
    expect(watchTooltip([])).toBeUndefined();
    const fmt = (t: number) => `T${t}`;
    expect(scheduleCardText(undefined, false, false, fmt)).toBe('Run automatically');
    expect(scheduleCardText({ nextRun: 5 }, false, true, fmt)).toBe('Next run T5');
    expect(scheduleCardText({ watches: [st('watching')] }, false, true, fmt)).toBe('Watching for files');
    expect(scheduleCardText({ nextRun: 5, watches: [st('error', 'x', 'Not a folder')] }, false, true, fmt)).toBe('Folder watch: Not a folder');
    expect(scheduleCardText({ watches: [st('waiting')] }, true, true, fmt)).toBe('Paused from the tray menu');
    expect(scheduleCardText({}, true, false, fmt)).toBe('Run automatically');
  });
});

describe('configuration details', () => {
  it('empty configuration, warnings and messages', async () => {
    const { emptyConfig } = await import('../../src/shared/config');
    expect(emptyConfig().trays).toEqual([]);
    const r = parseConfig({
      version: 2,
      settings: { launcherHotkey: '' },
      trays: [
        { id: 'a', label: 'A', action: { run: 'x', before: ['d:off'] }, offAction: 'y', hotkey: 'Ctrl+Alt+K' },
        { id: 'b', label: 'B', action: { run: 'x', after: ['ghost'] }, hotkey: 'Ctrl+Alt+K', schedules: [{ every: '1m', run: 'off' }, { every: '1m', run: 'click' }] },
        { id: 'c', label: 'C', menu: [], schedules: [{ every: '1m' }] },
        { id: 'd', label: 'D', state: { check: 'c' }, offAction: 'off', schedules: [{ every: '1m' }] },
      ],
    });
    expect(r.ok).toBe(false);
    const issues = r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        'trays[1].hotkey: Shortcut Ctrl+Alt+K is already used by trays[0].hotkey',
        'trays[1].schedules[0].run: Nothing to run: the entry has no offAction',
        'trays[2].schedules[0].run: Nothing to run: the entry has no action',
        'trays[1].action.after[0]: Unknown id "ghost"',
      ]),
    );
    // a toggle with only an offAction can be scheduled ("click" turns it off)
    expect(issues.some((i) => i.startsWith('trays[3]') || i.startsWith('trays[0].action'))).toBe(false);
    const warn = parseConfig({ version: 2, trays: [{ id: 'a', label: 'A', action: 'x', offAction: 'y' }] });
    expect(warn.ok && warn.warnings.map((w) => w.message)).toEqual(['offAction is used only together with state']);
    const zod = parseConfig({ version: 2, trays: [{ id: 'a', label: 7 }] });
    expect(zod.ok ? [] : zod.issues.map((i) => i.path)).toEqual(['trays[0].label']);
  });
});
