import { NextResponse, type NextRequest } from 'next/server';
import { complianceWaiveSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/compliance-requirements/:id/waive. Thin wrapper over
 * waive_compliance_requirement() (SECURITY DEFINER -- agent+, requires a reason, only a
 * pending/viewed requirement can be waived). Audit event is written inside the RPC itself. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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
  const parsed = complianceWaiveSchema.safeParse(body);
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

  const { error } = await supabase.rpc('waive_compliance_requirement', {
    p_requirement_id: id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const forbidden = /permission|agent/i.test(error.message);
    const notFound = /not found/i.test(error.message);
    return NextResponse.json(
      {
        error: {
          code: forbidden ? 'forbidden' : notFound ? 'not_found' : 'waive_failed',
          message: error.message,
        },
      },
      { status: forbidden ? 403 : notFound ? 404 : 400 },
    );
  }

  return NextResponse.json({ waived: true });
}
