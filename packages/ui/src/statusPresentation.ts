import type { BillStatus, LeaseStatus, OrganizationStatus, TenantStatus, UnitStatus } from '@propvault/types';

/**
 * Status is never signalled by colour alone (accessibility requirement in the brief) — every
 * consumer of this map also renders `label` and `icon`, colour is a third reinforcing signal.
 */
export interface StatusPresentation {
  label: string;
  icon: 'check' | 'dot' | 'alert-triangle' | 'eye' | 'spinner' | 'flag' | 'slash';
  colorToken:
    | 'statusPaid'
    | 'statusUnpaid'
    | 'statusOverdue'
    | 'statusNeedsReview'
    | 'statusProcessing'
    | 'statusDisputed'
    | 'statusVoid';
}

export const BILL_STATUS_PRESENTATION: Record<BillStatus, StatusPresentation> = {
  paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
  unpaid: { label: 'Unpaid', icon: 'dot', colorToken: 'statusUnpaid' },
  partially_paid: { label: 'Partially paid', icon: 'dot', colorToken: 'statusNeedsReview' },
  overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
  needs_review: { label: 'Needs review', icon: 'eye', colorToken: 'statusNeedsReview' },
  processing: { label: 'Processing', icon: 'spinner', colorToken: 'statusProcessing' },
  disputed: { label: 'Disputed', icon: 'flag', colorToken: 'statusDisputed' },
  void: { label: 'Void', icon: 'slash', colorToken: 'statusVoid' },
};

// DESIGN_SYSTEM.md's own "Needs extending" note (M19 introduced organizations.status usage in
// the Super Admin directory/subscriptions UI with no presentation map yet -- CustomersTable.tsx/
// SubscriptionsTable.tsx previously used an inline STATUS_TONE map keyed on the OLD PropVault-era
// per-user subscription statuses, which don't overlap with OrganizationStatus's real values
// (trial/overdue/suspended/archived would all have rendered unstyled). Added here instead of
// perpetuating the inline-map pattern.
export const ORGANIZATION_STATUS_PRESENTATION: Record<OrganizationStatus, StatusPresentation> = {
  trial: { label: 'Trial', icon: 'eye', colorToken: 'statusProcessing' },
  active: { label: 'Active', icon: 'check', colorToken: 'statusPaid' },
  overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
  suspended: { label: 'Suspended', icon: 'slash', colorToken: 'statusOverdue' },
  cancelled: { label: 'Cancelled', icon: 'slash', colorToken: 'statusVoid' },
  archived: { label: 'Archived', icon: 'dot', colorToken: 'statusVoid' },
};

// TASKS.md M20 (Units vertical slice). vacant = needs attention (revenue not being collected),
// occupied = healthy/generating revenue, maintenance = active work in progress -- same semantic
// mapping as BILL_STATUS_PRESENTATION's needs_review/paid/processing.
export const UNIT_STATUS_PRESENTATION: Record<UnitStatus, StatusPresentation> = {
  vacant: { label: 'Vacant', icon: 'eye', colorToken: 'statusNeedsReview' },
  occupied: { label: 'Occupied', icon: 'check', colorToken: 'statusPaid' },
  maintenance: { label: 'Maintenance', icon: 'spinner', colorToken: 'statusProcessing' },
};

// TASKS.md M20 (Tenants vertical slice). `status` is server-set only (defaults to `pending` on
// create, transitions on lease approval/expiry -- packages/validation/src/leasing.ts's
// tenantSchema deliberately excludes it from client input), never user-editable here, but still
// needs a presentation for the list/detail views.
export const TENANT_STATUS_PRESENTATION: Record<TenantStatus, StatusPresentation> = {
  pending: { label: 'Pending', icon: 'eye', colorToken: 'statusNeedsReview' },
  active: { label: 'Active', icon: 'check', colorToken: 'statusPaid' },
  expired: { label: 'Expired', icon: 'dot', colorToken: 'statusVoid' },
};

// TASKS.md M20 (Leases vertical slice). draft = not yet started (needs attention/action before
// it's real), active = healthy, expired = lapsed naturally, terminated = ended early/deliberately
// -- distinguished from `expired` since it's a materially different (often adverse) outcome.
export const LEASE_STATUS_PRESENTATION: Record<LeaseStatus, StatusPresentation> = {
  draft: { label: 'Draft', icon: 'eye', colorToken: 'statusNeedsReview' },
  active: { label: 'Active', icon: 'check', colorToken: 'statusPaid' },
  expired: { label: 'Expired', icon: 'dot', colorToken: 'statusVoid' },
  terminated: { label: 'Terminated', icon: 'flag', colorToken: 'statusDisputed' },
};
