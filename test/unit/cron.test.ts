import { describe, expect, it } from 'vitest';
import { cronError, describeCron, describeInterval, nextCron, nextCronRuns, parseCron, parseInterval } from '../../src/shared/cron';

const at = (s: string) => new Date(s);
const fmt = (d: Date | undefined) =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('cron', () => {
  it('parses lists, ranges, steps and names', () => {
    const s = parseCron('*/15 9-17 * JAN,mar mon-fri');
    expect([...s.minute]).toEqual([0, 15, 30, 45]);
    expect([...s.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.month]).toEqual([1, 3]);
    expect([...s.dow]).toEqual([1, 2, 3, 4, 5]);
    expect(s.domAny).toBe(true);
    expect(s.dowAny).toBe(false);
    expect([...parseCron('5/20 * * * 7').minute]).toEqual([5, 25, 45]);
    expect([...parseCron('0 0 * * 7').dow]).toEqual([0]);
  });

  it('reports readable errors', () => {
    expect(cronError('* * *')).toMatch(/5 fields/);
    expect(cronError('60 * * * *')).toMatch(/minute must be between 0 and 59/);
    expect(cronError('* * * * xyz')).toMatch(/not valid for day of week/);
    expect(cronError('*/0 * * * *')).toMatch(/Invalid step/);
    expect(cronError('5-1 * * * *')).toMatch(/backwards/);
    expect(cronError('@daily')).toBeUndefined();
  });

  it('computes the next run strictly after the given time', () => {
    const weekdays9 = parseCron('0 9 * * 1-5');
    expect(fmt(nextCron(weekdays9, at('2026-11-20T08:59:30')))).toBe('2026-11-20 09:00'); // Friday
    expect(fmt(nextCron(weekdays9, at('2026-11-20T09:00:00')))).toBe('2026-11-23 09:00'); // → Monday
    expect(fmt(nextCron(parseCron('*/10 * * * *'), at('2026-11-20T10:05:00')))).toBe('2026-11-20 10:10');
    expect(fmt(nextCron(parseCron('0 0 1 * *'), at('2026-12-15T12:00:00')))).toBe('2027-01-01 00:00');
    expect(fmt(nextCron(parseCron('0 12 29 2 *'), at('2026-03-01T00:00:00')))).toBe('2028-02-29 12:00');
  });

  it('day of month OR day of week when both are restricted', () => {
    const s = parseCron('0 8 1 * 1');
    // 2026-12-01 is a Tuesday (day 1), 2026-11-30 is a Monday
    expect(fmt(nextCron(s, at('2026-11-25T00:00:00')))).toBe('2026-11-30 08:00');
    expect(fmt(nextCron(s, at('2026-11-30T09:00:00')))).toBe('2026-12-01 08:00');
  });

  it('lists the next runs', () => {
    expect(nextCronRuns('30 7 * * *', 3, at('2026-11-20T08:00:00')).map(fmt)).toEqual(['2026-11-21 07:30', '2026-11-22 07:30', '2026-11-23 07:30']);
  });

  it('describes common expressions', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('At 09:00 on weekdays');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *')).toBe('Every hour');
    expect(describeCron('30 18 * * 5')).toBe('At 18:30 on Friday');
    expect(describeCron('0 8,13 * * 1,3,5')).toBe('At 08:00, 13:00 on Mon, Wed, Fri');
    expect(describeCron('0 0 1 * *')).toBe('At 00:00 on day 1 of the month');
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours at :00');
    expect(describeCron('bad')).toBe('Invalid expression');
  });
});

describe('intervals', () => {
  it('parses units', () => {
    expect(parseInterval('30s')).toBe(30);
    expect(parseInterval('15m')).toBe(900);
    expect(parseInterval('2h')).toBe(7200);
    expect(parseInterval('1d')).toBe(86400);
    expect(parseInterval('1h30m')).toBe(5400);
    expect(parseInterval('15')).toBeUndefined();
    expect(parseInterval('m')).toBeUndefined();
    expect(parseInterval('0m')).toBeUndefined();
  });
  it('describes intervals', () => {
    expect(describeInterval(900)).toBe('Every 15 minutes');
    expect(describeInterval(3600)).toBe('Every hour');
    expect(describeInterval(5400)).toBe('Every 1 hour 30 minutes');
  });
});
