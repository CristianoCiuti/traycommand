/* The less common paths of cron, shortcuts and fuzzy search. */
import { describe, expect, it } from 'vitest';
import { cronError, describeCron, describeInterval, nextCronRuns, parseCron } from '../../src/shared/cron';
import { canonicalHotkey, formatHotkey, hotkeyError, hotkeyFromEvent, hotkeyKeys, parseHotkey } from '../../src/shared/hotkey';
import { fold, fuzzyMatch } from '../../src/shared/fuzzy';
import { expand } from '../../src/shared/variables';

describe('variables details', () => {
  it('an environment variable that is not set is empty', () => {
    expect(expand('[${env:TC_SURELY_NOT_SET}]', { variables: {}, env: {}, configDir: '' })).toBe('[]');
  });
});

describe('cron details', () => {
  it('parsing', () => {
    expect(cronError('1,,2 * * * *')).toMatch(/Empty value in minute/);
    expect([...parseCron('* * * * 1/2').dow]).toEqual([1, 3, 5]);
    expect(nextCronRuns('0 0 30 2 *', 3)).toEqual([]); // February 30th
  });

  it('descriptions', () => {
    expect(describeCron('* * * * *')).toBe('Every minute');
    expect(describeCron('* 9-10 * * *')).toBe('Every minute during 09:00, 10:00');
    expect(describeCron('*/15 9-17 * * *')).toBe('Every 15 minutes from 09:00 to 17:59');
    expect(describeCron('30 * * * *')).toBe('Every hour at :30');
    expect(describeCron('5,35 1,2,3,4 * * *')).toBe('At minute 5,35 of hour 1,2,3,4');
    expect(describeCron('0,10,25 9 * * *')).toBe('At 09:00, 09:10, 09:25');
    expect(describeCron('0,15,30 9 * * *')).toBe('At 09:00, 09:15, 09:30');
    expect(describeCron('0 9 * * 0,6')).toBe('At 09:00 on weekends');
    expect(describeCron('0 9 * * 1,2')).toBe('At 09:00 on Mon, Tue');
    expect(describeCron('0 9 * * 1-3')).toBe('At 09:00 on Mon–Wed');
    expect(describeCron('0 9 1 * 1')).toBe('At 09:00 on Monday or on day 1 of the month');
    expect(describeCron('0 9 1 1,7 *')).toBe('At 09:00 on day 1 of the month in January, July');
    expect(describeInterval(0)).toBe('Every 0 seconds');
  });
});

describe('shortcut details', () => {
  it('parsing, canonical form, keycaps', () => {
    expect(parseHotkey('Ctrl+Alt+,').accelerator).toBe('Ctrl+Alt+,');
    expect(hotkeyError('+Ctrl+K')).toMatch(/not a valid shortcut/);
    expect(canonicalHotkey('nope')).toBeUndefined();
    expect(hotkeyKeys('Ctrl+Banana')).toEqual(['Ctrl+Banana']);
    expect(hotkeyKeys('Ctrl+Alt+Shift+Super+Up', 'darwin')).toEqual(['⌃', '⌥', '⇧', '⌘', '↑']);
    expect(hotkeyKeys('Super+K', 'linux')).toEqual(['Super', 'K']);
    expect(hotkeyKeys('CommandOrControl+K', 'win32')).toEqual(['Ctrl', 'K']);
    expect(hotkeyKeys('Alt+Shift+F2', 'win32')).toEqual(['Alt', 'Shift', 'F2']);
    expect(hotkeyKeys('Super+K', 'darwin')).toEqual(['⌘', 'K']);
    expect(formatHotkey('Ctrl+PageDown')).toBe('Ctrl+PgDn');
  });

  it('recording by physical key', () => {
    const e = { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(hotkeyFromEvent({ ...e, code: 'Digit5', ctrlKey: true })).toBe('Ctrl+5');
    expect(hotkeyFromEvent({ ...e, code: 'Numpad3', altKey: true })).toBe('Alt+num3');
    expect(hotkeyFromEvent({ ...e, code: 'F11' })).toBe('F11');
    expect(hotkeyFromEvent({ ...e, code: 'KeyA', shiftKey: true, metaKey: true })).toBe('Shift+Super+A');
    expect(hotkeyFromEvent({ ...e, code: 'KeyA', ctrlKey: true }, 'darwin')).toBe('Ctrl+A');
    expect(hotkeyFromEvent({ ...e, code: 'Unknown' })).toBeUndefined();
  });
});

describe('fuzzy details', () => {
  it('folding keeps positions', () => {
    expect(fold('가')).toBe('가'); // decomposes into two letters: kept as is
    expect(fold('İx')).toHaveLength(2);
  });

  it('empty queries, consecutive letters, matches in the path only', () => {
    expect(fuzzyMatch('', 'x')).toEqual({ score: 0, label: [] });
    expect(fuzzyMatch('  ', 'x')).toEqual({ score: 0, label: [] });
    // the second letter is right after the first one, not at a word start
    expect(fuzzyMatch('cmp', 'xcmzp')!.label).toEqual([1, 2, 4]);
    expect(fuzzyMatch('ab', 'xaxb')!.label).toEqual([1, 3]);
    // found in the path, not in the label: no highlight
    expect(fuzzyMatch('dock', 'Up', 'Docker')).toEqual({ score: expect.any(Number), label: [] });
    // found in both, the path matches much better
    expect(fuzzyMatch('dkr', 'xdxkxrx', 'dkr')!.label).toEqual([]);
  });
});
