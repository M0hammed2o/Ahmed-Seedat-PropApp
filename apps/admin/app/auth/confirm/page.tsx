import { ConfirmEmailClient } from './ConfirmEmailClient';
import { safeNextPathOr } from '@/lib/safeRedirect';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/confirm?token_hash=...&type=signup&next=... -- the new, non-consuming landing point
 * for the signup confirmation email's CTA (WORKLOG.md this date, replacing {{ .ConfirmationURL }},
 * which pointed straight at GoTrue's own consuming /auth/v1/verify). Critically, this page itself
 * never calls verifyOtp() -- an email security scanner, Gmail's link-preview fetcher, or any other
 * automated GET can load this page freely without spending the token. Only ConfirmEmailClient's
 * own explicit button click does that, via POST /api/v1/auth/confirm.
 *
 * `type` is read here only to decide whether to render the confirmation UI at all -- 'signup' is
 * the only value this page supports; anything else (or a missing token_hash) is a structurally
 * invalid link, shown as such without ever attempting a verify call.
 *
 * Staff invitation flow audit (this date): `next`, when present, is NOT a safe relative path --
 * it's the FULL `emailRedirectTo` URL originally passed to signUp() (e.g.
 * `https://site/auth/callback?next=%2Finvitations%2Faccept%3Ftoken%3D...`), because that's the
 * only thing Supabase's `{{ .RedirectTo }}` email-template variable ever renders (confirmed
 * empirically against a real local send before relying on it -- it is never just the bare inner
 * path). The actual safe destination is the INNER `next` query parameter of that URL, extracted
 * and validated here, server-side, before ConfirmEmailClient ever sees it -- the outer RedirectTo
 * URL itself is never used as a redirect target. Mirrors /legal-consent and /complete-account's
 * own established "resolve next once, server-side, pass the already-safe value down" pattern.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next: rawRedirectTo } = await searchParams;
  const isValidShape = Boolean(tokenHash) && type === 'signup';

  const next = safeNextPathOr(extractInnerNext(rawRedirectTo), '/');

  return <ConfirmEmailClient tokenHash={isValidShape ? tokenHash! : null} next={next} />;
}

/** Pulls the inner `next` query parameter out of a full RedirectTo URL. Never throws on a
 *  malformed/missing/tampered value -- falls through to `undefined`, which safeNextPathOr() above
 *  then defaults to '/' exactly like an absent `next` always has. */
function extractInnerNext(redirectTo: string | undefined): string | null | undefined {
  if (!redirectTo) return undefined;
  try {
    return new URL(redirectTo).searchParams.get('next');
  } catch {
    return undefined;
  }
}
