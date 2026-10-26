import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { siteUpdateSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/v1/cemetery/sites/:id — plot details, list price, burial rule and internal notes (manager+). Sale and
 * burial status are NOT editable here: they move only with a sale, reservation or burial record. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, siteUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const update: Record<string, unknown> = {};
  if (d.notes !== undefined) update.notes = d.notes;
  if (d.listPrice !== undefined) update.list_price = d.listPrice;
  if (d.lengthM !== undefined) update.length_m = d.lengthM;
  if (d.widthM !== undefined) update.width_m = d.widthM;
  if (d.siteType !== undefined) update.site_type = d.siteType;
  if (d.maxInterments !== undefined) {
    const { count } = await auth.supabase
      .from('cemetery_burials')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', id);
    if ((count ?? 0) > d.maxInterments) {
      return NextResponse.json(
        {
          error: {
            code: 'interments_exceed_rule',
            message: `This site already has ${count} interment(s) recorded.`,
          },
        },
        { status: 409 },
      );
    }
    update.max_interments = d.maxInterments;
  }
  const { data, error } = await auth.supabase
    .from('cemetery_sites')
    .update(update)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return cemeteryDbError(error, 'Could not update the grave site.', 'sites.update');
  if (!data) return cemeteryNotFound('Grave site');
  return NextResponse.json({ site: data });
}
