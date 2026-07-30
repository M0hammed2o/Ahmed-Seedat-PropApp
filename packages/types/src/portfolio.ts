import type { OwnerType, UnitStatus } from './enums';

// Net-new types for the org-scoped portfolio model (supabase/migrations/20260101000022+).
// `Property` itself (./property.ts) is not yet updated to expose `orgId` — that field exists on
// the table as a nullable "expand phase" column (see the migration's header comment) but isn't
// wired into any application code path yet. Adding it to the shared `Property` type now would
// force every existing call site (mobile property screens/repository/demo store, admin customer
// pages — ~30 files, per the 2026-07-30 grep in WORKLOG.md) to handle it immediately, which is
// exactly the big-bang change deliberately deferred to the Milestone 2 "contract" follow-up.

export interface Unit {
  id: string;
  propertyId: string;
  orgId: string;
  unitLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeSqm: number | null;
  marketRent: number | null;
  status: UnitStatus;
  createdAt: string;
  updatedAt: string;
}

export type UnitDraft = Omit<Unit, 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'status'>;

export interface Owner {
  id: string;
  orgId: string;
  userId: string | null;
  ownerType: OwnerType;
  name: string;
  email: string | null;
  phone: string | null;
  bankingRef: string | null;
  mandateStart: string | null;
  mandateEnd: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export type OwnerDraft = Pick<Owner, 'ownerType' | 'name' | 'email' | 'phone'>;

export interface PropertyOwner {
  propertyId: string;
  ownerId: string;
  ownershipPct: number;
  createdAt: string;
}
