import { NextResponse, type NextRequest } from 'next/server';
import { completeProfileSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { normalizePhoneToE164 } from '@/lib/phone';

/**
 * POST /api/v1/profile/complete -- the "Complete Your Account" step (WORKLOG.md this date).
 * Server-authoritative: sets `profiles.profile_completed_at`, the sole marker
 * `isProfileComplete()` (lib/profileCompletion.ts) reads. Never trusts the client's own idea of
 * "am I complete" -- there is no client-settable flag anywhere in this path.
 *
 * `display_name` is derived from first + last name (no separate field collected) unless a
 * display name is already set (e.g. an OAuth user whose provider-supplied name populated it) --
 * matches the "optionally derive... unless there is a real product reason to ask separately"
 * instruction; no such reason was found for this product.
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

  const limited = await rateLimitOrRespond(supabase, `profile-complete:user:${user.id}`, 10, 60);
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

  const parsed = completeProfileSchema.safeParse(body);
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

  const phoneE164 = normalizePhoneToE164(parsed.data.phone);
  if (!phoneE164) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: {
            phone: ['Enter a valid phone number, e.g. 082 123 4567 or +27821234567'],
          },
        },
      },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const displayName = existing?.display_name?.trim()
    ? existing.display_name
    : `${parsed.data.firstName} ${parsed.data.lastName}`.trim();

  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone_e164: phoneE164,
      display_name: displayName,
      profile_completed_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'profile_update_failed',
          message: 'Could not save your profile. Try again.',
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ profileCompleted: true });
}
