import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { availabilitySchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sites/:id/availability — withdraw an available site (with a reason) or return a withdrawn
 * site to sale (manager+). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, availabilitySchema);
  if ('response' in parsed) return parsed.response;
  const { error } = await auth.supabase.rpc('cemetery_set_site_unavailable', {
    p_site_id: id,
    p_unavailable: parsed.data.unavailable,
    p_reason: parsed.data.reason,
  });
  if (error)
    return cemeteryDbError(error, 'Could not change the site availability.', 'sites.availability');
  return NextResponse.json({ ok: true });
}
