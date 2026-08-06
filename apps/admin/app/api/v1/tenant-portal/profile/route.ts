import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';

// GET/PATCH /api/v1/tenant-portal/profile (PWA_V1_COMPLETION_PLAN.md #11). A tenant's own contact
// info (tenants.email/phone) -- distinct from /api/v1/profile (auth display name, shared across
// every identity system) and from the org-staff PATCH /api/v1/tenants/:id (which any accountant+
// can edit for any tenant in their org). This route only ever touches the caller's own row,
// resolved via resolveTenantSession() the same way every other (tenant) route does, and only ever
// writes email/phone -- full_name/status/id_number_ref stay staff-managed, matching
// tenants_update_self's RLS (migration 20260101000056) which permits the row but relies on this
// API-layer whitelist to restrict which columns move (PERMISSIONS.md §5 layer 2).
const tenantContactUpdateSchema = z.object({
  email: z.string().email('Enter a valid email address').optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
});

export async function GET() {
  const session = await resolveTenantSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('tenants')
    .select('full_name, email, phone')
    .eq('id', session.tenantId)
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tenant: { fullName: data.full_name, email: data.email, phone: data.phone },
  });
}

export async function PATCH(request: NextRequest) {
  const session = await resolveTenantSession();
  if (!session) {
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

  const parsed = tenantContactUpdateSchema.safeParse(body);
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

  const patch: Record<string, unknown> = {};
  if (parsed.data.email !== undefined) patch.email = parsed.data.email;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('tenants')
    .update(patch)
    .eq('id', session.tenantId)
    .select('full_name, email, phone')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    tenant: { fullName: data.full_name, email: data.email, phone: data.phone },
  });
}
