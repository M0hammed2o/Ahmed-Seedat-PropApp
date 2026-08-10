import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppNotificationType } from '@propvault/types';
import { getWhatsAppProvider, isWhatsAppProviderConfigured } from './providers/whatsapp';
import { writeAuditEvent } from './audit';

// Wires a subset of WHATSAPP.md §2's fixed, pre-approved trigger list to the already-built
// WhatsAppProvider (TASKS.md M17) -- the provider/resolution layer existed with no dispatcher
// calling it (TD-23's WhatsApp half). WHATSAPP.md §0/§2 is explicit that this number is a scarce,
// shared platform resource and "no code path may free-text an arbitrary message through it" --
// this file is the *entire* set of call sites allowed to send, mirroring the closed-enum
// discipline: only WhatsAppNotificationType values with a real, already-existing synchronous
// trigger in this codebase are wired (owner_statement_available, payment_accepted,
// maintenance_update_critical, tenant_invitation -- PRODUCT DECISION 2, 2026-08-03). Types
// requiring an unbuilt scheduled-detection job
// (rent_overdue_material, lease_expiring_soon, rent_overdue_significant, ...) are deliberately
// NOT wired -- inventing an ad-hoc "check overdue on every request" trigger would be exactly the
// kind of guessed automation TASKS.md's own TD-20 note warns against.

// Platform-owned single WhatsApp Business number (WHATSAPP.md §0) -- no real Meta/BSP account
// exists yet (external-service blocker), so this is a clearly-labeled placeholder, same
// TO_BE_CONFIRMED convention SUBSCRIPTIONS.md already uses for other real commercial values.
const PLATFORM_WHATSAPP_NUMBER = '+27000000000'; // TO_BE_CONFIRMED

// WHATSAPP.md §2's trigger -> notification_preferences.category mapping table, restricted to the
// subset this dispatcher actually sends. Partial (not every dispatchable type is gated) --
// tenant_invitation is transactional, same as member_invited's email equivalent: a tenant can't
// meaningfully "opt out" of the one message that grants them portal access in the first place.
const TEMPLATE_CATEGORY: Partial<Record<DispatchableWhatsAppType, 'rent' | 'maintenance'>> = {
  owner_statement_available: 'rent',
  payment_accepted: 'rent',
  maintenance_update_critical: 'maintenance',
};

export type DispatchableWhatsAppType = Extract<
  WhatsAppNotificationType,
  | 'owner_statement_available'
  | 'payment_accepted'
  | 'maintenance_update_critical'
  | 'tenant_invitation'
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
  reason?: 'no_phone' | 'invalid_phone' | 'preference_disabled' | 'already_sent';
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
  if (category && input.toUserId) {
    const { data: pref } = await serviceClient
      .from('notification_preferences')
      .select('whatsapp_enabled')
      .eq('user_id', input.toUserId)
      .eq('category', category)
      .maybeSingle();
    // Missing row = default enabled (whatsapp_enabled defaults to true, WHATSAPP.md §2's "even a
    // listed trigger is suppressed if the recipient opted out" rule -- this only runs for
    // categorized types; tenant_invitation has no category above, so it skips this block
    // entirely, same as the exempt account_security_event).
    if (pref && pref.whatsapp_enabled === false) {
      return { sent: false, reason: 'preference_disabled', deliveryConfigured };
    }
  }

  const provider = getWhatsAppProvider();
  const result = await provider.sendTemplateMessage({
    to: toNumber,
    templateName: input.templateName,
    variables: input.variables,
    orgId: input.orgId,
  });

  const { data: message, error: insertError } = await serviceClient
    .from('whatsapp_messages')
    .insert({
      org_id: input.orgId,
      direction: 'outbound',
      to_number: toNumber,
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
    after: { templateName: input.templateName, toNumber, status: 'queued' },
  });

  return { sent: true, whatsappMessageId: message.id, deliveryConfigured };
}
