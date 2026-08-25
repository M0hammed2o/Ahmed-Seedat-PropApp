import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string; documentId: string }> };

const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * GET /api/v1/leases/:id/documents/:documentId/download (Phase V/T). Short-lived signed URL only
 * -- never a raw storage path, never a long-lived/permanent link. Works identically for staff
 * (agent+/property-scoped) and for the tenant on the lease reading their own ISSUED document --
 * lease_documents' own RLS (migration 20260101000134) already scopes both correctly; this route
 * adds no authorization logic of its own beyond "can this caller SELECT this row at all."
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
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
    .from('lease_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_document_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease document not found.' } },
      { status: 404 },
    );
  }

  const { data: signed } = await supabase.storage
    .from('documents')
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({ signedUrl: signed?.signedUrl ?? null });
}
