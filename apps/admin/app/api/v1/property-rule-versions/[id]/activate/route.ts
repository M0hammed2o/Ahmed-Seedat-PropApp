import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { dispatchEmail } from '@/lib/emailDispatch';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/property-rule-versions/:id/activate. Thin wrapper over
 * activate_property_rule_version() (SECURITY DEFINER -- does the real authorization/supersession/
 * requirement-assignment work atomically). This route's only added job is a best-effort
 * notification to every tenant who was just assigned a fresh requirement -- reuses dispatchEmail()
 * exactly like every other notification in this codebase (respects
 * notification_preferences/organization_notification_settings, never fabricates a "sent" result,
 * never blocks the activation itself if a send fails).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { data: assignedCount, error } = await supabase.rpc('activate_property_rule_version', {
    p_version_id: id,
  });
  if (error) {
    const forbidden = /permission|agent/i.test(error.message);
    const notFound = /not found/i.test(error.message);
    return NextResponse.json(
      {
        error: {
          code: forbidden ? 'forbidden' : notFound ? 'not_found' : 'activation_failed',
          message: error.message,
        },
      },
      { status: forbidden ? 403 : notFound ? 404 : 500 },
    );
  }

  // Best-effort notification -- never blocks or fails the activation response itself; a
  // notification-dispatch error is only logged, never surfaced as an activation failure (the
  // activation already committed).
  try {
    const serviceClient = getServiceRoleClient();
    const { data: version } = await serviceClient
      .from('property_rule_versions')
      .select('org_id, rule_id, property_rules(title, property_id, properties(nickname))')
      .eq('id', id)
      .maybeSingle();
    if (version) {
      const ruleTitle =
        (version.property_rules as unknown as { title: string } | null)?.title ?? 'a rule';
      const propertyLabel =
        (
          version.property_rules as unknown as {
            properties: { nickname: string } | null;
          } | null
        )?.properties?.nickname ?? 'your rental';
      const { data: org } = await serviceClient
        .from('organizations')
        .select('trading_name, legal_name')
        .eq('id', version.org_id)
        .maybeSingle();
      const orgName = org?.trading_name ?? org?.legal_name ?? 'your property manager';

      const { data: requirements } = await serviceClient
        .from('compliance_requirements')
        .select('id, tenants(email)')
        .eq('rule_version_id', id)
        .eq('status', 'pending');

      for (const req of requirements ?? []) {
        const tenant = req.tenants as unknown as { email: string | null } | null;
        if (!tenant?.email) continue;
        await dispatchEmail(serviceClient, {
          orgId: version.org_id,
          toAddress: tenant.email,
          toUserId: null,
          templateName: 'compliance_requirement_assigned',
          templateVars: { orgName, ruleTitle, propertyLabel },
          relatedEntityType: 'compliance_requirements',
          relatedEntityId: req.id,
          actorUserId: user.id,
        });
      }
    }
  } catch (notifyError) {
    console.error('[property-rule-versions/activate] notification dispatch failed', notifyError);
  }

  return NextResponse.json({ requirementsAssigned: assignedCount });
}
