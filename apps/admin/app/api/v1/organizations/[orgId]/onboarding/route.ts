import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import {
  resolveOnboardingProgress,
  skipStaffOnboardingStep,
  markOnboardingIntroViewed,
  setWalkthroughState,
} from '@/lib/onboarding';

type RouteParams = { params: Promise<{ orgId: string }> };

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip_staff') }),
  z.object({ action: z.literal('mark_intro_viewed'), intro: z.enum(['payments', 'documents']) }),
  z.object({ action: z.literal('walkthrough'), state: z.enum(['dismissed', 'completed']) }),
]);

/**
 * GET/POST /api/v1/organizations/:orgId/onboarding -- V1 commercial onboarding pass, Phase 4.
 * GET returns the live-resolved checklist (resolveOnboardingProgress() itself does all the real
 * work, querying properties/units/tenants/leases/staff/commercial-setup state directly -- this
 * route is a thin, auth-checked wrapper). POST records the handful of facts that genuinely can't
 * be derived from system state (an explicit skip, a viewed intro, walkthrough dismissal) --
 * agent+ floor, matching organization_onboarding_state's own RLS (this is shared per-org UI
 * progress, not a principal-only billing concern).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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
  const canRead = await requireOrgRole(supabase, orgId, 'viewer');
  if (!canRead) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Not a member of this organization.' } },
      { status: 403 },
    );
  }

  const progress = await resolveOnboardingProgress(supabase, orgId);
  return NextResponse.json(progress);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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
  const canWrite = await requireOrgRole(supabase, orgId, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Not authorized to update onboarding progress.' } },
      { status: 403 },
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
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the request body.' } },
      { status: 400 },
    );
  }

  if (parsed.data.action === 'skip_staff') {
    await skipStaffOnboardingStep(supabase, orgId);
  } else if (parsed.data.action === 'mark_intro_viewed') {
    await markOnboardingIntroViewed(supabase, orgId, parsed.data.intro);
  } else {
    await setWalkthroughState(supabase, orgId, parsed.data.state);
  }

  const progress = await resolveOnboardingProgress(supabase, orgId);
  return NextResponse.json(progress);
}
