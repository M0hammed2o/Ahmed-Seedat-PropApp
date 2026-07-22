/**
 * Demo mode lets the full app be driven end-to-end by realistic in-memory mock data instead of
 * a live Supabase project — used for sales/client demos before a production backend is
 * provisioned. It is a parallel implementation behind the same repository/provider interfaces
 * used everywhere else (see ARCHITECTURE.md), never a fork of production logic, and it is
 * always visually flagged in the UI so demo data can never be mistaken for real customer data.
 *
 * Defaults to ON (Phase 2 priority — see DECISIONS.md): an unset EXPO_PUBLIC_DEMO_MODE /
 * NEXT_PUBLIC_DEMO_MODE means "no Supabase project configured yet," which is exactly when demo
 * mode should be active. Once a real project exists, set the variable to "false" explicitly —
 * an unset variable is otherwise indistinguishable from "not configured yet," and this choice
 * favours the app working out of the box over failing closed.
 */
export function isDemoMode(rawValue: string | undefined): boolean {
  return rawValue !== 'false' && rawValue !== '0';
}

export const DEMO_MODE_BANNER_TEXT = 'Demo data';
