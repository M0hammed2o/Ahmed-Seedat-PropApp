import 'server-only';
import type { Application, Lease, RentSchedule, Tenant } from '@propvault/types';

// Leasing-domain row mapping (apps/admin/app/api/v1/{tenants,applications,leases}). Role checks
// reuse requireOrgRole() from ./portfolio -- one has_org_role() RPC wrapper, not a per-domain copy.

interface TenantRow {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number_ref: string | null;
  status: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTenantRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    idNumberRef: row.id_number_ref,
    status: row.status as Tenant['status'],
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    emergencyContactRelationship: row.emergency_contact_relationship,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ApplicationRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string;
  applicant_name: string;
  applicant_email: string | null;
  applicant_phone: string | null;
  popia_consent_at: string | null;
  screening_consent_at: string | null;
  screening_status: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes: string | null;
  date_of_birth: string | null;
  current_address: string | null;
  employment_status: string | null;
  employer_name: string | null;
  monthly_income: number | null;
  household_size: number | null;
  applicant_notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapApplicationRow(row: ApplicationRow): Application {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    applicantPhone: row.applicant_phone,
    popiaConsentAt: row.popia_consent_at,
    screeningConsentAt: row.screening_consent_at,
    screeningStatus: row.screening_status as Application['screeningStatus'],
    status: row.status as Application['status'],
    decision: row.decision as Application['decision'],
    decisionReason: row.decision_reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    notes: row.notes,
    dateOfBirth: row.date_of_birth,
    currentAddress: row.current_address,
    employmentStatus: row.employment_status,
    employerName: row.employer_name,
    monthlyIncome: row.monthly_income,
    householdSize: row.household_size,
    applicantNotes: row.applicant_notes,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface LeaseRow {
  id: string;
  org_id: string;
  unit_id: string;
  start_date: string;
  end_date: string | null;
  rent_amount: number;
  rent_frequency: string;
  deposit_amount: number;
  status: string;
  source: string;
  source_document_id: string | null;
  source_application_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapLeaseRow(row: LeaseRow): Lease {
  return {
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    startDate: row.start_date,
    endDate: row.end_date,
    rentAmount: row.rent_amount,
    rentFrequency: row.rent_frequency as Lease['rentFrequency'],
    depositAmount: row.deposit_amount,
    status: row.status as Lease['status'],
    source: row.source as Lease['source'],
    sourceDocumentId: row.source_document_id,
    sourceApplicationId: row.source_application_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Tenant/occupancy V1 pass: shared "which lease is THE current one" rule, extracted from
// tenants/[id]/page.tsx's own original inline sort (a tenant can have multiple leases over time --
// lease_tenants is a many-to-many join, DATABASE.md §4 -- this is deliberately the single place
// that rule lives now that both the tenant list AND detail pages need it, not two copies that could
// drift). Active wins outright; among non-active leases (or between two actives, which
// activate_lease() itself already prevents at the DB level), the most recently STARTED one is
// "current" and everything else is history.
export function pickCurrentLease<T extends { status: string; startDate: string }>(
  leases: T[],
): { current: T | null; history: T[] } {
  const sorted = [...leases].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  });
  const [current = null, ...history] = sorted;
  return { current, history };
}

// Tenant/occupancy V1 pass: the tenant list/detail pages' shared "current tenancy" shape --
// property/unit context plus the lease fields those pages actually display. Kept minimal (not the
// full `Lease` type) since this is a read-only display projection, not a domain entity.
export interface TenancyContext {
  leaseId: string;
  leaseStatus: string;
  startDate: string;
  endDate: string | null;
  rentAmount: number;
  rentFrequency: string;
  unitId: string;
  unitLabel: string;
  propertyId: string;
  propertyNickname: string;
}

interface RentScheduleRow {
  id: string;
  org_id: string;
  lease_id: string;
  due_date: string;
  amount: number;
  status: string;
  generated_at: string;
}

export function mapRentScheduleRow(row: RentScheduleRow): RentSchedule {
  return {
    id: row.id,
    orgId: row.org_id,
    leaseId: row.lease_id,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status as RentSchedule['status'],
    generatedAt: row.generated_at,
  };
}

/**
 * V1 launch readiness pass (WORKLOG.md this date): the tenant portal's own "amount outstanding"
 * total (`(tenant)/my-payments/page.tsx`) previously filtered only `pending`/`overdue`, silently
 * excluding `invoiced` (the ordinary state for currently-due rent once an invoice entry is posted
 * -- see `accounting_posting_operations.sql`'s `pending -> invoiced` transition) and `partial` (a
 * schedule the tenant has part-paid, still genuinely owed) -- a tenant whose rent had already been
 * invoiced could see "R0 outstanding" while genuinely owing money. Every status except `paid`
 * represents an amount still owed; extracted as its own pure function specifically so this rule is
 * unit-testable without standing up the whole server-component page.
 */
export function calculateOutstandingRentTotal(
  rentSchedules: Pick<RentSchedule, 'status' | 'amount'>[],
): number {
  return rentSchedules
    .filter((r) => r.status !== 'paid')
    .reduce((sum, r) => sum + Number(r.amount), 0);
}

// Lease preparation (Phase L/N, migration 20260101000134).

export interface LeasePreparation {
  leaseId: string;
  orgId: string;
  status: 'drafting' | 'reviewed' | 'sent';
  templateId: string | null;
  approvedOccupants: string | null;
  parking: string | null;
  utilities: string | null;
  specialConditions: string | null;
  rentalDueDay: number | null;
  annualEscalationPct: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  sentBy: string | null;
  sentAt: string | null;
  tenantAcknowledgedAt: string | null;
  staffConfirmedSignedAt: string | null;
  staffConfirmedSignedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LeasePreparationRow {
  lease_id: string;
  org_id: string;
  status: string;
  template_id: string | null;
  approved_occupants: string | null;
  parking: string | null;
  utilities: string | null;
  special_conditions: string | null;
  rental_due_day: number | null;
  annual_escalation_pct: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  sent_by: string | null;
  sent_at: string | null;
  tenant_acknowledged_at: string | null;
  staff_confirmed_signed_at: string | null;
  staff_confirmed_signed_by: string | null;
  created_at: string;
  updated_at: string;
}

export function mapLeasePreparationRow(row: LeasePreparationRow): LeasePreparation {
  return {
    leaseId: row.lease_id,
    orgId: row.org_id,
    status: row.status as LeasePreparation['status'],
    templateId: row.template_id,
    approvedOccupants: row.approved_occupants,
    parking: row.parking,
    utilities: row.utilities,
    specialConditions: row.special_conditions,
    rentalDueDay: row.rental_due_day,
    annualEscalationPct: row.annual_escalation_pct,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    sentBy: row.sent_by,
    sentAt: row.sent_at,
    tenantAcknowledgedAt: row.tenant_acknowledged_at,
    staffConfirmedSignedAt: row.staff_confirmed_signed_at,
    staffConfirmedSignedBy: row.staff_confirmed_signed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LeaseDocument {
  id: string;
  leaseId: string;
  orgId: string;
  kind: 'generated' | 'uploaded';
  status: 'draft' | 'issued' | 'superseded';
  version: number;
  templateId: string | null;
  storagePath: string;
  originalFileName: string | null;
  mimeType: string;
  fileSizeBytes: number;
  generatedBy: string | null;
  generatedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  sentBy: string | null;
  sentAt: string | null;
  supersedesDocumentId: string | null;
  createdAt: string;
}

interface LeaseDocumentRow {
  id: string;
  lease_id: string;
  org_id: string;
  kind: string;
  status: string;
  version: number;
  template_id: string | null;
  storage_path: string;
  original_file_name: string | null;
  mime_type: string;
  file_size_bytes: number;
  generated_by: string | null;
  generated_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  sent_by: string | null;
  sent_at: string | null;
  supersedes_document_id: string | null;
  created_at: string;
}

export function mapLeaseDocumentRow(row: LeaseDocumentRow): LeaseDocument {
  return {
    id: row.id,
    leaseId: row.lease_id,
    orgId: row.org_id,
    kind: row.kind as LeaseDocument['kind'],
    status: row.status as LeaseDocument['status'],
    version: row.version,
    templateId: row.template_id,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    sentBy: row.sent_by,
    sentAt: row.sent_at,
    supersedesDocumentId: row.supersedes_document_id,
    createdAt: row.created_at,
  };
}
