import { NextResponse, type NextRequest } from 'next/server';
import { supportSessionCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { mapSupportAccessSessionRow } from '@/lib/superAdmin';
import { writeAuditEvent } from '@/lib/audit';

/**
 * POST /api/v1/admin/support-sessions (API_SPEC.md §2, SUPER_ADMIN.md §6) -- support_admin+,
 * reason required (Zod-enforced min length 10, mirroring the DB check constraint so a caller
 * gets a clean 400 rather than a raw constraint-violation error). Refuses to open a second
 * concurrent session for the same admin against the same org (an already-open session should be
 * reused, not duplicated) -- a real gap this route's own first design pass would have missed if
 * not checked explicitly.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminRoleOrRespond('support_admin');
  if ('response' in guard) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = supportSessionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const serviceClient = getServiceRoleClient();

  const { data: org, error: orgError } = await serviceClient
    .from('organizations')
    .select('id')
    .eq('id', parsed.data.orgId)
    .maybeSingle();
  if (orgError) {
    return NextResponse.json(
      { error: { code: 'organization_fetch_failed', message: orgError.message } },
      { status: 500 },
    );
  }
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Organization not found.' } }, { status: 404 });
  }

  const { data: existing, error: existingError } = await serviceClient
    .from('support_access_sessions')
    .select('*')
    .eq('platform_admin_id', guard.session.id)
    .eq('org_id', parsed.data.orgId)
    .is('ended_at', null)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      { error: { code: 'support_session_fetch_failed', message: existingError.message } },
      { status: 500 },
    );
  }
  if (existing) {
    return NextResponse.json({ supportSession: mapSupportAccessSessionRow(existing) }, { status: 200 });
  }

  const { data: created, error: createError } = await serviceClient
    .from('support_access_sessions')
    .insert({ platform_admin_id: guard.session.id, org_id: parsed.data.orgId, reason: parsed.data.reason })
    .select('*')
    .single();
  if (createError) {
    return NextResponse.json(
      { error: { code: 'support_session_create_failed', message: createError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: parsed.data.orgId,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'support_session.start',
    entityType: 'support_access_sessions',
    entityId: created.id,
    after: { reason: parsed.data.reason },
  });

  return NextResponse.json({ supportSession: mapSupportAccessSessionRow(created) }, { status: 201 });
}
