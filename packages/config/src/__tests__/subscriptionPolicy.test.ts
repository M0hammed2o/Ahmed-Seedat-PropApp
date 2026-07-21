import { describe, expect, it } from 'vitest';
import { canRead, canWrite, getAccessMode } from '../subscriptionPolicy';

describe('subscriptionPolicy', () => {
  it('keeps read access for expired/billing_issue/grace_period subscribers (never deletes access)', () => {
    expect(getAccessMode('expired')).toBe('read_only');
    expect(getAccessMode('billing_issue')).toBe('read_only');
    expect(getAccessMode('grace_period')).toBe('read_only');
    expect(canRead('expired')).toBe(true);
    expect(canWrite('expired')).toBe(false);
  });

  it('blocks read entirely for revoked/unknown', () => {
    expect(canRead('revoked')).toBe(false);
    expect(canRead('unknown')).toBe(false);
  });

  it('allows full read/write for trialing/active', () => {
    expect(canWrite('trialing')).toBe(true);
    expect(canWrite('active')).toBe(true);
  });
});
