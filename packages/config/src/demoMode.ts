/**
 * Demo mode lets the full app be driven end-to-end by realistic in-memory mock data instead of
 * a live Supabase project — used for sales/client demos before a production backend is
 * provisioned. It is a parallel implementation behind the same repository/provider interfaces
 * used everywhere else (see ARCHITECTURE.md), never a fork of production logic, and it is
 * always visually flagged in the UI so demo data can never be mistaken for real customer data.
 *
 * SECURITY (fixed 2026-07-30, PRODUCTION_READINESS_REPORT.md R-01 / SECURITY.md — this is the
 * PropVault-era "defaults ON when unset" bug, now closed): an unset EXPO_PUBLIC_DEMO_MODE /
 * NEXT_PUBLIC_DEMO_MODE now means demo mode is OFF. Demo mode is something a developer opts
 * into explicitly, never something an operator must remember to opt out of. This alone is not
 * sufficient to enable the bypass, though — see `isDemoModeAllowed`/`resolveDemoMode` below for
 * the second, infra-level gate that actually determines whether the flag has any effect.
 */
export function isDemoMode(rawValue: string | undefined): boolean {
  return rawValue === 'true';
}

/**
 * The second, independent gate SECURITY.md requires: `ALLOW_DEMO_MODE` must be set at the
 * *infrastructure* level (the hosting platform's project environment configuration), never
 * shipped in a `.env` file bundled with the app. Deliberately NOT `NEXT_PUBLIC_`/`EXPO_PUBLIC_`
 * prefixed — on web this guarantees the value is never inlined into a client bundle (it's only
 * ever readable from server-only code, e.g. Next.js Server Components/Route Handlers/middleware
 * that import `server-only`), so no single client-side flag flip can re-enable the bypass. A
 * production environment's infra config must never set this variable at all — not "false",
 * genuinely absent — so there's no copy-pasted env file that silently re-enables it.
 */
export function isDemoModeAllowed(allowRawValue: string | undefined): boolean {
  return allowRawValue === 'true';
}

/**
 * The actual gate every security-sensitive demo-mode check must use — never `isDemoMode` alone.
 * Both conditions are required; both default to false/absent. See SECURITY.md's "Demo-mode
 * auth bypass" section for the full reasoning and the mobile-specific note (EAS build-profile
 * gating, since Expo bundles are fully client-side and have no server-only trust boundary to
 * hide a second env var behind).
 */
export function resolveDemoMode(
  demoRawValue: string | undefined,
  allowRawValue: string | undefined,
): boolean {
  return isDemoMode(demoRawValue) && isDemoModeAllowed(allowRawValue);
}

export const DEMO_MODE_BANNER_TEXT = 'Demo data';
