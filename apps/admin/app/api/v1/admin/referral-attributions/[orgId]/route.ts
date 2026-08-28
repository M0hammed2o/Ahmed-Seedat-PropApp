import { NextResponse, type NextRequest } from 'next/server';
import { referralAttributionCorrectionSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * PATCH /api/v1/admin/referral-attributions/:orgId -- super_admin only, mirrors
 * owner-portfolio-grants/route.ts's exact structure/conventions. The ONLY sanctioned way to
 * change an organization's referral attribution after signup (POST /api/v1/organizations writes
 * it once, `ON CONFLICT (org_id) DO NOTHING`, and never touches an existing row). Stamps
 * corrected_by/corrected_at and writes an audit event, same as every other admin mutation here.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = referralAttributionCorrectionSchema.safeParse(body);
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
  const { data: before } = await serviceClient
    .from('organization_referral_attributions')
    .select('org_id, referral_partner_id, fallback_referrer_name')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!before) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_attribution_not_found',
          message: 'This organization has no referral attribution to correct.',
        },
      },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {
    corrected_by: guard.session.authUserId,
    corrected_at: new Date().toISOString(),
  };
  if ('referralPartnerId' in parsed.data) updates.referral_partner_id = parsed.data.referralPartnerId ?? null;
  if ('fallbackReferrerName' in parsed.data)
    updates.fallback_referrer_name = parsed.data.fallbackReferrerName ?? null;

  const { data, error } = await serviceClient
    .from('organization_referral_attributions')
    .update(updates)
    .eq('org_id', orgId)
    .select(
      'org_id, referral_partner_id, referral_code_used, fallback_referrer_name, attributed_at, corrected_by, corrected_at',
    )
    .single();
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_attribution_update_failed',
          message: safeErrorMessage(
            error,
            'Could not update this referral attribution. Please try again, or contact support if this continues.',
            'referralAttributions.update',
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'referral_attribution.corrected',
    entityType: 'organization_referral_attributions',
    entityId: orgId,
    before: { referralPartnerId: before.referral_partner_id, fallbackReferrerName: before.fallback_referrer_name },
    after: { referralPartnerId: data.referral_partner_id, fallbackReferrerName: data.fallback_referrer_name },
  });

  return NextResponse.json({
    attribution: {
      orgId: data.org_id,
      referralPartnerId: data.referral_partner_id,
      referralCodeUsed: data.referral_code_used,
      fallbackReferrerName: data.fallback_referrer_name,
      attributedAt: data.attributed_at,
      correctedBy: data.corrected_by,
      correctedAt: data.corrected_at,
    },
  });
}
