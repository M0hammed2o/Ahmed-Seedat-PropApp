import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/owners/:id/link-self (owner + staff access completion pass, WORKLOG.md this date)
 * -- thin wrapper over link_owner_to_self() (migration 20260101000088), which does all real
 * authorization (manager+ org role, not-already-linked, email match if the owner record has one).
 * This route adds no authorization of its own beyond requiring an authenticated caller -- exactly
 * the same shape as /api/v1/owner-invitations/accept.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  // Production incident fix (WORKLOG.md this date): a stale PostgREST schema cache turned
  // "function not found" into a Supabase client error INSIDE the code below, which was already
  // returned as JSON -- but a genuinely uncaught exception anywhere in this handler (a network
  // failure constructing the client, .auth.getUser() itself throwing, etc.) would otherwise let
  // Next.js's own default error response reach the browser, which is not guaranteed to be JSON.
  // Every API route in this app returning NextResponse.json() on the happy/expected-error paths
  // was never enough on its own -- this outer catch is the actual guarantee.
  try {
    const { id: ownerId } = await params;
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

    const { data, error } = await supabase.rpc('link_owner_to_self', { p_owner_id: ownerId });
    if (error) {
      return NextResponse.json(
        { error: { code: 'owner_self_link_failed', message: error.message } },
        { status: 500 },
      );
    }

    const result = data?.[0];
    if (!result || !result.success) {
      return NextResponse.json(
        {
          error: {
            code: result?.error_code ?? 'unknown',
            message:
              LINK_ERROR_MESSAGES[result?.error_code as string] ??
              'Could not link this owner record.',
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ ownerId: result.owner_id });
  } catch (err) {
    console.error('[owners/link-self] unhandled error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 },
    );
  }
}

const LINK_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'Owner not found.',
  forbidden: 'Only a manager or principal can link an owner record.',
  already_linked: 'This owner record is already linked to a different account.',
  email_mismatch: 'This owner record has an email on file that does not match your account.',
};
