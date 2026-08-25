import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/withdraw -- V1 simplification (DECISIONS.md 2026-08-01): the
 * applicant withdrew (staff-recorded -- there is no applicant/tenant portal in V1 for the
 * applicant to do this themselves, same "no tenant portal" limitation applied throughout this
 * codebase). Terminal, like 'decided' -- rejects if already decided or already withdrawn.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from('applications')
    .select('org_id, status')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'application_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Application not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to withdraw this application.',
        },
      },
      { status: 403 },
    );
  }

  if (existing.status === 'decided' || existing.status === 'withdrawn') {
    return NextResponse.json(
      {
        error: {
          code: 'already_final',
          message: `This application is already ${existing.status === 'decided' ? 'decided' : 'withdrawn'}.`,
        },
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('applications')
    .update({ status: 'withdrawn' })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'application_withdraw_failed', message: error.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: existing.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'application.withdrawn',
    entityType: 'applications',
    entityId: id,
    before: { status: existing.status },
  });

  return NextResponse.json({ application: mapApplicationRow(data) });
}
