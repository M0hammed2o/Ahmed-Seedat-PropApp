import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/applications/:id/document-requirements -- staff view of the checklist (Phase 12),
 * plain RLS-protected select (application_document_requirements_select_staff, migration
 * 20260101000132) -- no service-role needed, this is an ordinary in-org staff read. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('application_document_requirements')
    .select('id, requirement_key, label, is_required, status, rejection_reason')
    .eq('application_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'requirements_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    requirements: (data ?? []).map((r) => ({
      id: r.id,
      requirementKey: r.requirement_key,
      label: r.label,
      isRequired: r.is_required,
      status: r.status,
      rejectionReason: r.rejection_reason,
    })),
  });
}
