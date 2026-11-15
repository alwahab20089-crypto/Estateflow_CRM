import { describe, expect, it } from 'vitest';
import { addDays, addMonths, endOfDayUtc, fromLocalInput, startOfDayUtc, startOfWeek, toLocalInput, ymdInTz } from './datetime';

describe('datetime', () => {
  it('converts wall-clock time in the organization timezone to UTC and back', () => {
    expect(fromLocalInput('2026-12-01T10:00', 'Asia/Karachi')).toBe('2026-12-01T05:00:00.000Z');
    expect(fromLocalInput('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z'); // summer time
    expect(fromLocalInput('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z'); // winter time
    expect(toLocalInput('2026-12-01T05:00:00.000Z', 'Asia/Karachi')).toBe('2026-12-01T10:00');
    expect(fromLocalInput('', 'UTC')).toBeNull();
    expect(fromLocalInput('not a date', 'UTC')).toBeNull();
  });
  it('finds the local calendar day of an instant', () => {
    expect(ymdInTz(new Date('2026-11-14T20:00:00.000Z'), 'Asia/Karachi')).toBe('2026-11-15'); // already tomorrow in Karachi
    expect(startOfDayUtc('2026-11-14', 'Asia/Karachi').toISOString()).toBe('2026-11-13T19:00:00.000Z');
    expect(endOfDayUtc('2026-11-14', 'Asia/Karachi').toISOString()).toBe('2026-11-14T18:59:59.999Z');
  });
  it('does civil-date arithmetic without drifting', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addMonths('2026-11-14', 2)).toBe('2027-01-01');
    expect(startOfWeek('2026-11-14')).toBe('2026-11-09'); // Saturday -> Monday
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09'); // Sunday -> Monday
  });
});