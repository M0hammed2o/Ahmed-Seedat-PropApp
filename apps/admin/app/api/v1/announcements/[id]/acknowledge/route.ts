import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/announcements/:id/acknowledge (API_SPEC.md §5: "tenant"). Resolves the caller's
 * own tenant identity server-side (never a client-supplied tenant_id, matching API_SPEC.md §0's
 * "no endpoint accepts a client-supplied org_id/identity as authoritative" rule extended to
 * tenant_id here) and upserts their own announcement_reads row.
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

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (tenantError) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: tenantError.message } },
      { status: 500 },
    );
  }
  if (!tenant) {
    return NextResponse.json(
      {
        error: {
          code: 'not_a_tenant',
          message: 'This account has no tenant identity to acknowledge with.',
        },
      },
      { status: 403 },
    );
  }

  const { data: announcement, error: announcementError } = await supabase
    .from('announcements')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (announcementError) {
    return NextResponse.json(
      { error: { code: 'announcement_fetch_failed', message: announcementError.message } },
      { status: 500 },
    );
  }
  if (!announcement) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Announcement not found.' } },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('announcement_reads')
    .upsert(
      { announcement_id: id, tenant_id: tenant.id, read_at: now, acknowledged_at: now },
      { onConflict: 'announcement_id,tenant_id' },
    )
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'acknowledge_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    announcementRead: {
      announcementId: data.announcement_id,
      tenantId: data.tenant_id,
      readAt: data.read_at,
      acknowledgedAt: data.acknowledged_at,
    },
  });
}
