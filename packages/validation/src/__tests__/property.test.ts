import { describe, expect, it } from 'vitest';
import { propertySchema } from '../property';

describe('propertySchema', () => {
  it('accepts a minimal valid property with defaults', () => {
    const result = propertySchema.safeParse({
      nickname: 'Sea Point Apartment',
      addressLine1: '12 Beach Road',
      city: 'Cape Town',
      propertyType: 'apartment',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe('ZA');
    }
  });

  it('rejects a missing nickname', () => {
    const result = propertySchema.safeParse({
      addressLine1: '12 Beach Road',
      city: 'Cape Town',
      propertyType: 'apartment',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid property type', () => {
    const result = propertySchema.safeParse({
      nickname: 'X',
      addressLine1: '1 Street',
      city: 'Cape Town',
      propertyType: 'castle',
    });
    expect(result.success).toBe(false);
  });
});
