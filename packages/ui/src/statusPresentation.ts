import type {
  ApplicationDecision,
  ApplicationScreeningStatus,
  ApplicationStatus,
  BankTransactionMatchStatus,
  BillStatus,
  ExpenseStatus,
  InspectionConditionRating,
  InspectionStatus,
  InvoiceStatus,
  LeaseStatus,
  MaintenancePriority,
  MaintenanceStatus,
  OrganizationStatus,
  OwnerStatementStatus,
  RentScheduleStatus,
  TenantStatus,
  UnitStatus,
} from '@propvault/types';

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

// TASKS.md M20 (Maintenance vertical slice). Mirrors the evidenced Maintenance Board's 4-column
// kanban order (PROPVIEW_SCREENSHOT_AUDIT.md IMG_7967-7968) exactly -- to_do/in_progress/
// pending_approval/completed, same order as MAINTENANCE_STATUSES and MAINTENANCE_TRANSITIONS
// (apps/admin/lib/operations.ts).
export const MAINTENANCE_STATUS_PRESENTATION: Record<MaintenanceStatus, StatusPresentation> = {
  to_do: { label: 'To do', icon: 'eye', colorToken: 'statusNeedsReview' },
  in_progress: { label: 'In progress', icon: 'spinner', colorToken: 'statusProcessing' },
  pending_approval: { label: 'Pending approval', icon: 'alert-triangle', colorToken: 'statusUnpaid' },
  completed: { label: 'Completed', icon: 'check', colorToken: 'statusPaid' },
};

export const MAINTENANCE_PRIORITY_PRESENTATION: Record<MaintenancePriority, StatusPresentation> = {
  low: { label: 'Low', icon: 'dot', colorToken: 'statusVoid' },
  medium: { label: 'Medium', icon: 'dot', colorToken: 'statusProcessing' },
  high: { label: 'High', icon: 'alert-triangle', colorToken: 'statusNeedsReview' },
  urgent: { label: 'Urgent', icon: 'alert-triangle', colorToken: 'statusOverdue' },
};

// TASKS.md M20 (Applications vertical slice). Application.status tracks the workflow stage
// (submitted -> screening -> decided); the eventual outcome is a separate field (`decision`),
// since "decided" alone doesn't say approved or declined.
// V1 simplification (2026-08-01, DECISIONS.md): 'submitted' relabeled "New" to match the
// simplified New -> Reviewing -> Approved/Declined/Withdrawn workflow language; 'reviewing' and
// 'withdrawn' are new values. 'screening'/'decided' remain mapped (the enum still has them,
// 'screening' is dormant/never set by V1 UI) but callers should prefer a decision-aware display
// helper over this map directly for 'decided' rows -- see ApplicationsTable/ApplicationActions'
// own `applicationDisplayPresentation()`, which shows the actual decision (Approved/Declined)
// instead of the generic "Decided" label below.
export const APPLICATION_STATUS_PRESENTATION: Record<ApplicationStatus, StatusPresentation> = {
  submitted: { label: 'New', icon: 'eye', colorToken: 'statusNeedsReview' },
  reviewing: { label: 'Reviewing', icon: 'spinner', colorToken: 'statusProcessing' },
  screening: { label: 'Screening', icon: 'spinner', colorToken: 'statusProcessing' },
  decided: { label: 'Decided', icon: 'check', colorToken: 'statusPaid' },
  withdrawn: { label: 'Withdrawn', icon: 'slash', colorToken: 'statusVoid' },
};

export const APPLICATION_SCREENING_STATUS_PRESENTATION: Record<ApplicationScreeningStatus, StatusPresentation> = {
  not_started: { label: 'Not started', icon: 'dot', colorToken: 'statusVoid' },
  in_progress: { label: 'In progress', icon: 'spinner', colorToken: 'statusProcessing' },
  passed: { label: 'Passed', icon: 'check', colorToken: 'statusPaid' },
  failed: { label: 'Failed', icon: 'alert-triangle', colorToken: 'statusOverdue' },
};

export const APPLICATION_DECISION_PRESENTATION: Record<ApplicationDecision, StatusPresentation> = {
  approved: { label: 'Approved', icon: 'check', colorToken: 'statusPaid' },
  declined: { label: 'Declined', icon: 'slash', colorToken: 'statusOverdue' },
};

