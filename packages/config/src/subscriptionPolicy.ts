import type { SubscriptionStatus } from '@propvault/types';

export type AccessMode = 'full' | 'read_only' | 'blocked';

/**
 * Central decision (see DECISIONS.md, 2026-07-21): lapsing subscribers keep read access to
 * documents they already uploaded. Change this map, not scattered `if (status === ...)`
 * branches, to alter policy.
 */
const ACCESS_BY_STATUS: Record<SubscriptionStatus, AccessMode> = {
  unknown: 'blocked',
  trialing: 'full',
  active: 'full',
  grace_period: 'read_only',
  billing_issue: 'read_only',
  expired: 'read_only',
  cancelled: 'read_only',
  revoked: 'blocked',
};

export function getAccessMode(status: SubscriptionStatus): AccessMode {
  return ACCESS_BY_STATUS[status];
}

export function canWrite(status: SubscriptionStatus): boolean {
  return getAccessMode(status) === 'full';
}

export function canRead(status: SubscriptionStatus): boolean {
  return getAccessMode(status) !== 'blocked';
}
