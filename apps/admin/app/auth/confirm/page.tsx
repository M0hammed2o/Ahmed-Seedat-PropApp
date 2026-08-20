import { ConfirmEmailClient } from './ConfirmEmailClient';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/confirm?token_hash=...&type=signup -- the new, non-consuming landing point for the
 * signup confirmation email's CTA (WORKLOG.md this date, replacing {{ .ConfirmationURL }}, which
 * pointed straight at GoTrue's own consuming /auth/v1/verify). Critically, this page itself never
 * calls verifyOtp() -- an email security scanner, Gmail's link-preview fetcher, or any other
 * automated GET can load this page freely without spending the token. Only ConfirmEmailClient's
 * own explicit button click does that, via POST /api/v1/auth/confirm.
 *
 * `type` is read here only to decide whether to render the confirmation UI at all -- 'signup' is
 * the only value this page supports; anything else (or a missing token_hash) is a structurally
 * invalid link, shown as such without ever attempting a verify call.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  const isValidShape = Boolean(tokenHash) && type === 'signup';

  return <ConfirmEmailClient tokenHash={isValidShape ? tokenHash! : null} />;
}
