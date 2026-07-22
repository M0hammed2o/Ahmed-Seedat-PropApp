import { isDemoMode } from '@propvault/config';

/**
 * Server- and client-safe: `NEXT_PUBLIC_*` vars are inlined at build time either way. When true,
 * every admin page reads from lib/demo/adminMockData.ts instead of a live Supabase project —
 * see DECISIONS.md (Phase 2 entry) and ADMIN_DASHBOARD.md for why this exists.
 *
 * SECURITY: demo mode also makes `/login` accept any credentials and skips the auth check in
 * both `middleware.ts` and `lib/auth.ts` entirely (see those files). It defaults ON when the
 * variable is unset — deliberate, so the dashboard works with zero setup for a sales demo — but
 * that means an unset variable in a real deployment is a full authentication bypass, not a safe
 * default. This warning fires on every server start specifically so that risk is never silent.
 * SECURITY.md documents this as release-blocking: NEXT_PUBLIC_DEMO_MODE=false must be set
 * before any deployment that touches real customer data.
 */
export const ADMIN_DEMO_MODE = isDemoMode(process.env.NEXT_PUBLIC_DEMO_MODE);

if (ADMIN_DEMO_MODE && typeof window === 'undefined') {
  console.warn(
    '[PropVault] NEXT_PUBLIC_DEMO_MODE is ON — admin login accepts ANY credentials and all data is mock. ' +
      'Set NEXT_PUBLIC_DEMO_MODE=false before deploying anywhere real customers or data could be exposed.',
  );
}
