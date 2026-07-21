import { describe, expect, it } from 'vitest';
import { hasEntitlement } from '../entitlements';

describe('hasEntitlement', () => {
  it('denies everything when there is no subscription', () => {
    expect(hasEntitlement('upload_document', { subscription: null })).toBe(false);
  });

  it('allows upload for an active subscriber', () => {
    expect(
      hasEntitlement('upload_document', {
        subscription: { status: 'active', planId: 'propvault_base' },
      }),
    ).toBe(true);
  });

  it('denies writes for an expired subscriber (read-only mode)', () => {
    expect(
      hasEntitlement('upload_document', {
        subscription: { status: 'expired', planId: 'propvault_base' },
      }),
    ).toBe(false);
  });

  it('denies add_property once the plan limit is reached', () => {
    expect(
      hasEntitlement('add_property', {
        subscription: { status: 'active', planId: 'propvault_base' },
        currentPropertyCount: 10,
      }),
    ).toBe(false);
  });

  it('allows add_property below the plan limit', () => {
    expect(
      hasEntitlement('add_property', {
        subscription: { status: 'active', planId: 'propvault_base' },
        currentPropertyCount: 3,
      }),
    ).toBe(true);
  });

  it('denies everything for an unknown plan id', () => {
    expect(
      hasEntitlement('upload_document', {
        subscription: { status: 'active', planId: 'nonexistent_plan' },
      }),
    ).toBe(false);
  });
});
