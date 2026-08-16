import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedPhoneEntityType } from '@propvault/types';

/**
 * WhatsApp V1 completion pass, Phase F (WORKLOG.md this date). Resolves where to email an OTP
 * code for a given verified_phone_numbers entity_type -- org_id and email live in different
 * places per entity type (tenants.email/org_id, owners.email/org_id, auth.users.email +
 * organization_members.org_id), so this is the one place that mapping lives, not repeated per
 * route. Uses the SERVICE-ROLE client (needs auth.users.email for the organization_member case,
 * which a session-bound client can't read) -- callers must have already verified ownership via
 * the RPC (request_phone_verification/confirm_phone_verification/revoke_verified_phone_number are
 * all called through the caller's OWN session-bound client first, so RLS/the RPC's own ownership
 * check is the real authorization; this lookup only resolves where to deliver, never re-decides
 * who is allowed to request it).
 */
export async function resolveEntityContactInfo(
  serviceClient: SupabaseClient,
  entityType: VerifiedPhoneEntityType,
  entityId: string,
): Promise<{ orgId: string; email: string | null } | null> {
  if (entityType === 'tenant') {
    const { data } = await serviceClient
      .from('tenants')
      .select('org_id, email')
      .eq('id', entityId)
      .maybeSingle();
    if (!data) return null;
    return { orgId: data.org_id, email: data.email ?? null };
  }
  if (entityType === 'owner') {
    const { data } = await serviceClient
      .from('owners')
      .select('org_id, email')
      .eq('id', entityId)
      .maybeSingle();
    if (!data) return null;
    return { orgId: data.org_id, email: data.email ?? null };
  }
  // organization_member
  const { data: member } = await serviceClient
    .from('organization_members')
    .select('org_id, user_id')
    .eq('id', entityId)
    .maybeSingle();
  if (!member) return null;
  const { data: authUser } = await serviceClient.auth.admin.getUserById(member.user_id);
  return { orgId: member.org_id, email: authUser?.user?.email ?? null };
}
