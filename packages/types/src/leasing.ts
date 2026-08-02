import type {
  TenantStatus,
  ApplicationScreeningStatus,
  ApplicationStatus,
  ApplicationDecision,
  RentFrequency,
  LeaseStatus,
  LeaseSource,
  RentScheduleStatus,
} from './enums';

// Leasing-domain types (DATABASE.md §4). `Tenant` is the first of this family (TASKS.md M8);
// Application/Lease/LeaseTenant/RentSchedule join it here (TASKS.md M9/M10) rather than growing
// portfolio.ts (§3) past its own domain.

export interface Tenant {
  id: string;
  orgId: string;
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** Pointer into `encrypted_secrets` (DATABASE.md §11) -- never a plaintext ID number. */
  idNumberRef: string | null;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export type TenantDraft = Pick<Tenant, 'fullName' | 'email' | 'phone'>;

export interface Application {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string;
  applicantName: string;
  applicantEmail: string | null;
  applicantPhone: string | null;
  popiaConsentAt: string | null;
  screeningConsentAt: string | null;
  screeningStatus: ApplicationScreeningStatus;
  status: ApplicationStatus;
  decision: ApplicationDecision | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Internal landlord/staff notes -- V1 simplification, 2026-08-01. Never applicant-visible. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Lease {
  id: string;
  orgId: string;
  unitId: string;
  startDate: string;
  endDate: string | null;
  rentAmount: number;
  rentFrequency: RentFrequency;
  depositAmount: number;
  status: LeaseStatus;
  source: LeaseSource;
  sourceDocumentId: string | null;
  sourceApplicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaseTenant {
  leaseId: string;
  tenantId: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface RentSchedule {
  id: string;
  orgId: string;
  leaseId: string;
  dueDate: string;
  amount: number;
  status: RentScheduleStatus;
  generatedAt: string;
}
