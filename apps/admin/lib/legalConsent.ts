import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TERMS_VERSION, PRIVACY_VERSION } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from './supabase/server';

/**
 * Production signup/onboarding (WORKLOG.md this date). `user_terms_acceptances` existed,
 * correctly designed (append-only, RLS'd), but had zero writers anywhere in the app -- the
 * consent checkboxes on RegisterForm were validated client-side and then discarded server-side.
 * This is the single place that reads or writes it, so the "never trust a client-submitted
 * version string" rule can't be accidentally bypassed by a second call site.
 *
 * `TERMS_VERSION`/`PRIVACY_VERSION` (`packages/config/src/legal.ts`) are the server's own
 * configured versions -- what RegisterForm submits (`acceptedTermsVersion`/`acceptedPrivacyVersion`)
 * is validated by `registerSchema` only as "a non-empty string" (i.e. "the box was checked"), and
 * is never itself written to the database. The actual recorded version always comes from this
 * module's own constants, never from request input.
 */
export interface LegalConsentStatus {
  termsAccepted: boolean;
  privacyAccepted: boolean;
}

export async function getLegalConsentStatus(
  supabaseClient?: SupabaseClient,
): Promise<LegalConsentStatus> {
  const supabase = supabaseClient ?? (await getServerSupabaseClient());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { termsAccepted: false, privacyAccepted: false };

  const { data } = await supabase
    .from('user_terms_acceptances')
    .select('document_type, version')
    .eq('user_id', user.id)
    .in('document_type', ['terms_of_service', 'privacy_policy']);

  const rows = data ?? [];
  return {
    termsAccepted: rows.some(
      (row) => row.document_type === 'terms_of_service' && row.version === TERMS_VERSION,
    ),
    privacyAccepted: rows.some(
      (row) => row.document_type === 'privacy_policy' && row.version === PRIVACY_VERSION,
    ),
  };
}

export async function hasAcceptedCurrentLegalTerms(
  supabaseClient?: SupabaseClient,
): Promise<boolean> {
  const status = await getLegalConsentStatus(supabaseClient);
  return status.termsAccepted && status.privacyAccepted;
}

/**
 * Records acceptance of both documents at their current server-configured versions, for a
 * specific user id -- called both from the signup route (no live session yet when email
 * confirmation is pending, hence `userId` rather than reading `auth.uid()`) and from the
 * `/legal-consent` fallback screen's own route (OAuth users, or anyone who reaches an
 * authenticated page without a recorded acceptance). Always uses the service-role client: the
 * signup-route call site has no user session to scope an RLS-respecting client to, and using the
 * same client for both call sites keeps this function's behavior identical regardless of caller.
 *
 * Idempotent by design (`ignoreDuplicates`, matching the unique index on
 * (user_id, document_type, version)) -- a retried submission never creates duplicate rows.
 */
export async function recordLegalConsent(userId: string): Promise<void> {
  const serviceClient = getServiceRoleClient();
  const { error } = await serviceClient.from('user_terms_acceptances').upsert(
    [
      { user_id: userId, document_type: 'terms_of_service', version: TERMS_VERSION },
      { user_id: userId, document_type: 'privacy_policy', version: PRIVACY_VERSION },
    ],
    { onConflict: 'user_id,document_type,version', ignoreDuplicates: true },
  );
  if (error) {
    // Never blocks signup/login -- the /legal-consent gate is the safety net if this write is
    // ever lost (a user who reaches an authenticated page without a recorded acceptance is
    // caught there on their very next page load). Logged loudly since it's a real compliance gap.
    console.error('[legalConsent] failed to record consent', { userId, message: error.message });
  }
}
