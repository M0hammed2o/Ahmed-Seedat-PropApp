import { NextResponse, type NextRequest } from 'next/server';
import { utilityAlertUpdateSchema } from '@propvault/validation';
import { canWriteUtilities, forbidden, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/v1/utility-alerts/:id {status} -- acknowledge / resolve / reopen an alert. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, utilityAlertUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const { data: alert } = await auth.supabase
    .from('utility_alerts')
    .select('id, org_id, property_id')
    .eq('id', id)
    .maybeSingle();
  if (!alert) return notFound('Alert');
  if (!(await canWriteUtilities(auth.supabase, alert.org_id, alert.property_id))) return forbidden();
  const now = new Date().toISOString();
  const status = parsed.data.status;
  const { error } = await auth.supabase
    .from('utility_alerts')
    .update({
      status,
      acknowledged_by: status === 'open' ? null : auth.user.id,
      acknowledged_at: status === 'open' ? null : now,
      resolved_at: status === 'resolved' ? now : null,
    })
    .eq('id', id);
  if (error) return serverError('alert_update_failed', 'Could not update the alert.', 'utility_alerts.update', error);
  return NextResponse.json({ status });
}
