import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapDocumentRow } from '@/lib/documents';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes -- long enough to view/download, never cached long-term

/**
 * GET /api/v1/documents/:id (API_SPEC.md §7). Returns a short-lived signed URL alongside the
 * record -- the bucket is private (SECURITY.md: "no object is ever served via a public URL"), so
 * this is the only way a client ever gets a usable link, and it expires quickly rather than being
 * a permanent credential.
 */
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

  const { data, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'document_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Document not found.' } },
      { status: 404 },
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('documents')
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError) {
    return NextResponse.json(
      { error: { code: 'signed_url_failed', message: signError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ document: mapDocumentRow(data), signedUrl: signed.signedUrl });
}
