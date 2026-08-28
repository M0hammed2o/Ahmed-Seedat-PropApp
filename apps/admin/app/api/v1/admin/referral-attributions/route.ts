import { NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET /api/v1/admin/referral-attributions -- super_admin only. Lists every organization's referral
 * attribution row (there is at most one per org, org_id is the primary key), joined with the
 * organization's legal name and the resolved partner's name/code where one exists. Subscription
 * plan/status is deliberately NOT joined here -- the referrals admin page (platform-admin/
 * referrals/page.tsx) reuses lib/superAdmin.ts's existing listPlatformOrganizations() for that,
 * rather than this route re-implementing the same plan/subscription lookup a second time.
 */
export async function GET() {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('organization_referral_attributions')
    .select(
      `org_id, referral_partner_id, referral_code_used, fallback_referrer_name, attributed_at,
       corrected_by, corrected_at,
       organizations ( legal_name ),
       referral_partners ( name, referral_code )`,
    )
    .order('attributed_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'referral_attributions_list_failed',
          message: safeErrorMessage(error, 'Could not load referral attributions.', 'referralAttributions.list'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    attributions: (data ?? []).map((row) => {
      const org = row.organizations as unknown as { legal_name: string } | null;
      const partner = row.referral_partners as unknown as { name: string; referral_code: string } | null;
      return {
        orgId: row.org_id,
        orgLegalName: org?.legal_name ?? null,
        referralPartnerId: row.referral_partner_id,
        referralPartnerName: partner?.name ?? null,
        referralPartnerCode: partner?.referral_code ?? null,
        referralCodeUsed: row.referral_code_used,
        fallbackReferrerName: row.fallback_referrer_name,
        attributedAt: row.attributed_at,
        correctedBy: row.corrected_by,
        correctedAt: row.corrected_at,
      };
    }),
  });
}
