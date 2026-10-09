import { NextResponse, type NextRequest } from 'next/server';
import { meterIntegrationRequestSchema } from '@propvault/validation';
import { requireOrgRole } from '@/lib/portfolio';
import { notifyPropertyStaff } from '@/lib/notify';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { jsonError, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { rateLimitOrRespond } from '@/lib/rateLimit';

type RouteParams = { params: Promise<{ orgId: string }> };

/** GET — this organisation's integration requests (RLS: org viewers). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('meter_integration_requests')
    .select('id, property_id, utility_type, manufacturer, model, connection_method, supplier, notes, status, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return serverError('integration_requests_failed', 'Could not load requests.', 'integration_requests.list', error);
  return NextResponse.json({ requests: data ?? [] });
}

/**
 * POST — "My meter isn't listed": records a request for a new integration. Nothing is promised;
 * the request is visible to the organisation and audited by the table's own rows.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, meterIntegrationRequestSchema);
  if ('response' in parsed) return parsed.response;
  if (!(await requireOrgRole(auth.supabase, orgId, 'viewer'))) {
    return jsonError(403, 'forbidden', 'You are not a member of this organisation.');
  }
  const limited = await rateLimitOrRespond(getServiceRoleClient(), `meter-integration-request:${auth.user.id}`, 10, 3600);
  if (limited) return limited;
  const d = parsed.data;
  const { data, error } = await auth.supabase
    .from('meter_integration_requests')
    .insert({
      org_id: orgId,
      property_id: d.propertyId ?? null,
      requested_by: auth.user.id,
      utility_type: d.utilityType,
      manufacturer: d.manufacturer,
      model: d.model,
      connection_method: d.connectionMethod || null,
      supplier: d.supplier || null,
      notes: d.notes || null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '42501') return jsonError(403, 'forbidden', 'You cannot file a request for that property.');
    return serverError('integration_request_failed', 'Could not save the request.', 'integration_requests.insert', error);
  }
  await notifyPropertyStaff(getServiceRoleClient(), {
    orgId,
    propertyId: d.propertyId ?? null,
    type: 'meter_integration_requested',
    title: `Meter integration requested: ${d.manufacturer} ${d.model}`,
    body: d.notes ?? null,
    relatedEntityType: 'meter_integration_requests',
    relatedEntityId: data.id,
    excludeUserId: auth.user.id,
    minRole: 'manager',
  });
  return NextResponse.json({ requestId: data.id }, { status: 201 });
}
