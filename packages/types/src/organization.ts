import type {
  BillingCycle,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationStatus,
  OrganizationType,
} from './enums';

export interface Organization {
  id: string;
  legalName: string;
  tradingName: string | null;
  orgType: OrganizationType;
  cipcRegNo: string | null;
  vatNo: string | null;
  sarsTaxNo: string | null;
  popiaInformationOfficer: string | null;
  invoicePrefix: string;
  depositInterestPct: number;
  ffcNumber: string | null;
  ffcIssued: string | null;
  ffcExpires: string | null;
  /** Communication branding (Phase 6, WORKLOG.md this date) -- shown in tenant-facing
   * email/WhatsApp templates alongside tradingName (the business display name). */
  supportContactName: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  communicationFooter: string | null;
  /** Final hardening pass, Part "Organisation invoice settings" (migration 154) -- tenant-invoice
   * (public.invoices) presentation fields, distinct from communicationFooter above (that one is
   * for tenant email/WhatsApp templates, this is for the printed/PDF invoice). */
  invoiceAddress: string | null;
  invoicePaymentInstructions: string | null;
  invoiceNotesDefault: string | null;
  invoiceFooter: string | null;
  status: OrganizationStatus;
  /** Set once at org creation (20260101000075) and never cleared -- a historical record of when
   * the 30-day free trial ends/ended, meaningful for UI purposes only while status is 'trial'. */
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OrganizationDraft = Pick<Organization, 'legalName' | 'orgType'>;

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invitedBy: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationInvite {
  id: string;
  orgId: string;
  email: string;
  role: OrganizationMemberRole;
  token: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  billingCycle: BillingCycle;
  basePrice: number;
  currency: string;
  featureLimits: Record<string, number | boolean>;
  isActive: boolean;
  version: number;
  createdAt: string;
}

export interface OrganizationSubscription {
  id: string;
  orgId: string;
  planId: string;
  priceOverride: number | null;
  discountPct: number | null;
  promotionalCredit: number;
  billingCycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextPaymentDate: string | null;
  status: OrganizationStatus;
  createdAt: string;
}

/**
 * Owner subscription + staff seat entitlement architecture (WORKLOG.md this date). Shared
 * cross-platform contract for entitlement state — apps/admin's own `getOrgSeatSummary()` returns
 * exactly this shape (from `org_staff_seat_limit`/`org_active_billable_staff_count`, migration
 * 20260101000094). Not yet consumed by apps/mobile (it has no organization/owner-portal UI
 * today), but defined here — not duplicated ad hoc later — so a future mobile owner/staff screen
 * has one real contract to build against instead of re-deriving this shape from scratch.
 */
export interface OrgSeatSummary {
  /** The org's current plan's feature_limits.maxStaff. null = unlimited. */
  seatLimit: number | null;
  /** Active organization_members rows with role other than 'principal' — the principal is the
   * paying owner, never a billable seat themselves. */
  activeBillableStaffCount: number;
  /** null = unlimited. May be zero or negative once the limit is reached or reduced after staff
   * were already invited. */
  availableSeats: number | null;
}

/**
 * Whether the calling user may create their own organization/portfolio (apps/admin's
 * `mayCreatePortfolio()`, backed by `may_create_portfolio()`, migration 20260101000094). False
 * only for a "linked owner only" account — see that function's own comment for the full
 * reasoning. Exported here for the same forward-compatibility reason as `OrgSeatSummary` above.
 */
export interface OwnerPortfolioEntitlement {
  mayCreatePortfolio: boolean;
}

/**
 * RELEASE A P0 fix (V1 Commercial Launch Gap Audit): the full plan-entitlement snapshot for one
 * organization — apps/admin's `getOrganizationEntitlements()` (subscriptionEntitlements.ts)
 * returns exactly this shape, backed by `org_property_limit()`/`available_property_slots()`/
 * `org_feature_enabled()` (migration 20260101000102). ONE authoritative shape every
 * property-limit/feature-gate check in the app reads from — never re-derived per component.
 */
export interface OrganizationEntitlements {
  /** The org's current plan's feature_limits.maxProperties. null = unlimited. */
  propertyLimit: number | null;
  /** Active (non-archived) properties only — see org_active_property_count()'s own comment. */
  activePropertyCount: number;
  /** null = unlimited. May be zero or negative once the limit is reached. */
  availablePropertySlots: number | null;
  /** Real, gated feature: the three OCR extraction routes (documents/leases/levy-statements). */
  ocrEnabled: boolean;
  /** Real, gated feature: inviting a property owner to their own portal login. */
  ownerPortalEnabled: boolean;
  /** Real, gated feature: the tax-pack CSV export (ACCOUNTING.md §7). */
  advancedReporting: boolean;
  /** No technical surface exists anywhere in this codebase to gate (RELEASE A audit finding) --
   * exposed here as the raw plan value for UI display only, never enforced. */
  bulkCommunications: boolean;
  /** No technical surface exists anywhere in this codebase to gate (RELEASE A audit finding) --
   * exposed here as the raw plan value for UI display only, never enforced. */
  apiAccess: boolean;
  /** Commercial plan restructure (WORKLOG.md this date): the org's current plan's
   * feature_limits.includedOwners + purchased_extra_owner_slots. null = unlimited; 0 on Starter
   * (deliberately not sold as an agency plan) is a real, enforced zero, never treated as unset. */
  ownerLimit: number | null;
  /** Distinct external-owner identities (owners rows) for this org -- one owner linked to five
   * properties counts once, never five. */
  activeOwnerCount: number;
  /** null = unlimited. May be zero or negative once the limit is reached. */
  availableOwnerSlots: number | null;
  /** Business-tier only in the current plan catalogue. Raw plan value, not independently
   * technically gated anywhere beyond the UI today (same posture as bulkCommunications/apiAccess
   * above -- RELEASE A's own "do not pretend a feature exists merely to gate it" instruction). */
  multiOwnerManagement: boolean;
}

// Rank order for "at least X" comparisons — mirrors has_org_role()'s per-branch semantics in
// 20260101000021_org_role_helpers.sql. NOT a total order for 'accountant' vs 'agent' (they're
// siblings, per PERMISSIONS.md §2) — only use this for principal/manager/viewer comparisons.
export const ORGANIZATION_MEMBER_ROLE_RANK: Record<OrganizationMemberRole, number> = {
  viewer: 0,
  accountant: 1,
  agent: 1,
  manager: 2,
  principal: 3,
};
