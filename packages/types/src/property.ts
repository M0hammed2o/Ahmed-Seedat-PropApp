import type { PropertyStatus, PropertyType } from './enums';

export interface Property {
  id: string;
  /**
   * Cut over from ownerUserId to orgId 2026-07-30 (TASKS.md M5, supabase/migrations/
   * 20260101000023) — properties belong to an organization, not directly to an individual user.
   * See DATABASE.md #14 and RETAIN_REFACTOR_REBUILD_MATRIX.md for why this is a schema change,
   * not a rename.
   */
  orgId: string;
  nickname: string;
  fullAddress: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  propertyType: PropertyType;
  municipalAccountNumber: string | null;
  notes: string | null;
  imagePath: string | null;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
}

export type PropertyDraft = Omit<Property, 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'status'>;

export interface PropertyExpectedCategory {
  id: string;
  propertyId: string;
  categoryId: string;
  isExpected: boolean;
  createdAt: string;
  updatedAt: string;
}
