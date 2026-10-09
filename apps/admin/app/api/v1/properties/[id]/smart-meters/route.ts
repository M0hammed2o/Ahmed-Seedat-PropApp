import { NextResponse, type NextRequest } from 'next/server';
import { smartMeterCreateSchema } from '@propvault/validation';
import { meterInsertRow, meterWriteError } from '@/lib/smartUtility/meters';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import {
  canWriteUtilities,
  forbidden,
  loadReadableProperty,
  notFound,
  parseJson,
  requireUser,
  serverError,
} from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/properties/:id/smart-meters -- add a (smart or manual) meter with full hierarchy fields. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, smartMeterCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();

  const { data, error } = await auth.supabase
    .from('utility_meters')
    .insert(meterInsertRow(property.org_id, property.id, parsed.data))
    .select('id')
    .single();
  if (error) {
    return (
      meterWriteError(error) ??
      serverError('smart_meter_create_failed', 'Could not add this meter.', 'smart_meters.insert', error)
    );
  }
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: property.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'smart_meter.create',
    entityType: 'utility_meters',
    entityId: data.id,
    after: { utilityType: parsed.data.utilityType, meterRole: parsed.data.meterRole, connectivity: parsed.data.connectivity },
  });
  return NextResponse.json({ meterId: data.id }, { status: 201 });
}
