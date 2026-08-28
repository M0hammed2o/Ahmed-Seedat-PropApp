import { PageHeader } from '@/components/ui/PageHeader';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { listPlatformOrganizations } from '@/lib/superAdmin';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { ReferralsClient, type ReferralAttributionRow, type ReferralPartnerRow } from './ReferralsClient';

/**
 * Platform Admin > Referrals (V1 launch-completion pass, WORKLOG.md this date). Lists referral
 * partners and which organizations were attributed to them at signup. Deliberately no
 * commission/payout/partner-portal UI here -- V1.1 scope, not built.
 *
 * Demo mode has no referral mock dataset (this feature postdates adminMockData.ts) -- shown as an
 * honest empty state rather than either crashing or fabricating rows, same pattern
 * platform-admin/system's "Not configured" feature-flags section already uses.
 */
async function getReferralPartners(): Promise<ReferralPartnerRow[]> {
  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('referral_partners')
    .select('id, name, referral_code, active, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch referral_partners: ${error.message}`);

  const { data: attributions, error: attributionsError } = await serviceClient
    .from('organization_referral_attributions')
    .select('referral_partner_id')
    .not('referral_partner_id', 'is', null);
  if (attributionsError)
    throw new Error(`Failed to fetch organization_referral_attributions: ${attributionsError.message}`);
  const counts = new Map<string, number>();
  for (const row of attributions ?? []) {
    const id = row.referral_partner_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    referralCode: row.referral_code as string,
    active: row.active as boolean,
    createdAt: row.created_at as string,
    referredOrganizationsCount: counts.get(row.id as string) ?? 0,
  }));
}

async function getReferredOrganizations(): Promise<ReferralAttributionRow[]> {
  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('organization_referral_attributions')
    .select(
      `org_id, referral_partner_id, referral_code_used, fallback_referrer_name, attributed_at,
       organizations ( legal_name ),
       referral_partners ( name )`,
    )
    .order('attributed_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch organization_referral_attributions: ${error.message}`);

  const rows = data ?? [];
  const orgIds = rows.map((r) => r.org_id as string);

  // Plan/status reuses lib/superAdmin.ts's listPlatformOrganizations() -- the SAME helper
  // platform-admin/customers and platform-admin/subscriptions already use -- rather than
  // re-implementing that subscription/plan lookup here. `beforeFilter` is repurposed as an
  // arbitrary PostgREST `.or()` clause (`id.in.(...)`) restricting the result to exactly these
  // attributed orgs; every org id is a server-generated UUID, never user-supplied text.
  const planByOrg = new Map<string, { planName: string | null; subscriptionStatus: string | null }>();
  if (orgIds.length > 0) {
    const summaries = await listPlatformOrganizations(
      serviceClient,
      {},
      { limit: orgIds.length, beforeFilter: `id.in.(${orgIds.join(',')})` },
    );
    for (const s of summaries)
      planByOrg.set(s.orgId, { planName: s.planName, subscriptionStatus: s.subscriptionStatus });
  }

  return rows.map((row) => {
    const org = row.organizations as unknown as { legal_name: string } | null;
    const partner = row.referral_partners as unknown as { name: string } | null;
    const plan = planByOrg.get(row.org_id as string);
    return {
      orgId: row.org_id as string,
      orgLegalName: org?.legal_name ?? '(unknown org)',
      referralPartnerName: partner?.name ?? null,
      fallbackReferrerName: row.fallback_referrer_name as string | null,
      referralCodeUsed: row.referral_code_used as string | null,
      attributedAt: row.attributed_at as string,
      planName: plan?.planName ?? null,
      subscriptionStatus: plan?.subscriptionStatus ?? null,
    };
  });
}

export default async function ReferralsPage() {
  // Authorization: enforced by the (super-admin) layout's own gate -- see lib/auth.ts's
  // resolveAdminGate() comment for why this page must not re-check with its own throwing call.
  const [partners, organizations] = ADMIN_DEMO_MODE
    ? [[], []]
    : await Promise.all([getReferralPartners(), getReferredOrganizations()]);

  return (
    <div>
      <PageHeader
        title="Referrals"
        subtitle="Referral partners and which organizations they brought in at signup."
        actions={
          ADMIN_DEMO_MODE ? (
            <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
              Demo data
            </span>
          ) : undefined
        }
      />
      <div className="mt-6">
        {ADMIN_DEMO_MODE ? (
          <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
            Not available in demo mode — referrals data comes from the live database.
          </p>
        ) : (
          <ReferralsClient initialPartners={partners} initialOrganizations={organizations} />
        )}
      </div>
    </div>
  );
}
