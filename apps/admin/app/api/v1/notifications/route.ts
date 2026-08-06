import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationRow } from '@/lib/notifications';

/** GET /api/v1/notifications (API_SPEC.md §8) -- the caller's own, per RLS (notifications_select_own). */
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

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: { code: 'notifications_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ notifications: (data ?? []).map(mapNotificationRow) });
}
