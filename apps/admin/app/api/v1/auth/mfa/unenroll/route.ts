import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const unenrollSchema = z.object({ factorId: z.string().min(1, 'factorId is required') });

/**
 * POST /api/v1/auth/mfa/unenroll (Stage 7, commercial-launch execution plan) -- removes one of
 * the caller's own TOTP factors. `mfa.unenroll()` only ever operates on the authenticated
 * caller's own factors (Supabase enforces this server-side against the session's own user id, not
 * something this route needs to re-check) -- no cross-account risk from accepting a bare
 * `factorId` here.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }

  const parsed = unenrollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.', field_errors: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Sign in required.' } }, { status: 401 });
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) {
    return NextResponse.json({ error: { code: 'mfa_unenroll_failed', message: 'Could not remove this factor. Try again.' } }, { status: 500 });
  }

  return NextResponse.json({ removed: true });
}
