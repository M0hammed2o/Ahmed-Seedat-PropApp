import { supabase } from '@/lib/supabase';
import type { PropertyInput } from '@propvault/validation';
import type { Property } from '@propvault/types';

// Row shape as it comes back from Postgres (snake_case) before mapping to the camelCase
// `Property` domain type used elsewhere in the app.
interface PropertyRow {
  id: string;
  owner_user_id: string;
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
  created_at: string;
  updated_at: string;
}

// The database is the trusted source for these enum-shaped columns (constrained by Postgres
// enum types + RLS-scoped writes — see DATABASE.md), so casting at this single data-access
// boundary is safe; screens/components consume the properly-typed `Property` domain type.
function mapRow(row: PropertyRow): Property {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Thin data-access layer over Supabase — screens/hooks call this, never `supabase.from(...)`
 * directly, so the mapping/ownership logic lives in one place (brief: "keep business logic
 * outside UI components"). RLS still enforces ownership server-side regardless of what this
 * layer does or doesn't filter by.
 */
export const propertyRepository = {
  async list(status: 'active' | 'archived' = 'active') {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PropertyRow[]).map(mapRow);
  },

  async getById(id: string) {
    const { data, error } = await supabase.from('properties').select('*').eq('id', id).single();
    if (error) throw error;
    return mapRow(data as PropertyRow);
  },

  async create(input: PropertyInput, ownerUserId: string) {
    const { data, error } = await supabase
      .from('properties')
      .insert({
        owner_user_id: ownerUserId,
        nickname: input.nickname,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2 ?? null,
        suburb: input.suburb ?? null,
        city: input.city,
        province: input.province ?? null,
        postal_code: input.postalCode ?? null,
        country: input.country,
        property_type: input.propertyType,
        municipal_account_number: input.municipalAccountNumber ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as PropertyRow);
  },

  async update(id: string, input: Partial<PropertyInput>) {
    const { data, error } = await supabase
      .from('properties')
      .update({
        nickname: input.nickname,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        suburb: input.suburb,
        city: input.city,
        province: input.province,
        postal_code: input.postalCode,
        country: input.country,
        property_type: input.propertyType,
        municipal_account_number: input.municipalAccountNumber,
        notes: input.notes,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as PropertyRow);
  },

  async archive(id: string) {
    const { error } = await supabase.from('properties').update({ status: 'archived' }).eq('id', id);
    if (error) throw error;
  },

  async restore(id: string) {
    const { error } = await supabase.from('properties').update({ status: 'active' }).eq('id', id);
    if (error) throw error;
  },
};
