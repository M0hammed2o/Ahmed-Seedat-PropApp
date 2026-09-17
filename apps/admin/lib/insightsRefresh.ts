import 'server-only';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { reconcilePortfolioInsights } from '@/lib/portfolioIntelligence';

/**
 * Re-evaluate one organisation's Needs-attention alerts right after an action that could have
 * resolved one (Android V1 cleanup pass, 2026-09-17).
 *
 * portfolio_insights is a persisted table, reconciled for every org by a scheduled job. That is
 * fine for alerts that appear on their own (rent falling overdue overnight), and wrong for alerts a
 * person just resolved by hand: confirming a reported payment left "1 payment is awaiting your
 * confirmation" on screen until the next job run.
 *
 * Deliberately swallows its own failures. The business action has already committed by the time
 * this runs; a stale alert for a few hours is a far better outcome than a 500 telling the user
 * their confirmation failed when it did not. Uses the service-role client because reconciliation
 * reads across the whole organisation, exactly as the scheduled job does.
 */
export function refreshOrgInsights(orgId: string | null | undefined): void {
  if (!orgId) return;
  // Deliberately NOT awaited. Reconciliation evaluates every rule for the organisation and takes
  // seconds; awaiting it made the caller wait for work they do not need the result of -- the
  // confirmation has already committed -- and pushed the payment-report route past its own test
  // timeout, which is exactly the delay a person would have felt on the Confirm button.
  void reconcilePortfolioInsights(getServiceRoleClient(), orgId).catch((err) => {
    console.error('[insightsRefresh] reconcile failed', {
      orgId,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}
