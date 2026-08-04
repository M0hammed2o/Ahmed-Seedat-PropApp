import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Owner, Property, Unit } from '@propvault/types';

// Row-mapping + role-check helpers shared by apps/admin/app/api/v1/properties and
// .../units routes (TASKS.md M5/M6). Mirrors the snake_case-row -> camelCase-domain-type mapping
// apps/mobile/src/features/properties/propertyRepository.ts already established for the mobile
// direct-Supabase path, so both API surfaces produce the identical `Property`/`Unit` shape
// (API_SPEC.md's "native mobile apps consume the same API surface" intent, kept true for the
// data shape even on the direct-RLS-read mobile path API_SPEC.md §0 explicitly still allows).

interface PropertyRow {
  id: string;
  org_id: string;
  nickname: string;
  full_address: string;
  address_line1: string;
  address_line2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postal_code: string | null;
  country: string;
  property_type: string;
  municipal_account_number: string | null;
  notes: string | null;
  image_path: string | null;
  status: string;
  estimated_value: number | string | null;
  estimated_value_as_of: string | null;
  created_at: string;
  updated_at: string;
}

export function mapPropertyRow(row: PropertyRow): Property {
  return {
    id: row.id,
    orgId: row.org_id,
    nickname: row.nickname,
    fullAddress: row.full_address,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    suburb: row.suburb,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    propertyType: row.property_type as Property['propertyType'],
    municipalAccountNumber: row.municipal_account_number,
    notes: row.notes,
    imagePath: row.image_path,
    status: row.status as Property['status'],
    estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
    estimatedValueAsOf: row.estimated_value_as_of,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface UnitRow {
  id: string;
  property_id: string;
  org_id: string;
  unit_label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  market_rent: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapUnitRow(row: UnitRow): Unit {
  return {
    id: row.id,
    propertyId: row.property_id,
    orgId: row.org_id,
    unitLabel: row.unit_label,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sizeSqm: row.size_sqm,
    marketRent: row.market_rent,
    status: row.status as Unit['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface OwnerRow {
  id: string;
  org_id: string;
  user_id: string | null;
  owner_type: string;
  name: string;
  email: string | null;
  phone: string | null;
  banking_ref: string | null;
  mandate_start: string | null;
  mandate_end: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapOwnerRow(row: OwnerRow): Owner {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    ownerType: row.owner_type as Owner['ownerType'],
    name: row.name,
    email: row.email,
    phone: row.phone,
    bankingRef: row.banking_ref,
    mandateStart: row.mandate_start,
    mandateEnd: row.mandate_end,
    status: row.status as Owner['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * API-layer fail-fast role check (PERMISSIONS.md's layer 2: "fail fast with a clear 403 before
 * hitting the database"). Deliberately calls the *same* `has_org_role()` Postgres function RLS
 * itself uses (via RPC) rather than re-implementing the role hierarchy in TypeScript — the
 * hierarchy is asymmetric (`agent` and `accountant` are siblings, not a linear ladder; see
 * supabase/migrations/20260101000021_org_role_helpers.sql), so a hand-rolled TS copy would be a
 * second source of truth guaranteed to drift. RLS remains the actual enforcement regardless of
 * what this returns — a bug here produces a wrong error message, not a data breach.
 */
export async function requireOrgRole(
  supabase: SupabaseClient,
  orgId: string,
  minRole: 'viewer' | 'accountant' | 'agent' | 'manager' | 'principal',
): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_org_role', {
    target_org_id: orgId,
    min_role: minRole,
  });
  if (error) throw new Error(`has_org_role RPC failed: ${error.message}`);
  return data === true;
}
