import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { ZodType } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

// Shared plumbing for the Smart Utility routes: same {error:{code,message}} envelope and
// auth → JSON → zod → permission order as every other /api/v1 route in this codebase.

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...(extra ?? {}) } }, { status });
}

export async function requireUser(): Promise<
  { supabase: SupabaseClient; user: User } | { response: NextResponse }
> {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: jsonError(401, 'unauthenticated', 'Sign in required.') };
  return { supabase, user };
}

export async function parseJson<T>(
  request: NextRequest,
  schema: ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: jsonError(400, 'invalid_json', 'Request body must be valid JSON.') };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten() as { fieldErrors: Record<string, string[]>; formErrors: string[] };
    return {
      response: jsonError(400, 'validation_failed', 'Check the highlighted fields.', {
        field_errors: flat.fieldErrors,
        form_errors: flat.formErrors,
      }),
    };
  }
  return { data: parsed.data };
}

/** Resolves a property the caller can READ (RLS) and returns its org. 404 when invisible. */
export async function loadReadableProperty(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<{ id: string; org_id: string; nickname: string | null; full_address: string | null; utilities_enabled: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return null;
  const { data } = await supabase
    .from('properties')
    .select('id, org_id, nickname, full_address, organizations(utilities_enabled)')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  const { organizations, ...rest } = data as typeof data & { organizations: { utilities_enabled?: boolean } | null };
  // Fail closed (migration 182): only an explicit true enables Smart Utilities for the organisation.
  return { ...rest, utilities_enabled: organizations?.utilities_enabled === true };
}

/** 403 when Smart Utilities is switched off for the organisation (other Proplyst features are unaffected). */
/**
 * Smart Utilities switch for one organisation (migrations 179/182), read with the service role so a caller's RLS view
 * cannot affect it. FAIL CLOSED: only an explicit `true` enables; a missing row or a lookup error means disabled.
 */
export async function utilitiesEnabledForOrg(orgId: string): Promise<boolean> {
  const { data, error } = await getServiceRoleClient().from('organizations').select('utilities_enabled').eq('id', orgId).maybeSingle();
  if (error) return false;
  return (data as { utilities_enabled?: boolean } | null)?.utilities_enabled === true;
}

export const utilitiesDisabled = () =>
  jsonError(403, 'utilities_disabled', 'Smart Utilities is not enabled for this organisation. Ask Proplyst support to enable it.');

/** Same predicate the RLS write policies use (migration 175), evaluated as the caller. */
export async function canWriteUtilities(supabase: SupabaseClient, orgId: string, propertyId: string) {
  const { data, error } = await supabase.rpc('can_write_property_utilities', {
    p_org_id: orgId,
    p_property_id: propertyId,
  });
  if (error) throw new Error(`can_write_property_utilities RPC failed: ${error.message}`);
  return data === true;
}

export async function canReadUtilities(supabase: SupabaseClient, orgId: string, propertyId: string) {
  const { data, error } = await supabase.rpc('can_read_property_utilities', {
    p_org_id: orgId,
    p_property_id: propertyId,
  });
  if (error) throw new Error(`can_read_property_utilities RPC failed: ${error.message}`);
  return data === true;
}

export const forbidden = () =>
  jsonError(403, 'forbidden', 'You do not have permission to manage utilities for this property.');
export const notFound = (what = 'Property') => jsonError(404, 'not_found', `${what} not found.`);

/** 500 with a safe (non-leaking) message, logged with context. */
export function serverError(code: string, fallback: string, context: string, error: unknown) {
  const err = error instanceof Error ? error : { message: String(error) };
  return jsonError(500, code, safeErrorMessage(err, fallback, context));
}
