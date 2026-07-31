import type { TenantStatus } from './enums';

// Leasing-domain types (DATABASE.md §4). `Tenant` is the first of this family (TASKS.md M8) --
// Application/Lease/LeaseTenant/RentSchedule land here too as M9/M10 build them, rather than
// growing portfolio.ts (§3) past its own domain.

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
