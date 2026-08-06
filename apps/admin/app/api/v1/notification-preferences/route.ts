import { NextResponse, type NextRequest } from 'next/server';
import { notificationPreferenceUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationPreferenceRow } from '@/lib/notifications';

/**
 * GET/PATCH /api/v1/notification-preferences (API_SPEC.md §8). PATCH upserts one category's
 * settings for the caller -- RLS (notification_preferences_all_own) scopes every operation to
 * the caller's own rows, and the (user_id, category) primary key makes the upsert idempotent.
 */
export async function GET() {
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

  const { data, error } = await supabase.from('notification_preferences').select('*');
  if (error) {
    return NextResponse.json(
      { error: { code: 'notification_preferences_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    notificationPreferences: (data ?? []).map(mapNotificationPreferenceRow),
  });
}

export async function PATCH(request: NextRequest) {
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

  const parsed = notificationPreferenceUpdateSchema.safeParse(body);
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

  const patch: Record<string, unknown> = { user_id: user.id, category: parsed.data.category };
  if (parsed.data.emailEnabled !== undefined) patch.email_enabled = parsed.data.emailEnabled;
  if (parsed.data.pushEnabled !== undefined) patch.push_enabled = parsed.data.pushEnabled;
  if (parsed.data.whatsappEnabled !== undefined)
    patch.whatsapp_enabled = parsed.data.whatsappEnabled;

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(patch, { onConflict: 'user_id,category' })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'notification_preference_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ notificationPreference: mapNotificationPreferenceRow(data) });
}
