import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';

const acceptInviteSchema = z.object({ token: z.string().uuid('Invalid invite token.') });

/**
 * POST /api/v1/organizations/invites/accept (API_SPEC.md §2's accept flow, exposed at the
 * account level since a token, not an org id, is the input — the caller doesn't know which org
 * they're joining until the token resolves).
 *
 * Calls `accept_organization_invite()` (supabase/migrations/20260101000021), which validates the
 * token against the *signed-in user's own email* server-side — never trusts a client-supplied
 * email — so user A cannot accept an invite addressed to user B by guessing/leaking a token.
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

  const limited = await rateLimitOrRespond(
    supabase,
    `invite-accept:${user.id}`,
    RATE_LIMITS.inviteAcceptAttemptsPerMinute,
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

  const parsed = acceptInviteSchema.safeParse(body);
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

  const { data: orgId, error } = await supabase.rpc('accept_organization_invite', {
    p_token: parsed.data.token,
  });

  if (error) {
    // Staff invitation flow audit (this date): a seat-capacity rejection (migration
    // 20260101000123) is a real, distinct outcome — the invite is still genuinely valid and
    // addressed to this account, it just can't be accepted right now — so it gets its own code
    // and a non-404 status, unlike the generic "not found/expired/wrong email" bucket below (which
    // stays 404, never 403, so a guessed/leaked token still can't be used to distinguish "wrong
    // email" from "doesn't exist," API_SPEC.md §0's org-enumeration rule).
    if (error.message.startsWith('staff_seat_limit_reached')) {
      return NextResponse.json(
        {
          error: {
            code: 'staff_seat_limit_reached',
            message:
              'This organization has no remaining staff seats available right now. Ask the organization to free up a seat or upgrade their plan, then try again.',
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: 'invite_not_found',
          message: 'Invite not found, expired, or not addressed to your account.',
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ orgId });
}
