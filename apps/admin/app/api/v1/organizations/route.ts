import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * Best-effort referral attribution (V1 launch-completion pass, WORKLOG.md this date) -- runs
 * AFTER create_organization() has already committed, using the SERVICE-ROLE client (this table
 * has no client-facing RLS policy at all, matching public.admin_users' isolation pattern). Never
 * throws: any failure here is logged server-side only and must never surface as an org-creation
 * failure to the caller -- referral tracking is a nice-to-have, not part of the signup contract.
 *
 * Resolution: an unknown/invalid/inactive code is NOT an error -- it just fails to resolve a
 * partner, and the row is still written with referral_partner_id null so a fallback name (if any)
 * is preserved. If neither a code nor a name was supplied, no row is written at all (this is
 * genuinely optional). `ON CONFLICT (org_id) DO NOTHING` makes a retried/duplicate signup request
 * a no-op rather than a duplicate or silent overwrite of an already-set attribution.
 */
async function attributeReferralBestEffort(
  orgId: string,
  referralCode: string | undefined,
  referrerName: string | undefined,
) {
  if (!referralCode && !referrerName) return;

  try {
    const serviceClient = getServiceRoleClient();
    const normalizedCode = referralCode ? referralCode.trim().toLowerCase() : null;

    let referralPartnerId: string | null = null;
    if (normalizedCode) {
      const { data: partner } = await serviceClient
        .from('referral_partners')
        .select('id')
        .eq('referral_code', normalizedCode)
        .eq('active', true)
        .maybeSingle();
      referralPartnerId = partner?.id ?? null;
    }

    // upsert(..., { ignoreDuplicates: true }) compiles to a real `insert ... on conflict (org_id)
    // do nothing` -- a retried/duplicate signup request is a silent no-op, never a duplicate row
    // and never an overwrite of an already-set attribution (org_id is the primary key).
    const { error } = await serviceClient.from('organization_referral_attributions').upsert(
      {
        org_id: orgId,
        referral_partner_id: referralPartnerId,
        referral_code_used: normalizedCode,
        fallback_referrer_name: referralPartnerId ? null : (referrerName?.trim() ?? null),
      },
      { onConflict: 'org_id', ignoreDuplicates: true },
    );
    if (error) {
      console.error('[referral] failed to write organization_referral_attributions row', error.message);
    }
  } catch (err) {
    console.error('[referral] unexpected error attributing referral', err);
  }
}

/**
 * POST /api/v1/organizations — org signup (API_SPEC.md §2, TASKS.md M4).
 *
 * Calls `create_organization()` (supabase/migrations/20260101000021), the only sanctioned way
 * to create an `organizations` row — it atomically creates the org and the caller's `principal`
 * membership in one transaction, so an org can never exist with zero members (DATABASE.md §2's
 * invariant). Uses the caller's own session-bound client, never the service-role client — the
 * RPC is `security definer` specifically so it can insert the first membership row for a caller
 * who (by definition) has no membership yet, not so this route can act with elevated privilege.
 *
 * Does not yet write an `audit_events` row — see TECHNICAL_DEBT_REGISTER.md TD-14: the live
 * `audit_events` schema doesn't match DATABASE.md's target shape yet, and inserting against the
 * wrong shape would be worse than not inserting at all. Tracked, not silently skipped.
 */
export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = createOrganizationSchema.safeParse(body);
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

  const { data: orgId, error } = await supabase.rpc('create_organization', {
    p_legal_name: parsed.data.legalName,
    p_org_type: parsed.data.orgType,
  });

  if (error) {
    // Owner subscription + staff seat entitlement architecture (WORKLOG.md this date):
    // create_organization() itself raises this specific, parseable message (migration
    // 20260101000094) when the caller is a "linked owner only" account -- has an owners.user_id
    // row somewhere, zero organization_members rows of their own -- and has not been granted an
    // owner_portfolio_grants row. Surfaced as 402 with a distinct error code so the client can
    // show a real upgrade/paywall flow (CreateOrganizationForm) instead of a bare, unexplained
    // 403/500 -- this is the ACTUAL enforcement point (inside the RPC, callable directly over
    // PostgREST); this branch only exists to translate that into a friendlier response shape.
    if (error.message.startsWith('owner_subscription_required')) {
      return NextResponse.json(
        {
          error: {
            code: 'owner_subscription_required',
            message:
              'An active Proplyst owner subscription is required to create your own portfolio. You can still view any properties shared with you.',
          },
        },
        { status: 402 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: 'organization_create_failed',
          message: safeErrorMessage(
            error,
            'Could not create your organization. Please try again, or contact support if this continues.',
            'create_organization',
          ),
        },
      },
      { status: 500 },
    );
  }

  // Referral attribution (V1 launch-completion pass) -- fires only after create_organization()
  // has actually committed; never awaited into the error path above, and never able to change the
  // response returned to the caller either way (see attributeReferralBestEffort's own comment).
  await attributeReferralBestEffort(orgId as string, parsed.data.referralCode, parsed.data.referrerName);

  return NextResponse.json({ id: orgId, legalName: parsed.data.legalName }, { status: 201 });
}

/**
 * GET /api/v1/organizations — list the caller's own organization memberships (not documented as
 * a separate line in API_SPEC.md §2, which lists per-org GET; this is the "which orgs do I
 * belong to" list a portal switcher needs, naturally implemented via resolvePortalSession()
 * rather than a bespoke query, since that's exactly what it resolves).
 */
export async function GET() {
  const session = await resolvePortalSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  return NextResponse.json({ organizations: session.organizations });
}
