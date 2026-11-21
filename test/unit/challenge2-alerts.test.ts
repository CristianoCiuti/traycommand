/* Second adversarial round on the fixes of schedule alerts (editor logic). */
import { describe, expect, it } from 'vitest';
import type { Alert } from '../../src/shared/config';
import { defaultIndex, renameChoice, timeoutOf } from '../../src/shared/scheduleForm';

describe('challenge2: editor', () => {
  it('typing a label that passes through the default label (default on a later button) does not move the default', () => {
    // the default is the SECOND button; the first is retyped and briefly gets the same label
    let a: Alert = { text: 'x', timeout: '1m', default: 'Run', choices: [{ label: 'R', action: 'later' }, { label: 'Run', run: 'self' }] };
    a = renameChoice(a, 0, 'Ru');
    a = renameChoice(a, 0, 'Run');
    a = renameChoice(a, 0, 'Run ');
    a = renameChoice(a, 0, 'Run later');
    expect(defaultIndex(a)).toBe(1);
    expect(a.default).toBe('Run');
  });

  it('typing a timeout in seconds keeps the digits typed (no normalisation while typing)', () => {
    // the editor keeps the number as typed and the unit chosen; the file gets timeoutOf(number, unit)
    let field = { n: '6', unit: 's' as const };
    const type = (n: string) => (field = { ...field, n });
    type(field.n + '0'); // "60"
    expect(timeoutOf(field.n, field.unit)).toBe('60s');
    type(field.n + '5'); // "605"
    expect(timeoutOf(field.n, field.unit)).toBe('605s');
    expect(timeoutOf('', 'm')).toBeUndefined();
    expect(timeoutOf('0', 'm')).toBeUndefined();
    expect(timeoutOf('2.6', 'h')).toBe('3h');
  });
});
