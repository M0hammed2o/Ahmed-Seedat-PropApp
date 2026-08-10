import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

const putSchema = z.object({
  settings: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        emailEnabled: z.boolean(),
        whatsappEnabled: z.boolean(),
      }),
    )
    .max(NOTIFICATION_CATEGORIES.length),
});

/**
 * GET/PUT /api/v1/organizations/:orgId/notification-settings (overnight platform pass,
 * WORKLOG.md this date) -- organization-level "Communication" section (Phase 5). Manager+ only,
 * same floor as editing the organization itself. A category with no row falls back to the
 * defaults dispatchEmail()/dispatchWhatsApp() already assume (email on, WhatsApp off) --
 * GET synthesizes those defaults for every category so the UI always has one row per category
 * to render, without requiring a seed migration.
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

  const canView = await requireOrgRole(supabase, orgId, 'viewer');
  if (!canView) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to view this.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('organization_notification_settings')
    .select('category, email_enabled, whatsapp_enabled')
    .eq('org_id', orgId);
  if (error) {
    return NextResponse.json(
      { error: { code: 'notification_settings_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const byCategory = new Map((data ?? []).map((row) => [row.category, row]));
  const settings = NOTIFICATION_CATEGORIES.map((category) => {
    const existing = byCategory.get(category);
    return {
      category,
      emailEnabled: existing?.email_enabled ?? true,
      whatsappEnabled: existing?.whatsapp_enabled ?? false,
    };
  });

  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

  const canManage = await requireOrgRole(supabase, orgId, 'manager');
  if (!canManage) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to change communication settings.',
        },
      },
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
  const parsed = putSchema.safeParse(body);
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

  const { error } = await supabase.from('organization_notification_settings').upsert(
    parsed.data.settings.map((s) => ({
      org_id: orgId,
      category: s.category,
      email_enabled: s.emailEnabled,
      whatsapp_enabled: s.whatsappEnabled,
    })),
    { onConflict: 'org_id,category' },
  );
  if (error) {
    return NextResponse.json(
      { error: { code: 'notification_settings_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
