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
