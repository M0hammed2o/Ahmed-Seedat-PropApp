import { describe, expect, it } from 'vitest';
import { normalizePhoneToE164 } from '../phone';

describe('normalizePhoneToE164', () => {
  it('normalizes a bare South African local number to E.164', () => {
    expect(normalizePhoneToE164('0821234567')).toBe('+27821234567');
  });

  it('normalizes a South African number with spaces and dashes', () => {
    expect(normalizePhoneToE164('082 123-4567')).toBe('+27821234567');
    expect(normalizePhoneToE164('082-123 4567')).toBe('+27821234567');
  });

  it('accepts an already-E.164 South African number unchanged', () => {
    expect(normalizePhoneToE164('+27821234567')).toBe('+27821234567');
  });

  it('accepts a non-South African E.164 number -- international support is preserved', () => {
    expect(normalizePhoneToE164('+14155552671')).toBe('+14155552671');
    expect(normalizePhoneToE164('+442071838750')).toBe('+442071838750');
  });

  it('rejects a South African number with the wrong digit count', () => {
    expect(normalizePhoneToE164('08212345')).toBeNull(); // too short
    expect(normalizePhoneToE164('082123456789')).toBeNull(); // too long
  });

  it('rejects garbage input', () => {
    expect(normalizePhoneToE164('not-a-phone-number')).toBeNull();
    expect(normalizePhoneToE164('')).toBeNull();
    expect(normalizePhoneToE164('   ')).toBeNull();
  });

  it('rejects a malformed E.164-looking value (leading zero after +, or too long)', () => {
    expect(normalizePhoneToE164('+0821234567')).toBeNull();
    expect(normalizePhoneToE164('+1234567890123456')).toBeNull();
  });

  it('rejects an international number missing the leading +', () => {
    expect(normalizePhoneToE164('14155552671')).toBeNull();
  });
});