/**
 * The status badge every application list/detail view should actually render: once `decided`,
 * shows the real outcome (Approved/Declined) via APPLICATION_DECISION_PRESENTATION instead of the
 * generic "Decided" label APPLICATION_STATUS_PRESENTATION.decided carries (that label exists only
 * because a Record<ApplicationStatus, ...> must cover every enum value, not because "Decided" is
 * ever the right thing to show a user).
 */
export function applicationDisplayPresentation(app: {
  status: ApplicationStatus;
  decision: ApplicationDecision | null;
}): StatusPresentation {
  if (app.status === 'decided' && app.decision) {
    return APPLICATION_DECISION_PRESENTATION[app.decision];
  }
  return APPLICATION_STATUS_PRESENTATION[app.status];
}

// TASKS.md M20 (Inspections vertical slice).
export const INSPECTION_STATUS_PRESENTATION: Record<InspectionStatus, StatusPresentation> = {
  scheduled: { label: 'Scheduled', icon: 'eye', colorToken: 'statusNeedsReview' },
  in_progress: { label: 'In progress', icon: 'spinner', colorToken: 'statusProcessing' },
  awaiting_signature: { label: 'Awaiting signature', icon: 'alert-triangle', colorToken: 'statusUnpaid' },
  completed: { label: 'Completed', icon: 'check', colorToken: 'statusPaid' },
};

export const INSPECTION_CONDITION_RATING_PRESENTATION: Record<InspectionConditionRating, StatusPresentation> = {
  good: { label: 'Good', icon: 'check', colorToken: 'statusPaid' },
  fair: { label: 'Fair', icon: 'dot', colorToken: 'statusProcessing' },
  poor: { label: 'Poor', icon: 'alert-triangle', colorToken: 'statusNeedsReview' },
  damaged: { label: 'Damaged', icon: 'alert-triangle', colorToken: 'statusOverdue' },
};

// TASKS.md M20 (Accounting vertical slice — Rent Due / Expenses / Trial Balance).
export const RENT_SCHEDULE_STATUS_PRESENTATION: Record<RentScheduleStatus, StatusPresentation> = {
  pending: { label: 'Pending', icon: 'eye', colorToken: 'statusNeedsReview' },
  invoiced: { label: 'Invoiced', icon: 'spinner', colorToken: 'statusProcessing' },
  paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
  overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
  partial: { label: 'Partial', icon: 'dot', colorToken: 'statusNeedsReview' },
};

export const EXPENSE_STATUS_PRESENTATION: Record<ExpenseStatus, StatusPresentation> = {
  pending: { label: 'Pending', icon: 'eye', colorToken: 'statusNeedsReview' },
  recorded: { label: 'Recorded', icon: 'check', colorToken: 'statusPaid' },
  reimbursed: { label: 'Reimbursed', icon: 'check', colorToken: 'statusPaid' },
  void: { label: 'Void', icon: 'slash', colorToken: 'statusVoid' },
};

export const INVOICE_STATUS_PRESENTATION: Record<InvoiceStatus, StatusPresentation> = {
  draft: { label: 'Draft', icon: 'eye', colorToken: 'statusNeedsReview' },
  issued: { label: 'Issued', icon: 'spinner', colorToken: 'statusProcessing' },
  paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
};

// TASKS.md M20 (Payments/bank-matching vertical slice).
export const BANK_TRANSACTION_MATCH_STATUS_PRESENTATION: Record<BankTransactionMatchStatus, StatusPresentation> = {
  unmatched: { label: 'Unmatched', icon: 'eye', colorToken: 'statusNeedsReview' },
  matched: { label: 'Matched', icon: 'check', colorToken: 'statusPaid' },
  ignored: { label: 'Ignored', icon: 'slash', colorToken: 'statusVoid' },
};

// TASKS.md M14 part 3 (Owner Statements), same draft/issued/paid shape as InvoiceStatus.
export const OWNER_STATEMENT_STATUS_PRESENTATION: Record<OwnerStatementStatus, StatusPresentation> = {
  draft: { label: 'Draft', icon: 'eye', colorToken: 'statusNeedsReview' },
  issued: { label: 'Issued', icon: 'spinner', colorToken: 'statusProcessing' },
  paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
};
