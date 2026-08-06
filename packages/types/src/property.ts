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
  /**
   * Optional, manually captured current estimated value (ZAR) -- never computed/derived.
   * Added 2026-08-04 for the Owner Dashboard's Portfolio Value card (Lovable-adoption batch,
   * UI_INTEGRATION_PLAN.md): null means "not captured", not zero.
   */
  estimatedValue: number | null;
  /** The date the captured value is understood to reflect (e.g. an appraisal date), not the row-edit timestamp. */
  estimatedValueAsOf: string | null;
  /**
   * Geocoded from the address via Mapbox on create/update (2026-08-04, Owner Dashboard map).
   * Both null or both set -- enforced by a DB check constraint, never a partial coordinate.
   */
  latitude: number | null;
  longitude: number | null;
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
