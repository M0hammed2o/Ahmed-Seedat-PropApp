import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * GET /api/v1/document-categories -- small, generically useful lookup the property-compliance
 * upload panels need client-side (to resolve the 'compliance_documents'/'levies' category id
 * before calling the existing POST /api/v1/documents upload route). document_categories' own RLS
 * (`is_default or owner_user_id = auth.uid()`) already lets any authenticated caller read every
 * default category plus their own custom ones -- this route only shapes that into JSON, adding no
 * new authorization surface.
 */
export async function GET() {
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
    .from('document_categories')
    .select('id, slug, label, is_default')
    .order('label', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'categories_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    categories: (data ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      label: c.label,
      isDefault: c.is_default,
    })),
  });
}
