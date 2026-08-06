import { NextResponse, type NextRequest } from 'next/server';
import type { AuditEvent } from '@propvault/types';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/admin/organizations/:orgId/audit (SUPER_ADMIN.md §4, PWA_V1_COMPLETION_PLAN.md
 * #14) -- read_only_admin+. Service-role, like every other Super Admin read: a platform admin is
 * not an org member, so the RLS-scoped client would return nothing without an active support
 * session (audit_events_select_org_member already grants that automatically via has_org_role()'s
 * support-mode branch, migration 20260101000057 -- this route exists for the platform-wide admin
 * view regardless of whether one is open).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('audit_events')
    .select(
      'id, org_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, ip_address, ai_conversation_id, ai_message_id, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: { code: 'audit_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const events: AuditEvent[] = (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: row.before,
    after: row.after,
    ipAddress: row.ip_address,
    aiConversationId: row.ai_conversation_id,
    aiMessageId: row.ai_message_id,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ auditEvents: events });
}
