import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient, DEMO_MODE } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * Resolves the signed-in user's first active organization membership — a minimal mobile-side
 * counterpart to apps/admin's resolvePortalSession() (TASKS.md M2), scoped down to "just the one
 * org id a create-property call needs" rather than the full multi-portal identity resolution,
 * since this Expo app has no org-switcher UI yet (that's native-app work, MOBILE_ARCHITECTURE_DECISION.md
 * M21/M22 — this hook exists to keep the real, non-demo Supabase code path correctly org-scoped
 * in the meantime, not to be the long-term multi-org UX).
 *
 * Deliberately a new, standalone hook rather than an addition to AuthProvider.tsx — that file has
 * unrelated in-progress changes as of 2026-07-30 that this work must not touch or risk
 * conflicting with (see WORKLOG.md).
 */
export function useCurrentOrgId() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['current-org-id', userId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await getSupabaseClient()
        .from('organization_members')
        .select('org_id')
        .eq('user_id', userId as string)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.org_id as string | undefined) ?? null;
    },
    enabled: !DEMO_MODE && Boolean(userId),
  });
}
