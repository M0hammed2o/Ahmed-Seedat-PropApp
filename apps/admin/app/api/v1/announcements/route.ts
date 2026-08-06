import { NextResponse, type NextRequest } from 'next/server';
import { announcementCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapAnnouncementRow } from '@/lib/notifications';

/** GET/POST /api/v1/announcements (API_SPEC.md §5, TASKS.md M15). Agent+ write, per Maintenance/Operations-column rights in PERMISSIONS.md §2. */
export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const orgId = url.searchParams.get('filter[org_id]');
  const propertyId = url.searchParams.get('filter[property_id]');

  let query = supabase
    .from('announcements')
    .select('*')
    .order('published_at', { ascending: false });
  if (orgId) query = query.eq('org_id', orgId);
  if (propertyId) query = query.eq('property_id', propertyId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'announcements_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ announcements: (data ?? []).map(mapAnnouncementRow) });
}

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = announcementCreateSchema.safeParse(body);
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to publish announcements for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('announcements')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId ?? null,
      title: parsed.data.title,
      body: parsed.data.body,
      requires_acknowledgement: parsed.data.requiresAcknowledgement,
      expires_at: parsed.data.expiresAt ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'announcement_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ announcement: mapAnnouncementRow(data) }, { status: 201 });
}
