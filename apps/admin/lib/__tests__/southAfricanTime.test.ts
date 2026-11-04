import { describe, expect, it } from 'vitest';
import {
  formatSouthAfricanDate,
  southAfricanDateOf,
  southAfricanNow,
  southAfricanToday,
} from '../southAfricanTime';

describe('southAfricanNow / southAfricanToday', () => {
  it('is already 1 November in South Africa at 22:30 UTC on 31 October', () => {
    const instant = new Date('2026-10-31T22:30:00Z');
    const sa = southAfricanNow(instant);
    expect([sa.getFullYear(), sa.getMonth(), sa.getDate(), sa.getHours(), sa.getMinutes()]).toEqual(
      [2026, 10, 1, 0, 30],
    );
    expect(southAfricanToday(instant)).toBe('2026-11-01');
  });

  it('is still 31 October at 21:59 UTC', () => {
    expect(southAfricanToday(new Date('2026-10-31T21:59:59Z'))).toBe('2026-10-31');
  });

  it('rolls the year at SAST midnight', () => {
    const sa = southAfricanNow(new Date('2026-12-31T22:00:00Z'));
    expect([sa.getFullYear(), sa.getMonth(), sa.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('southAfricanDateOf', () => {
  it('converts a UTC timestamptz to its South African date', () => {
    expect(southAfricanDateOf('2026-10-31T22:30:00+00:00')).toBe('2026-11-01');
    expect(southAfricanDateOf('2026-10-31T21:30:00.123Z')).toBe('2026-10-31');
  });

  it('respects an explicit offset in the timestamp', () => {
    expect(southAfricanDateOf('2026-11-01T00:30:00+02:00')).toBe('2026-11-01');
  });

  it('labels a monthly meter snapshot (SAST midnight stored in UTC) with its own month', () => {
    expect(southAfricanDateOf('2026-09-30T22:00:00+00:00').slice(0, 7)).toBe('2026-10');
  });

  it('passes a bare date through unchanged', () => {
    expect(southAfricanDateOf('2026-11-01')).toBe('2026-11-01');
  });
});

describe('formatSouthAfricanDate (client display, hydration-safe)', () => {
  const ORIGINAL_TZ = process.env.TZ;

  it.each(['UTC', 'Africa/Johannesburg', 'America/Los_Angeles', 'Asia/Tokyo'])(
    'gives the South African date either side of SA midnight, whatever the runtime zone (%s)',
    (zone) => {
      process.env.TZ = zone;
      try {
        expect(formatSouthAfricanDate('2026-11-03T21:59:59.999Z')).toBe('2026/11/03');
        expect(formatSouthAfricanDate('2026-11-03T22:00:00Z')).toBe('2026/11/04');
        expect(formatSouthAfricanDate('2026-11-04T00:30:00+02:00')).toBe('2026/11/04');
        expect(formatSouthAfricanDate(new Date('2026-12-31T23:00:00Z'))).toBe('2027/01/01');
      } finally {
        process.env.TZ = ORIGINAL_TZ;
      }
    },
  );

  it('passes a bare calendar date through unchanged', () => {
    expect(formatSouthAfricanDate('2026-02-28')).toBe('2026/02/28');
  });
});
