import { NextResponse, type NextRequest } from 'next/server';
import { referralPartnerCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET/POST /api/v1/admin/referral-partners (V1 launch-completion pass, WORKLOG.md this date) --
 * super_admin only, mirrors owner-portfolio-grants/route.ts's exact structure/conventions. Manages
 * the platform-admin-only allow-list of referral partners and their unique signup codes.
 * Deliberately no commission/payout/rate fields anywhere -- V1.1 scope, not built here.
 */
export async function GET() {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('referral_partners')
    .select('id, name, referral_code, active, created_at, created_by')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_partners_list_failed',
          message: safeErrorMessage(error, 'Could not load referral partners.', 'referralPartners.list'),
        },
      },
      { status: 500 },
    );
  }

  // "referred organizations" count per partner (V1 admin scale -- a grouped count via a single
  // extra read is simpler and cheaper here than a bespoke RPC; referral_partner_id has an index).
  const { data: attributions, error: attributionsError } = await serviceClient
    .from('organization_referral_attributions')
    .select('referral_partner_id')
    .not('referral_partner_id', 'is', null);
  if (attributionsError) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_partners_list_failed',
          message: safeErrorMessage(attributionsError, 'Could not load referral partners.', 'referralPartners.list.attributions'),
        },
      },
      { status: 500 },
    );
  }
  const countsByPartner = new Map<string, number>();
  for (const row of attributions ?? []) {
    const partnerId = row.referral_partner_id as string;
    countsByPartner.set(partnerId, (countsByPartner.get(partnerId) ?? 0) + 1);
  }

  return NextResponse.json({
    referralPartners: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      referralCode: row.referral_code,
      active: row.active,
      createdAt: row.created_at,
      createdBy: row.created_by,
      referredOrganizationsCount: countsByPartner.get(row.id as string) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = referralPartnerCreateSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();
  const normalizedCode = parsed.data.referralCode.trim().toLowerCase();

  const { data, error } = await serviceClient
    .from('referral_partners')
    .insert({
      name: parsed.data.name,
      referral_code: normalizedCode,
      created_by: guard.session.authUserId,
    })
    .select('id, name, referral_code, active, created_at, created_by')
    .single();
  if (error) {
    // Never surface the raw Postgres unique-constraint-violation message to the client.
    if (error.code === '23505') {
      return NextResponse.json(
        {
          error: {
            code: 'referral_code_taken',
            message: 'This referral code is already in use by another partner.',
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: 'referral_partner_create_failed',
          message: safeErrorMessage(
            error,
            'Could not create this referral partner. Please try again, or contact support if this continues.',
            'referralPartners.create',
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'referral_partner.created',
    entityType: 'referral_partners',
    entityId: data.id,
    after: { name: data.name, referralCode: data.referral_code },
  });

  return NextResponse.json(
    {
      referralPartner: {
        id: data.id,
        name: data.name,
        referralCode: data.referral_code,
        active: data.active,
        createdAt: data.created_at,
        createdBy: data.created_by,
        referredOrganizationsCount: 0,
      },
    },
    { status: 201 },
  );
}
