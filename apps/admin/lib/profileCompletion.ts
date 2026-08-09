import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseClient } from './supabase/server';

/**
 * Production signup/onboarding (WORKLOG.md this date). `profiles.profile_completed_at`
 * (migration 20260101000077) is the sole, server-owned completion marker -- set once, at
 * submission time, by POST /api/v1/profile/complete. Never inferred from whether
 * first_name/last_name/phone_e164 happen to be non-null (a user who later clears an optional
 * field elsewhere should not silently become "incomplete" again and get re-gated).
 */
export async function isProfileComplete(supabaseClient?: SupabaseClient): Promise<boolean> {
  const supabase = supabaseClient ?? (await getServerSupabaseClient());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('profiles')
    .select('profile_completed_at')
    .eq('id', user.id)
    .maybeSingle();

  return Boolean(data?.profile_completed_at);
}
