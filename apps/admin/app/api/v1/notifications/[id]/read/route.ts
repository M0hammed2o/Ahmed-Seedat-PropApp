import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapNotificationRow } from '@/lib/notifications';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/notifications/:id/read (API_SPEC.md §8). RLS (notifications_update_own) scopes this to the caller's own row. */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'notification_update_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Notification not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ notification: mapNotificationRow(data) });
}
