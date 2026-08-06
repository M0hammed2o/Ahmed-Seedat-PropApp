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
