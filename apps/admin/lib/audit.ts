import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// audit_events writer (API_SPEC.md §0: "every mutating endpoint writes an audit_events row as
// part of the same transaction as its primary write"). The first real writer of this table in
// the whole codebase -- every prior mutating endpoint either predates the TD-14 schema cutover
// (M18, migration 20260101000043) or was built after it but hasn't been wired up yet (TD-14's
// remaining note). audit_events has no client insert policy at all (matches usage_events/
// portfolio_insights' "server-side subsystems only" pattern), so `client` here must be the
// service-role client.
//
// "Same transaction as its primary write" is aspirational for a REST route handler making two
// separate Supabase calls (there is no ambient transaction spanning them) -- this call is made
// immediately after the primary write succeeds, and a failure here is logged, not thrown, so an
// audit-write failure never rolls back or masks a write that already succeeded. A stricter
// same-transaction guarantee would require moving the write into a Postgres function, which none
// of the Super Admin actions currently need for any other reason.
export interface AuditEventInput {
  orgId: string | null;
  actorUserId: string | null;
  actorType: 'user' | 'system' | 'api' | 'ai_assisted';
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** The property this action concerns, when applicable (migration 20260101000125). */
  propertyId?: string | null;
  /** Per-request correlation id, matching this codebase's existing security-route logging
   *  convention (e.g. app/api/v1/auth/confirm's own `correlationId`). */
  correlationId?: string | null;
  ipAddress?: string | null;
  aiConversationId?: string | null;
  aiMessageId?: string | null;
  /** Snapshot fields (staff security + audit hardening pass, this date) -- when omitted and
   *  `actorUserId` is set, writeAuditEvent() resolves them itself (best-effort, never blocks the
   *  write) rather than requiring every one of this codebase's ~40 call sites to pass them
   *  explicitly. Pass explicitly only when the caller already has this data on hand (e.g. inside
   *  a PL/pgSQL RPC that already looked up the caller's role) or wants to override the resolved
   *  value for a specific reason. */
  actorRole?: string | null;
  actorDisplayName?: string | null;
}

/**
 * Best-effort snapshot resolution -- an audit trail records what was true AT THE TIME of the
 * action, not what's true now (someone's role/name may have changed since). Never throws; a
 * lookup failure just leaves the snapshot null, exactly as if the caller hadn't asked for it.
 */
async function resolveActorSnapshot(
  client: SupabaseClient,
  orgId: string | null,
  actorUserId: string | null,
): Promise<{ role: string | null; displayName: string | null }> {
  if (!actorUserId) return { role: null, displayName: null };
  try {
    const [{ data: member }, { data: profile }] = await Promise.all([
      orgId
        ? client
            .from('organization_members')
            .select('role')
            .eq('org_id', orgId)
            .eq('user_id', actorUserId)
            .eq('status', 'active')
            .maybeSingle()
        : Promise.resolve({ data: null }),
      client.from('profiles').select('display_name').eq('id', actorUserId).maybeSingle(),
    ]);
    return {
      role: (member?.role as string | undefined) ?? null,
      displayName: profile?.display_name ?? null,
    };
  } catch {
    return { role: null, displayName: null };
  }
}

export async function writeAuditEvent(
  client: SupabaseClient,
  input: AuditEventInput,
): Promise<void> {
  const snapshot =
    input.actorRole !== undefined || input.actorDisplayName !== undefined
      ? { role: input.actorRole ?? null, displayName: input.actorDisplayName ?? null }
      : await resolveActorSnapshot(client, input.orgId, input.actorUserId);

  const { error } = await client.from('audit_events').insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId,
    actor_type: input.actorType,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    property_id: input.propertyId ?? null,
    correlation_id: input.correlationId ?? null,
    ip_address: input.ipAddress ?? null,
    ai_conversation_id: input.aiConversationId ?? null,
    ai_message_id: input.aiMessageId ?? null,
    actor_role: snapshot.role,
    actor_display_name: snapshot.displayName,
  });
  if (error)
    console.error(
      `[audit] failed to write audit_events row for action "${input.action}"`,
      error.message,
    );
}

/**
 * Super Admin separation (WORKLOG.md this date), item 8: "Super Admin login" was a named audit
 * gap -- the shared /api/v1/auth/{signin,mfa/verify} routes complete sign-in for every account
 * type, with no per-account-type branching, and neither wrote an audit row. Called from both of
 * this account's two possible completion points (no-MFA-needed at signin, or the MFA step-up at
 * mfa/verify) -- a no-op (one extra, cheap single-row lookup) for the overwhelming majority of
 * sign-ins that aren't a platform admin at all.
 */
export async function auditPlatformAdminLoginIfApplicable(
  serviceClient: SupabaseClient,
  authUserId: string,
): Promise<void> {
  const { data } = await serviceClient
    .from('platform_admin_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!data) return;

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: authUserId,
    actorType: 'user',
    action: 'platform_admin.login',
    entityType: 'platform_admin_users',
    entityId: data.id as string,
  });
}
