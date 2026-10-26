import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { documentSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sites/:id/documents — add an entry to the site's supporting-document register (title,
 * type, reference). Metadata only: file upload for cemetery documents is not part of this release. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, documentSchema);
  if ('response' in parsed) return parsed.response;
  const { data: site } = await auth.supabase
    .from('cemetery_sites')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (!site) return cemeteryNotFound('Grave site');
  const d = parsed.data;
  const { data, error } = await auth.supabase
    .from('cemetery_site_documents')
    .insert({
      org_id: site.org_id,
      site_id: site.id,
      sale_id: d.saleId ?? null,
      title: d.title,
      document_type: d.documentType,
      reference: d.reference,
      notes: d.notes,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error) return cemeteryDbError(error, 'Could not add the document.', 'sites.document');
  return NextResponse.json({ document: data }, { status: 201 });
}
