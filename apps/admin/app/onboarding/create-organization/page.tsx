import { CreateOrganizationForm } from './CreateOrganizationForm';

/**
 * TASKS.md M4 — org signup UI. First screen a signed-in user with zero organization memberships
 * lands on (PORTAL_SESSION-aware routing that sends them here is dashboard-layout work, not yet
 * wired — this page is reachable directly for now). Calls POST /api/v1/organizations, which
 * wraps create_organization() (supabase/migrations/20260101000021) — atomic org + principal
 * membership creation.
 *
 * Forced dynamic (2026-08-02, proxy.ts's CSP-nonce fix) — same reason and split as /login.
 */
export const dynamic = 'force-dynamic';

export default function CreateOrganizationPage() {
  return <CreateOrganizationForm />;
}
