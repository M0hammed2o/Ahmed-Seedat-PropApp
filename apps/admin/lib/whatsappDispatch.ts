import 'server-only';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppNotificationType, WhatsAppProvider } from '@propvault/types';
import { getWhatsAppProvider, isWhatsAppProviderConfigured } from './providers/whatsapp';
import { writeAuditEvent } from './audit';
import { isWhatsAppTemplateApproved } from './whatsappTemplates';

// Wires a subset of WHATSAPP.md §2's fixed, pre-approved trigger list to the already-built
// WhatsAppProvider (TASKS.md M17) -- the provider/resolution layer existed with no dispatcher
// calling it (TD-23's WhatsApp half). WHATSAPP.md §0/§2 is explicit that this number is a scarce,
// shared platform resource and "no code path may free-text an arbitrary message through it" --
// this file is the *entire* set of call sites allowed to send, mirroring the closed-enum
// discipline: only WhatsAppNotificationType values with a real, already-existing synchronous
// trigger in this codebase are wired (owner_statement_available, payment_received_confirmation,
// maintenance_request_update, tenant_account_invitation -- PRODUCT DECISION 2, 2026-08-03, values
// renamed WORKLOG.md this date to match Mohammed's real Meta-approved templates). Types
// requiring an unbuilt scheduled-detection job
// (rent_overdue_material, lease_expiring_soon, rent_overdue_significant, ...) are deliberately
// NOT wired -- inventing an ad-hoc "check overdue on every request" trigger would be exactly the
// kind of guessed automation TASKS.md's own TD-20 note warns against.

