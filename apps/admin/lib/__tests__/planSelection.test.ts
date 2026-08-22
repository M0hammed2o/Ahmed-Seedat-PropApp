import { describe, expect, it } from 'vitest';
import { parsePlanSelection, buildChoosePlanSelfPath } from '../planSelection';

describe('parsePlanSelection', () => {
  it('accepts every valid tier/interval combination', () => {
    expect(parsePlanSelection('starter', 'monthly')).toEqual({ tier: 'starter', interval: 'monthly' });
    expect(parsePlanSelection('professional', 'annual')).toEqual({
      tier: 'professional',
      interval: 'annual',
    });
    expect(parsePlanSelection('business', 'monthly')).toEqual({ tier: 'business', interval: 'monthly' });
  });

  it('defaults an invalid/unrecognized plan tier to null rather than trusting it', () => {
    expect(parsePlanSelection('enterprise', 'monthly')).toEqual({ tier: null, interval: 'monthly' });
    expect(parsePlanSelection('<script>alert(1)</script>', 'monthly').tier).toBeNull();
  });

  it('defaults an invalid/unrecognized interval to null rather than trusting it', () => {
    expect(parsePlanSelection('starter', 'weekly')).toEqual({ tier: 'starter', interval: null });
    expect(parsePlanSelection('starter', 'yearly').interval).toBeNull();
  });

  it('defaults both to null when neither param is present (generic signup)', () => {
    expect(parsePlanSelection(undefined, undefined)).toEqual({ tier: null, interval: null });
  });

  it('never throws on an empty-string or garbage value', () => {
    expect(() => parsePlanSelection('', '')).not.toThrow();
    expect(parsePlanSelection('', '')).toEqual({ tier: null, interval: null });
  });
});

describe('buildChoosePlanSelfPath', () => {
  it('builds a bare path with no query when nothing was selected', () => {
    expect(buildChoosePlanSelfPath({ tier: null, interval: null })).toBe('/onboarding/choose-plan');
  });

  it('carries a validated tier + interval as query params', () => {
    expect(buildChoosePlanSelfPath({ tier: 'professional', interval: 'annual' })).toBe(
      '/onboarding/choose-plan?plan=professional&interval=annual',
    );
  });

  it('carries only whichever of tier/interval is present', () => {
    expect(buildChoosePlanSelfPath({ tier: 'starter', interval: null })).toBe(
      '/onboarding/choose-plan?plan=starter',
    );
    expect(buildChoosePlanSelfPath({ tier: null, interval: 'monthly' })).toBe(
      '/onboarding/choose-plan?interval=monthly',
    );
  });

  it('never produces a value safeNextPathOr would reject -- always root-relative, single leading slash, no scheme', () => {
    const path = buildChoosePlanSelfPath({ tier: 'business', interval: 'monthly' });
    expect(path.startsWith('/')).toBe(true);
    expect(path.startsWith('//')).toBe(false);
    expect(path).not.toContain('://');
  });
});
