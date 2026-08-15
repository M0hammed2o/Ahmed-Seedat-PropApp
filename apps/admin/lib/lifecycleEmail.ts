import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { branding } from '@propvault/config';
import { getEmailProvider } from './providers/email';

/**
 * Production signup/onboarding (WORKLOG.md this date). Welcome email for a genuinely new,
 * activated account. Deliberately NOT routed through `emailDispatch.ts`'s `dispatchEmail()` --
 * that function requires a non-null `org_id` (every existing template is an org-scoped business
 * event), but a welcome email must fire before any organization exists. Rather than weakening
 * that constraint, this calls the same underlying `EmailProvider` directly and tracks its own
 * exactly-once intent via `user_lifecycle_events` (migration 20260101000077).
 *
 * Exactly-once via claim-then-send, not check-then-send: the INSERT below is an upsert with
 * `ignoreDuplicates: true` against the table's unique (user_id, event_type, template_version)
 * index. Concurrent callers (a retried /auth/callback, a duplicated welcome-email trigger) race
 * to insert the same row; Postgres guarantees exactly one wins (`.select()` on the upsert returns
 * the row only for the caller whose insert actually happened -- an empty array means someone else
 * already claimed it), so only the winner ever calls the provider.
 *
 * `orgId` in the underlying `SendEmailInput` type is required but unused by either provider
 * implementation for anything beyond logging -- a fixed sentinel is passed rather than widening
 * the shared type for this one non-org-scoped caller.
 */
const WELCOME_EMAIL_TEMPLATE_VERSION = 'v1';

export async function sendWelcomeEmailOnce(
  serviceClient: SupabaseClient,
  userId: string,
  firstName: string | null,
): Promise<void> {
  const { data: claimed, error: claimError } = await serviceClient
    .from('user_lifecycle_events')
    .upsert(
      [
        {
          user_id: userId,
          event_type: 'welcome_email',
          template_version: WELCOME_EMAIL_TEMPLATE_VERSION,
          status: 'pending',
        },
      ],
      { onConflict: 'user_id,event_type,template_version', ignoreDuplicates: true },
    )
    .select('id');

  if (claimError) {
    console.error('[lifecycleEmail] failed to claim welcome-email event', {
      userId,
      message: claimError.message,
    });
    return;
  }
  const eventId = claimed?.[0]?.id;
  if (!eventId) return; // already claimed (or sent) by an earlier call -- not an error

  const { data: authUser } = await serviceClient.auth.admin.getUserById(userId);
  const toAddress = authUser?.user?.email;
  if (!toAddress) {
    await serviceClient
      .from('user_lifecycle_events')
      .update({ status: 'skipped', error_message: 'no email address on account' })
      .eq('id', eventId);
    return;
  }

  const greetingName = firstName?.trim() ? firstName.trim() : 'there';
  const subject = `Welcome to ${branding.productName}`;
  const bodyText = [
    `Hi ${greetingName},`,
    '',
    `Thanks for joining ${branding.productName}! Your account is ready to go.`,
    '',
    "Here's what you can do next:",
    '- Create or join an organisation to start managing your properties',
    '- Add your first property, unit, and tenant',
    '- Invite your team or property owners so everyone stays in sync',
    '',
    `Jump back in any time at ${branding.websiteUrl}`,
    '',
    // V1 communications productionisation (WORKLOG.md this date): no real support mailbox exists
    // yet (branding.supportEmail is still a documented placeholder) -- omitted rather than
    // referencing a non-functional address; re-add once Mohammed provides a real one.
    `-- The ${branding.productName} team`,
  ].join('\n');

  try {
    const provider = getEmailProvider();
    const result = await provider.send({
      orgId: 'user-lifecycle',
      toAddress,
      templateName: 'welcome_email',
      templateVars: { firstName: greetingName },
      subject,
      bodyText,
    });
    await serviceClient
      .from('user_lifecycle_events')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
      })
      .eq('id', eventId);
  } catch (err) {
    // Never re-thrown -- a mail-provider failure must never block account access, per
    // instruction. The claim row stays at 'failed', not retried automatically (a bounded,
    // observable failure is safer than an unbounded retry loop against a possibly-broken
    // provider); this is not the "exactly once" contract's job to also guarantee "eventually".
    console.error('[lifecycleEmail] welcome email send failed', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    await serviceClient
      .from('user_lifecycle_events')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'unknown error',
      })
      .eq('id', eventId);
  }
}
