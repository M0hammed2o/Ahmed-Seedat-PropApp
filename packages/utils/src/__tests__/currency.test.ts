import { describe, expect, it } from 'vitest';
import { formatSouthAfricanNumber } from '../currency';

describe('formatSouthAfricanNumber', () => {
  it('uses deterministic South African grouping independent of host ICU data', () => {
    expect(formatSouthAfricanNumber(155000)).toBe('155\u00a0000');
  });

  it('uses a comma decimal separator and trims optional trailing zeroes', () => {
    expect(formatSouthAfricanNumber(13800.5)).toBe('13\u00a0800,5');
    expect(formatSouthAfricanNumber(13800.5, { minimumFractionDigits: 2 })).toBe(
      '13\u00a0800,50',
    );
  });

  it('preserves negative values and rounds to the configured precision', () => {
    expect(formatSouthAfricanNumber(-1234.567)).toBe('-1\u00a0234,57');
  });
});
