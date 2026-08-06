import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { mapSupportAccessSessionRow } from '@/lib/superAdmin';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/support-sessions/:id/end (API_SPEC.md §2, SUPER_ADMIN.md §6). Only the
 * admin who opened the session may end it early -- support_admin+ is the entry bar, but this
 * route additionally checks `platform_admin_id` matches the caller, since an already-open
 * session belongs to a specific admin, not the support_admin+ role generally (a different
 * support_admin ending someone else's session would defeat the "who is actually in this org
 * right now" guarantee the banner/session model exists for).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('support_admin');
  if ('response' in guard) return guard.response;

  const { id } = await params;
  const serviceClient = getServiceRoleClient();

  const { data: session, error: fetchError } = await serviceClient
    .from('support_access_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'support_session_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!session) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Support session not found.' } },
      { status: 404 },
    );
  }
  if (session.platform_admin_id !== guard.session.id) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You can only end a support session you opened yourself.',
        },
      },
      { status: 403 },
    );
  }
  if (session.ended_at) {
    return NextResponse.json(
      { supportSession: mapSupportAccessSessionRow(session) },
      { status: 200 },
    );
  }

  const { data: updated, error: updateError } = await serviceClient
    .from('support_access_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'support_session_end_failed', message: updateError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: session.org_id,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'support_session.end',
    entityType: 'support_access_sessions',
    entityId: id,
  });

  return NextResponse.json({ supportSession: mapSupportAccessSessionRow(updated) });
}
