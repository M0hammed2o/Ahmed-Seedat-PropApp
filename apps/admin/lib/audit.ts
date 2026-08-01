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
}

export async function writeAuditEvent(client: SupabaseClient, input: AuditEventInput): Promise<void> {
  const { error } = await client.from('audit_events').insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId,
    actor_type: input.actorType,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
  });
  if (error) console.error(`[audit] failed to write audit_events row for action "${input.action}"`, error.message);
}
