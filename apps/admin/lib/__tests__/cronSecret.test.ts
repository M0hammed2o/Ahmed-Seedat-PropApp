import { describe, expect, it } from 'vitest';
import { cronSecretMatches } from '../cronSecret';

describe('cron secret comparison (TD-68)', () => {
  it('matches only the exact secret and never when unset', () => {
    expect(cronSecretMatches('s3cret-value', 's3cret-value')).toBe(true);
    expect(cronSecretMatches('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(cronSecretMatches('s3cret', 's3cret-value')).toBe(false);
    expect(cronSecretMatches('', '')).toBe(false);
    expect(cronSecretMatches('anything', undefined)).toBe(false);
    expect(cronSecretMatches(null, 'x')).toBe(false);
  });
});
