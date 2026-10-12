import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { notifyPropertyStaff } from '@/lib/notify';
import { disputeCharge } from '@/lib/smartUtility/billing';
import { serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().min(10, 'Please say what looks wrong (at least 10 characters).').max(1000) });

/**
 * POST /api/v1/tenant-portal/utility-statements/:id/dispute — the signed-in tenant queries the charges on one of THEIR
 * approved statements. Opens a dispute on that statement's own charges (same lease, period and property): a disputed
 * draft/approved charge cannot be approved or invoiced until staff resolve it. No amount changes; staff are notified;
 * every opened dispute is audited (disputeCharge). The statement is read through the caller's session, so RLS
 * (utility_statements_select_tenant_self) means a tenant can only ever dispute their own approved statement.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: { code: 'not_found', message: 'Statement not found.' } }, { status: 404 });
  const session = await resolveTenantSession();
  if (!session) return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid request.' } }, { status: 400 });
  }

  const service = getServiceRoleClient();
  const limited = await rateLimitOrRespond(service, `utility-dispute:${session.userId}`, 5, 86_400);
  if (limited) return limited;

  const supabase = await getServerSupabaseClient();
  const { data: statement } = await supabase
    .from('utility_statements')
    .select('id, org_id, property_id, lease_id, tenant_id, period_start, period_end, status')
    .eq('id', id)
    .eq('audience', 'tenant')
    .eq('tenant_id', session.tenantId)
    .in('status', ['approved', 'sent'])
    .maybeSingle();
  if (!statement) return NextResponse.json({ error: { code: 'not_found', message: 'Statement not found.' } }, { status: 404 });

  try {
    const { data: charges, error } = await service
      .from('utility_charges')
      .select('id, dispute_status')
      .eq('property_id', statement.property_id)
      .eq('lease_id', statement.lease_id)
      .eq('period_start', statement.period_start)
      .neq('status', 'void');
    if (error) throw new Error(error.message);
    const toOpen = (charges ?? []).filter((c) => c.dispute_status !== 'open');
    for (const c of toOpen) {
      await disputeCharge(service, { chargeId: c.id, propertyId: statement.property_id, action: 'open', text: `Tenant query: ${parsed.data.reason}`, actorUserId: session.userId });
    }
    await notifyPropertyStaff(service, {
      orgId: statement.org_id,
      propertyId: statement.property_id,
      type: 'utility_dispute',
      title: 'A tenant has queried their utility statement',
      body: `Statement ${statement.period_start} to ${statement.period_end}: "${parsed.data.reason.slice(0, 200)}". The charges are marked disputed until resolved.`,
      relatedEntityType: 'utility_statements',
      relatedEntityId: statement.id,
      minRole: 'accountant',
    });
    return NextResponse.json({ disputed: toOpen.length, alreadyDisputed: (charges ?? []).length - toOpen.length }, { status: 201 });
  } catch (err) {
    return serverError('utility_dispute_failed', 'Could not record your query. Please try again.', 'tenant_portal.utility_dispute', err);
  }
}