// Overnight platform pass (WORKLOG.md this date), Phase 6: WHATSAPP.md §3 already requires every
// template to open with the org's own display name (a message from the one shared platform
// number reads as spam otherwise) -- this resolves the two branding fields
// (20260101000093: organizations.trading_name, already existed; support_contact_name, new)
// call sites pass into their template `variables`. Kept here (not duplicated per call site) so
// the "trading_name falls back to legal_name" rule lives in exactly one place.
//
// CRITICAL, disclosed limitation: Meta WhatsApp template parameters are POSITIONAL
// (MetaWhatsAppProvider.sendTemplateMessage), and no real Meta Business/WhatsApp account or
// approved template exists in this environment (external-service blocker, same as every other
// real-provider gap this session) -- the variable ORDER used at each call site below is
// provisional until the actual approved template text is designed in Meta Business Manager and
// its real placeholder order is known. Do not treat this wiring as verified against a live
// template.
export async function resolveOrgWhatsAppBranding(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<{ organizationName: string; supportName: string }> {
  const { data } = await serviceClient
    .from('organizations')
    .select('legal_name, trading_name, support_contact_name')
    .eq('id', orgId)
    .maybeSingle();
  return {
    organizationName: data?.trading_name ?? data?.legal_name ?? 'your property manager',
    supportName: data?.support_contact_name ?? '',
  };
}

// Real Meta template structure reconciliation (WORKLOG.md this date, final pre-production pass):
// Mohammed confirmed Meta template approval and provided the real approved parameter structure
// for 7 of the 8 templates directly in this conversation -- every call site below that names a
// property/unit needs a resolved label, which none of the pre-approval call sites (built before
// the real structure was known) had wired up. Three small variants because the callers reach a
// property via three different real join paths already present in the schema, not because the
// underlying concept differs.

/** Property (+ optional unit) label from a property_id the caller already has directly on hand
 * (payment_reports, maintenance_tickets, cash_receipts all carry property_id themselves). */
export async function resolvePropertyLabel(
  serviceClient: SupabaseClient,
  propertyId: string,
  unitId?: string | null,
): Promise<string> {
  const { data: property } = await serviceClient
    .from('properties')
    .select('nickname')
    .eq('id', propertyId)
    .maybeSingle();
  const nickname = property?.nickname ?? 'your property';
  if (!unitId) return nickname;
  const { data: unit } = await serviceClient
    .from('units')
    .select('unit_label')
    .eq('id', unitId)
    .maybeSingle();
  return unit?.unit_label ? `${nickname} — ${unit.unit_label}` : nickname;
}

/** Property (+ unit) label reached via a lease_id (bank_transactions/rent_schedules callers only
 * have the lease, not the property, on hand). */
export async function resolvePropertyLabelForLease(
  serviceClient: SupabaseClient,
  leaseId: string,
): Promise<string> {
  const { data } = await serviceClient
    .from('leases')
    .select('units(id, unit_label, properties(nickname))')
    .eq('id', leaseId)
    .maybeSingle();
  const unit = (
    data as unknown as {
      units: { unit_label: string; properties: { nickname: string } | null } | null;
    } | null
  )?.units;
  const nickname = unit?.properties?.nickname ?? 'your property';
  return unit?.unit_label ? `${nickname} — ${unit.unit_label}` : nickname;
}

/** Property (+ unit) label reached via a unit_id (leases_expiring_unreminded() rows only carry
 * unit_id, not property_id, on the lease itself). */
export async function resolvePropertyLabelForUnit(
  serviceClient: SupabaseClient,
  unitId: string,
): Promise<string> {
  const { data } = await serviceClient
    .from('units')
    .select('unit_label, properties(nickname)')
    .eq('id', unitId)
    .maybeSingle();
  const nickname =
    (data as unknown as { properties: { nickname: string } | null } | null)?.properties?.nickname ??
    'your property';
  return data?.unit_label ? `${nickname} — ${data.unit_label}` : nickname;
}

/** "2026-03-15" -> "March 2026" -- shared by every template that names a payment period, matching
 * ownerSummary.ts's own formatSummaryMonthLabel() exactly (kept as a separate copy here rather
 * than an import, since ownerSummary.ts is aggregation-domain and this is dispatch-domain --
 * duplicated 12-line lookup table, not duplicated logic worth a shared module for). */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function formatPaymentPeriod(dateStr: string): string {
  // Accepts both a plain "YYYY-MM-DD" date and a full ISO timestamptz string (e.g. cash_receipts.
  // received_at) -- parsed via Date/UTC fields rather than naive string-splitting, since a
  // negative timezone offset ("...-05:00") would otherwise corrupt a split-on-'-' parse.
  const date = new Date(dateStr);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// Platform-owned single WhatsApp Business number (WHATSAPP.md §0) -- no real Meta/BSP account
// exists yet (external-service blocker), so this is a clearly-labeled placeholder, same
// TO_BE_CONFIRMED convention SUBSCRIPTIONS.md already uses for other real commercial values.
const PLATFORM_WHATSAPP_NUMBER = '+27000000000'; // TO_BE_CONFIRMED

// WHATSAPP.md §2's trigger -> notification_preferences.category mapping table, restricted to the
// subset this dispatcher actually sends. Partial (not every dispatchable type is gated) --
// tenant_account_invitation is transactional, same as member_invited's email equivalent: a tenant
// can't meaningfully "opt out" of the one message that grants them portal access in the first
// place.
/**
 * UAT recipient override (V1 release-gate pass). Set WHATSAPP_UAT_OVERRIDE_NUMBER to an E.164
 * number and EVERY outbound WhatsApp message is redirected to it instead of the real tenant/owner,
 * so a single reviewer's handset can exercise every template and persona without needing one real
 * device per fictional tenant -- and, more importantly, without editing real tenant phone numbers
 * in the data to achieve it (which would corrupt the records themselves and outlive the test).
 *
 * Three deliberate safety properties:
 *
 * 1. PRODUCTION BLOCK BY DEFAULT, TWO-KEY OPT-IN. If NODE_ENV === 'production' the override is
 *    ignored and a loud error is logged UNLESS a second, explicit `WHATSAPP_UAT_MODE=enabled` is
 *    also present. One stray variable can therefore never arm this: a misconfigured deploy that
 *    carries only the number still behaves exactly as before. The two-key form exists because UAT
 *    has to be runnable against the PUBLIC deployment, where NODE_ENV is legitimately 'production'
 *    -- see PUBLIC_UAT_REPORT.md. A misconfigured deploy must never silently funnel every
 *    customer's rent reminder to one person's phone; that is a data-breach-shaped failure, not a
 *    test artifact. Mirrors lib/billing.ts's own `mock provider in production` guard convention.
 * 2. TRUTHFUL AUDIT TRAIL. whatsapp_messages.to_number records where the message ACTUALLY went
 *    (the override), never the address it was meant for, so the ledger never claims a tenant was
 *    contacted when they were not. The intended recipient is preserved alongside it in the audit
 *    event payload, so the redirection is reconstructable rather than erased.
 * 3. NO SILENT ACTIVATION. Every redirect logs a warning naming both numbers.
 *
 * Returns `{ kind: 'inactive' }` on the normal production path, `{ kind: 'redirect' }` when a valid
 * override applies, or `{ kind: 'blocked' }` when the variable is set but unusable.
 *
 * That last case fails CLOSED on purpose. toE164() only validates E.164, it never converts, so a
 * plausible local-format value like "083 786 6021" does not parse. Ignoring it and continuing would
 * send the message to the REAL tenant -- precisely the outcome the operator was trying to prevent by
 * setting the variable at all. A misconfigured redirect must suppress the send, never leak past it.
 */
export type WhatsAppUatOverride =
  | { kind: 'inactive' }
  | { kind: 'redirect'; to: string }
  | { kind: 'blocked'; reason: string };

export function resolveWhatsAppUatOverride(intendedNumber: string): WhatsAppUatOverride {
  const override = process.env.WHATSAPP_UAT_OVERRIDE_NUMBER?.trim();
  if (!override) return { kind: 'inactive' };

  if (process.env.NODE_ENV === 'production') {
    // Public UAT 2026-09-07: testing WhatsApp against the PUBLIC deployment is impossible while
    // production ignores the override outright -- a send would go to the real recipient, which is
    // exactly what must never happen. Rather than relax the production block, activation now needs
    // a SECOND, explicit opt-in that no ordinary deploy would ever carry. Setting the number alone
    // still changes nothing in production, so a stray variable cannot arm this.
    if (process.env.WHATSAPP_UAT_MODE?.trim() !== 'enabled') {
      console.error(
        '[dispatchWhatsApp] WHATSAPP_UAT_OVERRIDE_NUMBER is set in a PRODUCTION build but ' +
          'WHATSAPP_UAT_MODE is not "enabled", so the override has been IGNORED. Leaving the number ' +
          'set in production without the explicit mode flag would otherwise redirect every customer ' +
          'message to a single number. Unset it, or set WHATSAPP_UAT_MODE=enabled deliberately for a ' +
          'supervised UAT window and unset it immediately afterwards.',
      );
      return { kind: 'inactive' };
    }
    console.warn(
      '[dispatchWhatsApp] PRODUCTION UAT MODE IS ACTIVE. Every outbound WhatsApp message is being ' +
        'redirected away from its real recipient. This must only ever be on during a supervised UAT ' +
        'window -- unset WHATSAPP_UAT_MODE as soon as it ends.',
    );
  }

  const normalized = toE164(override);
  if (!normalized) {
    console.error(
      `[dispatchWhatsApp] WHATSAPP_UAT_OVERRIDE_NUMBER is set but is not valid E.164 (${override}). ` +
        'Suppressing the send rather than delivering to the real recipient. ' +
        'Use the full international form, e.g. +27837866021 (not 083 786 6021).',
    );
    return { kind: 'blocked', reason: 'invalid_uat_override_number' };
  }
  if (normalized === intendedNumber) return { kind: 'inactive' };

  console.warn(
    `[dispatchWhatsApp] UAT OVERRIDE ACTIVE -- redirecting message intended for ${intendedNumber} to ${normalized}`,
  );
  return { kind: 'redirect', to: normalized };
}

const TEMPLATE_CATEGORY: Partial<
  Record<DispatchableWhatsAppType, 'rent' | 'maintenance' | 'lease' | 'owner_summary'>
> = {
  owner_statement_available: 'rent',
  payment_received_confirmation: 'rent',
  maintenance_request_update: 'maintenance',
  // Phase B, WhatsApp V1 completion pass: same 'rent' family as payment_received_confirmation --
  // no dedicated "accounting" category exists yet (WHATSAPP.md §2's own owner_statement_available
  // entry documents the same gap).
  payment_confirmation_required: 'rent',
  // Phase E, WhatsApp V1 completion pass -- matches WHATSAPP.md §2's own documented category table
  // for these events exactly.
  rent_payment_reminder: 'rent',
  rent_overdue_notice: 'rent',
  lease_expiry_reminder: 'lease',
  // Final pre-production pass, Phase 3/4: its own dedicated category (migration 20260101000107) --
  // deliberately NOT lumped into 'rent', so an owner can opt out of the monthly digest without
  // also silently opting out of real-time rent/payment alerts, and vice versa.
  owner_monthly_property_summary: 'owner_summary',
};

export type DispatchableWhatsAppType = Extract<
  WhatsAppNotificationType,
  | 'owner_statement_available'
  | 'payment_received_confirmation'
  | 'maintenance_request_update'
  | 'tenant_account_invitation'
  | 'rent_payment_reminder'
  | 'rent_overdue_notice'
  | 'lease_expiry_reminder'
  | 'payment_confirmation_required'
  | 'owner_monthly_property_summary'
  // First-tenant-workflow predeploy pass, Phase 6-8: applicant/lease events. Deliberately NOT
  // added to TEMPLATE_CATEGORY above -- an applicant has no notification_preferences row to gate
  // against (no auth.users identity); the real gate is the affirmative
  // applicant_whatsapp_consents check each call site performs BEFORE ever calling
  // dispatchWhatsApp(), see lib/applicationNotifications.ts / lib/leaseNotifications.ts.
  | 'application_invitation'
  | 'application_documents_requested'
  | 'application_approved'
  | 'application_declined'
  | 'lease_ready'
>;

function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  return /^\+[1-9]\d{6,14}$/.test(trimmed) ? trimmed : null;
}

export interface DispatchWhatsAppInput {
  orgId: string;
  toPhone: string | null;
  toUserId?: string | null;
  templateName: DispatchableWhatsAppType;
  variables: Record<string, string>;
  relatedEntityType: string;
  relatedEntityId: string;
  actorUserId: string | null;
}

export interface DispatchWhatsAppResult {
  sent: boolean;
  reason?:
    | 'no_phone'
    | 'invalid_phone'
    | 'preference_disabled'
    | 'already_sent'
    | 'template_not_approved'
    | 'send_failed'
    /** WHATSAPP_UAT_OVERRIDE_NUMBER is set but unusable -- the send is suppressed rather than
     * allowed to reach the real recipient. See resolveWhatsAppUatOverride(). */
    | 'uat_override_invalid';
  whatsappMessageId?: string;
  /** False whenever this dispatch went through MockWhatsAppProvider (no WHATSAPP_ACCESS_TOKEN/
   * WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_WEBHOOK_SECRET configured) -- mirrors
   * DispatchEmailResult.deliveryConfigured for the same reason. */
  deliveryConfigured: boolean;
}

/** Idempotent, preference-aware WhatsApp dispatch -- the one call site every trigger uses. */
export async function dispatchWhatsApp(
  serviceClient: SupabaseClient,
  input: DispatchWhatsAppInput,
): Promise<DispatchWhatsAppResult> {
  const deliveryConfigured = isWhatsAppProviderConfigured();
  const toNumber = toE164(input.toPhone);
  if (!input.toPhone) return { sent: false, reason: 'no_phone', deliveryConfigured };
  if (!toNumber) return { sent: false, reason: 'invalid_phone', deliveryConfigured };

  const { data: existing } = await serviceClient
    .from('whatsapp_messages')
    .select('id')
    .eq('related_entity_type', input.relatedEntityType)
    .eq('related_entity_id', input.relatedEntityId)
    .eq('template_name', input.templateName)
    .maybeSingle();
  if (existing) {
    return {
      sent: false,
      reason: 'already_sent',
      whatsappMessageId: existing.id,
      deliveryConfigured,
    };
  }

  const category = TEMPLATE_CATEGORY[input.templateName];
  if (category) {
    // Org-level default (Phase 5, 20260101000093) checked first -- same "org narrows, user can
    // only narrow further" reasoning as dispatchEmail()'s mirrored check.
    const { data: orgSetting } = await serviceClient
      .from('organization_notification_settings')
      .select('whatsapp_enabled')
      .eq('org_id', input.orgId)
      .eq('category', category)
      .maybeSingle();
    if (orgSetting && orgSetting.whatsapp_enabled === false) {
      return { sent: false, reason: 'preference_disabled', deliveryConfigured };
    }

    if (input.toUserId) {
      const { data: pref } = await serviceClient
        .from('notification_preferences')
        .select('whatsapp_enabled')
        .eq('user_id', input.toUserId)
        .eq('category', category)
        .maybeSingle();
      // Missing row = default enabled (whatsapp_enabled defaults to true, WHATSAPP.md §2's "even
      // a listed trigger is suppressed if the recipient opted out" rule -- this only runs for
      // categorized types; tenant_invitation has no category above, so it skips this block
      // entirely, same as the exempt account_security_event).
      if (pref && pref.whatsapp_enabled === false) {
        return { sent: false, reason: 'preference_disabled', deliveryConfigured };
      }
    }
  }

  // Phase K, WhatsApp V1 completion pass: fail fast, locally, observably for a template Mohammed
  // hasn't confirmed Active/Approved -- never rely on Meta's own API rejection as the only thing
  // standing between "in review" and a real send attempt. Gated on deliveryConfigured
  // specifically, not unconditionally: the registry only matters the moment a REAL Meta API call
  // would otherwise be made -- MockWhatsAppProvider (every local/CI run, no real credentials) never
  // talks to Meta at all, so approval status is meaningless there, and gating it unconditionally
  // would make every existing dispatch test require editing this registry to pass. See
  // whatsappTemplates.ts's own header comment for why this became urgent this pass (Render now
  // carries real Meta credentials).
  if (deliveryConfigured && !isWhatsAppTemplateApproved(input.templateName)) {
    return { sent: false, reason: 'template_not_approved', deliveryConfigured };
  }

  // Launch-completion pass (WORKLOG.md 2026-08-27): flipping a template's `approved` flag to true
  // makes this the first moment a REAL Meta API call can happen for it -- before that, the
  // template_not_approved short-circuit above meant sendTemplateMessage() was never actually
  // reached. A network failure calling Meta, or a genuine whatsapp_messages insert failure, must
  // never throw up into the caller: every dispatch call site fires this AFTER its own core
  // business action (approve/decline/send/invite) has already succeeded and committed --
  // an uncaught exception here would turn a successful approval into a misleading 500 to the
  // staff member, not roll back anything real, just lie about the outcome. Fail soft, once,
  // centrally, for every current and future caller of this single dispatch function.
  // UAT override is applied at this single choke point -- after every preference/approval gate, so
  // a redirected test message still obeys exactly the same suppression rules a real one would, and
  // before the provider call, so nothing downstream can observe the original address.
  const uatOverride = resolveWhatsAppUatOverride(toNumber);
  if (uatOverride.kind === 'blocked') {
    return { sent: false, reason: 'uat_override_invalid', deliveryConfigured };
  }
  const deliveredTo = uatOverride.kind === 'redirect' ? uatOverride.to : toNumber;

  try {
    const provider = getWhatsAppProvider();
    const result = await provider.sendTemplateMessage({
      to: deliveredTo,
      templateName: input.templateName,
      variables: input.variables,
      orgId: input.orgId,
    });

    const { data: message, error: insertError } = await serviceClient
      .from('whatsapp_messages')
      .insert({
        org_id: input.orgId,
        direction: 'outbound',
        // Where it ACTUALLY went -- never the intended address when redirected, so the ledger can
        // never imply a tenant was contacted when the message went to a UAT handset instead.
        to_number: deliveredTo,
        from_number: PLATFORM_WHATSAPP_NUMBER,
        related_entity_type: input.relatedEntityType,
        related_entity_id: input.relatedEntityId,
        template_name: input.templateName,
        status: 'queued',
        provider_message_id: result.providerMessageId,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);

    await writeAuditEvent(serviceClient, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      actorType: input.actorUserId ? 'user' : 'system',
      action: 'whatsapp_sent',
      entityType: input.relatedEntityType,
      entityId: input.relatedEntityId,
      after: {
        templateName: input.templateName,
        toNumber: deliveredTo,
        status: 'queued',
        // Present only during UAT, so the redirection is reconstructable from the audit trail
        // rather than erased by it.
        ...(uatOverride.kind === 'redirect'
          ? { uatOverride: true, intendedRecipient: toNumber }
          : {}),
      },
    });

    return { sent: true, whatsappMessageId: message.id, deliveryConfigured };
  } catch (err) {
    // Real cause (provider payload, network error, DB error) logged server-side only -- never
    // surfaced to the caller/end user, matching this pass's "no provider error payloads to users"
    // rule.
    console.error('[dispatchWhatsApp] send failed', {
      templateName: input.templateName,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason: 'send_failed', deliveryConfigured };
  }
}

// V1 communications productionisation (WORKLOG.md this date): closes TECHNICAL_DEBT_REGISTER.md
// TD-38's inbound half -- POST /api/v1/webhooks/whatsapp calls this, mirroring
// processResendWebhookEvent's (emailDispatch.ts) exact structure: verify signature first, classify
// the event, insert into a webhook_events idempotency ledger before touching anything else, treat
// a 23505 unique-violation as "already processed," and only then apply the real effect.

/** Thrown only for a signature-verification failure -- the one case the caller (the route) must
 * distinguish for WHATSAPP.md §4 point 2's specific handling (401 + a security audit_events row),
 * as opposed to every other failure here, which is an ordinary 400. */
export class WhatsAppWebhookSignatureError extends Error {}

export interface ProcessWhatsAppWebhookResult {
  alreadyProcessed: boolean;
  eventType: 'message' | 'status_callback' | 'unknown';
}

// Forward-only status ranking (WHATSAPP.md §6: "an out-of-order or redelivered callback can only
// move status forward... never regress it"). read/failed are both terminal at the same rank --
// once either is reached, no further callback may change status, matching
// processResendWebhookEvent's delivered/bounced/failed convention.
const WHATSAPP_STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 3,
};

async function resolveWhatsAppSender(
  serviceClient: SupabaseClient,
  phoneE164: string,
): Promise<{ orgId: string; entityType: string; entityId: string }[]> {
  const { data, error } = await serviceClient.rpc('resolve_whatsapp_sender', {
    p_phone_number_e164: phoneE164,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { org_id: string; entity_type: string; entity_id: string }) => ({
    orgId: row.org_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
  }));
}

async function processStatusCallback(
  serviceClient: SupabaseClient,
  provider: WhatsAppProvider,
  parsedBody: unknown,
): Promise<ProcessWhatsAppWebhookResult> {
  const callback = provider.parseStatusCallback(parsedBody);

  const { data: message } = await serviceClient
    .from('whatsapp_messages')
    .select('id, org_id, status')
    .eq('provider_message_id', callback.providerMessageId)
    .maybeSingle();

  // Meta doesn't assign status callbacks their own separate stable event id the way Resend's
  // svix-id does -- (providerMessageId, status) is the natural dedup key: a redelivery of the
  // exact same status for the exact same message is what "already processed" means here.
  const providerEventId = `${callback.providerMessageId}:${callback.status}`;

  const { error: insertError } = await serviceClient.from('whatsapp_webhook_events').insert({
    org_id: message?.org_id ?? null,
    whatsapp_message_id: message?.id ?? null,
    provider_name: 'meta',
    provider_event_id: providerEventId,
    event_type: `status:${callback.status}`,
    payload: parsedBody as object,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return { alreadyProcessed: true, eventType: 'status_callback' };
    }
    throw new Error(insertError.message);
  }

  if (!message) {
    // Authentic callback for a message this app never sent (or a different environment sharing
    // the same Meta app) -- recorded above for audit; nothing local to update.
    return { alreadyProcessed: false, eventType: 'status_callback' };
  }

  const currentRank = WHATSAPP_STATUS_RANK[message.status] ?? 0;
  const newRank = WHATSAPP_STATUS_RANK[callback.status] ?? 0;
  if (newRank >= currentRank && currentRank < 3) {
    const now = new Date().toISOString();
    const timestampColumn =
      callback.status === 'delivered'
        ? 'delivered_at'
        : callback.status === 'read'
          ? 'read_at'
          : callback.status === 'failed'
            ? 'failed_at'
            : null;
    await serviceClient
      .from('whatsapp_messages')
      .update({
        status: callback.status,
        provider_event_at: now,
        last_provider_event: callback.status,
        ...(timestampColumn ? { [timestampColumn]: now } : {}),
        ...(callback.status === 'failed'
          ? { failure_reason: callback.failureReason ?? 'unknown' }
          : {}),
      })
      .eq('id', message.id);

    await writeAuditEvent(serviceClient, {
      orgId: message.org_id,
      actorUserId: null,
      actorType: 'system',
      action: 'whatsapp_status_updated',
      entityType: 'whatsapp_messages',
      entityId: message.id,
      after: { status: callback.status },
    });
  }

  return { alreadyProcessed: false, eventType: 'status_callback' };
}

async function processInboundMessage(
  serviceClient: SupabaseClient,
  provider: WhatsAppProvider,
  parsedBody: unknown,
): Promise<ProcessWhatsAppWebhookResult> {
  const event = provider.parseInboundEvent(parsedBody);
  const fromNumber = toE164(event.from);

  // WHATSAPP.md §1.2 steps 1-2: normalize + resolve, service-role, unscoped by org (org is what
  // we're trying to find). A missing/unparseable sender number cannot be resolved at all --
  // treated as UNAUTHENTICATED (0 matches) rather than thrown: a real, signature-verified webhook
  // call with an odd "from" value is still an authentic event worth acknowledging with 200, not
  // an error that makes Meta retry forever.
  const matches = fromNumber ? await resolveWhatsAppSender(serviceClient, fromNumber) : [];
  const resolvedOrgId = matches.length === 1 ? matches[0]!.orgId : null;

  const providerEventId = event.providerMessageId ?? crypto.randomUUID();

  const { error: insertError } = await serviceClient.from('whatsapp_webhook_events').insert({
    org_id: resolvedOrgId,
    whatsapp_message_id: null,
    provider_name: 'meta',
    provider_event_id: providerEventId,
    event_type: 'inbound_message',
    payload: parsedBody as object,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return { alreadyProcessed: true, eventType: 'message' };
    }
    throw new Error(insertError.message);
  }

  // WHATSAPP.md §1.2: RESOLVED (exactly 1 match) is the only branch that creates a real,
  // org-scoped whatsapp_messages row -- an UNAUTHENTICATED (0 matches) or AMBIGUOUS (2+ matches)
  // inbound message has no single org to attribute a row to (whatsapp_messages.org_id is NOT
  // NULL, correctly, since it's an org-scoped, RLS-visible table). Both non-resolved outcomes are
  // still durably recorded above via whatsapp_webhook_events for audit purposes -- nothing is
  // silently dropped, it's just not promoted into org-scoped business data without a resolved org.
  //
  // Full conversational disambiguation/auto-reply (WHATSAPP.md §1.2-1.3: replying with role
  // labels for the AMBIGUOUS case, tracking whatsapp_conversation_state across a multi-message
  // exchange) is deliberately NOT built here -- see providers/whatsapp.ts's header comment: the
  // OTP-verification flow that would ever populate verified_phone_numbers doesn't exist yet, so
  // every real inbound message resolves to 0 matches today regardless. The correct branching
  // (resolve once, record, never guess among 2+ matches) is real and in place; sending an actual
  // reply back to the sender needs a freeform (non-template) send capability WhatsAppProvider
  // doesn't have yet -- a genuinely separate, larger piece of work, not a scoped-down version of
  // this one.
  if (matches.length === 1) {
    const match = matches[0]!;
    await serviceClient.from('whatsapp_messages').insert({
      org_id: match.orgId,
      direction: 'inbound',
      to_number: PLATFORM_WHATSAPP_NUMBER,
      from_number: fromNumber,
      related_entity_type: match.entityType,
      related_entity_id: match.entityId,
      body: event.body ?? null,
      status: 'delivered',
      provider_message_id: providerEventId,
    });
  }

  return { alreadyProcessed: false, eventType: 'message' };
}

/** Idempotent, signature-verified inbound WhatsApp webhook processing -- the one call site
 * POST /api/v1/webhooks/whatsapp uses. Handles both event shapes Meta sends through the same
 * endpoint (delivery-status callbacks for outbound sends, and genuinely inbound messages). */
export async function processWhatsAppWebhookEvent(
  serviceClient: SupabaseClient,
  input: { rawBody: string; signatureHeader: string },
): Promise<ProcessWhatsAppWebhookResult> {
  const provider = getWhatsAppProvider();

  if (!provider.verifyWebhookSignature(input.rawBody, input.signatureHeader)) {
    throw new WhatsAppWebhookSignatureError('Invalid WhatsApp webhook signature');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.rawBody);
  } catch {
    throw new Error('WhatsApp webhook payload is not valid JSON');
  }

  const kind = provider.classifyWebhookEvent(parsedBody);
  if (kind === 'status_callback') {
    return processStatusCallback(serviceClient, provider, parsedBody);
  }
  if (kind === 'message') {
    return processInboundMessage(serviceClient, provider, parsedBody);
  }

  // Unrecognized event shape (e.g. a payload type this integration doesn't model, or Meta's own
  // subscription-verification traffic arriving as a POST) -- accept and ignore. A real signature
  // already proved authenticity; Meta should not keep retrying an event this app deliberately
  // doesn't act on.
  return { alreadyProcessed: false, eventType: 'unknown' };
}
