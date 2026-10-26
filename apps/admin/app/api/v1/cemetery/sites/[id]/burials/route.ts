import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { burialSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sites/:id/burials — record an interment on a site whose rights have been granted
 * (manager+). The site's burial status becomes Occupied; its sale status is unchanged. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, burialSchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  if (d.dateOfDeath && d.burialDate < d.dateOfDeath) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'The burial date cannot be before the date of death.',
          field_errors: { burialDate: ['Must be on or after the date of death'] },
        },
      },
      { status: 400 },
    );
  }
  const { data, error } = await auth.supabase.rpc('cemetery_record_burial', {
    p_site_id: id,
    p_deceased_full_name: d.deceasedFullName,
    p_burial_date: d.burialDate,
    p_date_of_death: d.dateOfDeath ?? null,
    p_date_of_birth: d.dateOfBirth ?? null,
    p_burial_order_number: d.burialOrderNumber,
    p_funeral_undertaker: d.funeralUndertaker,
    p_notes: d.notes,
  });
  if (error) return cemeteryDbError(error, 'Could not record the burial.', 'sites.burial');
  return NextResponse.json({ burial: data }, { status: 201 });
}
