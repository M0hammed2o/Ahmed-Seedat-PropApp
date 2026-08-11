import { NextResponse, type NextRequest } from 'next/server';
import { createOrganizationSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';

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
      { error: { code: 'organization_create_failed', message: error.message } },
      { status: 500 },
    );
  }

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
