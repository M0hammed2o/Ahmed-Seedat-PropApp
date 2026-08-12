import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { complianceAcknowledgeSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';
import { dispatchEmail } from '@/lib/emailDispatch';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/tenant-portal/compliance/:id/acknowledge (PHASE 4). Thin wrapper over
 * acknowledge_compliance_requirement() -- the RPC does all real validation/idempotency; this
 * route's job is auth + rate limiting + resolving the trusted client IP/user-agent to pass through
 * as evidence (a Postgres function has no reliable access to the real client IP via PostgREST,
 * so this is resolved here the same way rateLimitOrRespond's own callers already do).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const limited = await rateLimitOrRespond(
    supabase,
    `compliance-acknowledge:user:${user.id}`,
    20,
    60,
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = complianceAcknowledgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  // resolveTrustedClientIp() can return the literal sentinel 'unverified-origin' when no
  // trustworthy signal is present (e.g. local dev with no proxy) -- that string is not a valid
  // Postgres `inet` value, so it must never be passed through as one.
  const trustedIp = resolveTrustedClientIp(request);
  const ipAddress = isIP(trustedIp) !== 0 ? trustedIp : null;

  const { data: acknowledgementId, error } = await supabase.rpc(
    'acknowledge_compliance_requirement',
    {
      p_requirement_id: id,
      p_acceptance_statement: parsed.data.acceptanceStatement,
      p_ip_address: ipAddress,
      p_user_agent: request.headers.get('user-agent'),
    },
  );
  if (error) {
    const notFound = /not found/i.test(error.message);
    const conflict = /waived|superseded/i.test(error.message);
    return NextResponse.json(
      {
        error: {
          code: notFound ? 'not_found' : conflict ? 'conflict' : 'acknowledge_failed',
          message: error.message,
        },
      },
      { status: notFound ? 404 : conflict ? 409 : 400 },
    );
  }

  // Best-effort staff notification -- never blocks or fails the acknowledgement response itself,
  // which has already committed. Notifies whoever created the rule (the natural "owner" of it),
  // gated by the 'compliance' category so a staff member who doesn't want this can opt out.
  try {
    const serviceClient = getServiceRoleClient();
    const { data: requirement } = await serviceClient
      .from('compliance_requirements')
      .select(
        `org_id, acknowledged_at, tenants(full_name), properties(nickname),
         property_rule_versions(version_number, property_rules(title, created_by))`,
      )
      .eq('id', id)
      .maybeSingle();
    const ruleVersion = requirement?.property_rule_versions as unknown as {
      version_number: number;
      property_rules: { title: string; created_by: string } | null;
    } | null;
    const rule = ruleVersion?.property_rules;
    if (requirement && rule) {
      const { data: creatorAuth } = await serviceClient.auth.admin.getUserById(rule.created_by);
      const toAddress = creatorAuth?.user?.email ?? null;
      const tenant = requirement.tenants as unknown as { full_name: string } | null;
      const property = requirement.properties as unknown as { nickname: string } | null;
      if (toAddress) {
        await dispatchEmail(serviceClient, {
          orgId: requirement.org_id,
          toAddress,
          toUserId: rule.created_by,
          templateName: 'compliance_requirement_acknowledged',
          templateVars: {
            tenantName: tenant?.full_name,
            ruleTitle: rule.title,
            versionNumber: ruleVersion?.version_number,
            propertyLabel: property?.nickname,
            acknowledgedAt: requirement.acknowledged_at,
          },
          relatedEntityType: 'compliance_acknowledgements',
          relatedEntityId: String(acknowledgementId),
          actorUserId: user.id,
        });
      }
    }
  } catch (notifyError) {
    console.error(
      '[tenant-portal/compliance/acknowledge] notification dispatch failed',
      notifyError,
    );
  }

  return NextResponse.json({ acknowledgementId });
}
