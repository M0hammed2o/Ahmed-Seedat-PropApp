# WhatsApp Integration

## 0. The constraint this entire document designs around

**PropertyVault uses exactly ONE platform-owned WhatsApp Business number for the whole product** — not one per organization, property, owner, or tenant. Every client org's tenants, owners, and staff message and are messaged through the same shared channel (governing product spec, master prompt). This single fact drives every design decision below:

- A phone number alone does not tell you which org, or even which _person_, is messaging — resolution must be data-driven, never inferred from message content (§1).
- Every outbound message must be self-evidently branded to the right org/property, or a shared number reads as spam or as a different landlord entirely (§3).
- The number is a scarce, sensitive shared resource — what can be sent through it is a fixed, enumerable list, not an open channel any code path can write to (§2).

## 1. Conversation / context resolution

This is the hard problem in this integration: an inbound WhatsApp message carries only a phone number and text. That number could belong to a tenant in Org A, a tenant or owner in Org B (numbers get recycled/reused, and one phone can legitimately be both a tenant and an owner), or nobody in the system yet.

**Rule: identity is resolved only from verified phone numbers on file, never from message content.** A message that says "Hi, this is John at 12 Oak Street" is never trusted to mean anything about who the sender is — it's just text. Trusting sender-supplied identity claims would let anyone with a WhatsApp client impersonate any tenant/owner by number-guessing or social engineering; this is the exact failure mode the resolution algorithm below exists to prevent.

### 1.1 What "verified" means

A phone number counts as verified only if it was confirmed via an OTP (one-time code sent to that number and echoed back) at signup or at profile-update time — never a number simply typed into a form field and saved. Unverified phone numbers on `tenants`/`owners` (the current `phone` column, per `DATABASE.md` §4/§3) are usable for _outbound_ contact info display but are **not** eligible inputs to inbound resolution.

**Resolved by architecture review, 2026-07-30**: `verified_phone_numbers` is now defined in `DATABASE.md` §7, with the exact shape proposed here. Neither `tenants.phone` nor `owners.phone` carries a verification flag itself — verification status lives entirely in this dedicated table, not as a column on the entity tables, precisely because the resolution lookup needs to scan across all orgs by phone number alone before any org context is known, which the entity tables (org-scoped by RLS) can't serve directly.

`organization_members` is included as a resolvable `entity_type` because a staff member (e.g. a `principal` who is also effectively the "owner contact") can also be a valid WhatsApp resolution target; membership phone verification reuses the same OTP flow, independent of Supabase Auth's own optional phone-auth feature.

### 1.2 Resolution algorithm

Runs inside the webhook handler, after signature verification (§4), before any reply or side effect:

```
1. Normalize the inbound `from` number to E.164.
2. SELECT entity_type, entity_id, org_id FROM verified_phone_numbers
   WHERE phone_number_e164 = :from
   -- service-role query, unscoped by org, exactly because org is what we're trying to find
3. Branch on match count:

   0 matches  → UNAUTHENTICATED
     - No context is assumed. The only response class permitted is a fixed
       "we don't recognize this number — please open the PropertyVault app to identify
       yourself" style reply (§2 trigger list does not apply; this is not a notification,
       it's a safety-rail auto-reply). No related_entity_type/id is set on the
       whatsapp_messages row. No downstream action (payment lookup, ticket lookup,
       lease detail) is ever taken.

   1 match    → RESOLVED
     - Route the conversation to that (org_id, entity_type, entity_id) context.
       Every subsequent action in this conversation turn is scoped exactly as if
       the request had come from an authenticated API call for that entity — same
       org-scoping discipline as `ARCHITECTURE.md`'s "Multi-tenancy model" (RLS +
       API-layer checks), just entered from a webhook instead of a session.

   2+ matches → AMBIGUOUS
     - Never guess, never pick "most recent" or "most likely." The bot's only
       permitted action is to present the sender with their distinct contexts,
       generically labeled (e.g. "You're linked to more than one PropertyVault
       account: (1) a Tenant account (2) an Owner account. Reply 1 or 2.") and
       hold conversation state (see §1.3) until the sender picks one. Nothing
       identifying — property name, organization name, address, balance, lease
       terms, payment status — is disclosed pre-selection, only the *role* of
       each candidate match.
```

Case (c) ambiguity is expected, not exceptional: the same person can legitimately be both an owner and a tenant, or two unrelated people can end up sharing a recycled SIM across two unrelated orgs. Both look identical at the phone-number layer, which is exactly why the disambiguation step is mandatory rather than a fallback for rare cases.

**Disclosure fix, architecture review 2026-07-30**: the original design for this branch named the specific property/org in the disambiguation prompt (e.g. "Tenant at 12 Oak Street, Org A"). That's a real information-disclosure risk given `verified_phone_numbers`' own trust model: verification proves control of the number _at verification time_, not permanently — a recycled SIM means a phone number can legitimately re-verify to a _different_ real person later while stale `verified_phone_numbers` rows for the previous holder still exist (until re-verification/expiry cleans them up). Naming the property/org before the sender has proven anything beyond "I currently hold this SIM" would leak a previous holder's tenancy/ownership details to whoever has the number now. The fix: disambiguation prompts disclose role labels only ("a Tenant account," "an Owner account"), never identifying details, until resolved to exactly one context.

### 1.3 Conversation state

WhatsApp webhooks are stateless per-request; a "which context did you mean?" exchange spans two inbound messages. `whatsapp_conversation_state` (`DATABASE.md` §7 — keyed on `phone_number_e164`, `state enum(none|awaiting_context_selection)`, `candidate_entities jsonb`, `updated_at`, `expires_at`) tracks this across the round trip. Once a selection is made (or `expires_at` passes), it reverts to `none` — state is never used to remember a resolved identity beyond the immediate exchange; every new inbound message re-runs the full resolution algorithm in §1.2 rather than trusting a cached "last known identity," so a number that gets reassigned or a session that goes stale can't leak into the wrong context.

## 2. Message policy — fixed trigger list, not a general channel

WhatsApp is reserved for urgent/important events. It is **not** a substitute for `notifications`/`email_messages`/in-app announcements, and no code path may free-text an arbitrary message through it. This is enforced as a closed enum, not a convention:

```ts
// packages/types — WhatsAppNotificationType
type WhatsAppNotificationType =
  // Tenant-facing
  | 'rent_overdue_material' // materially overdue rent
  | 'payment_accepted'
  | 'payment_rejected'
  | 'lease_expiring_soon'
  | 'urgent_property_announcement'
  | 'inspection_reminder_important'
  | 'maintenance_update_critical'
  | 'document_missing_required' // missing legally required document
  | 'id_document_expiring'
  // Owner-facing
  | 'payment_awaiting_confirmation'
  | 'payment_discrepancy'
  | 'rent_overdue_significant'
  | 'lease_expiring_soon_owner'
  | 'maintenance_approval_urgent'
  | 'account_security_event' // e.g. new device login, password/phone changed
  | 'owner_statement_available';
```

Each value maps 1:1 to exactly one pre-approved WhatsApp message template (§3) and is the _only_ accepted input to the send function — there is no `sendWhatsApp(freeformText)` entry point on the dispatcher. Adding a new trigger means adding an enum value, a template, and a code review, mirroring how `plans`/`feature_limits` and other fixed-vocabulary product surfaces in this codebase are deliberately closed rather than string-typed (`DATABASE.md` §1). This is what keeps the shared number from becoming a firehose: nothing outside the dispatcher can originate a WhatsApp send, so a bug in, say, the announcements feature can't accidentally blast every tenant's WhatsApp.

Everything else — routine reminders, marketing, non-urgent status updates — stays on `notifications`/`email_messages`/push, gated per-user by `notification_preferences.whatsapp_enabled` (which still applies: even a listed trigger is suppressed if the recipient opted out, except account-security events, which are compliance/safety-critical and not optional).

**Trigger type → `notification_preferences.category` mapping** (architecture review, 2026-07-30 — closes a gap where several trigger types had no matching category in the original 5-category enum; `DATABASE.md` §7 extended the enum to `rent|maintenance|lease|inspections|announcements|security|promotional`):

| `WhatsAppNotificationType`                                                                                                                          | Category                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `rent_overdue_material`, `payment_accepted`, `payment_rejected`, `payment_awaiting_confirmation`, `payment_discrepancy`, `rent_overdue_significant` | `rent`                                                                                                                  |
| `lease_expiring_soon`, `lease_expiring_soon_owner`                                                                                                  | `lease`                                                                                                                 |
| `urgent_property_announcement`                                                                                                                      | `announcements`                                                                                                         |
| `inspection_reminder_important`                                                                                                                     | `inspections`                                                                                                           |
| `maintenance_update_critical`, `maintenance_approval_urgent`                                                                                        | `maintenance`                                                                                                           |
| `document_missing_required`, `id_document_expiring`                                                                                                 | `lease` (identity/lease-compliance documents)                                                                           |
| `account_security_event`                                                                                                                            | `security` — **not gated by `whatsapp_enabled`**, sent regardless of preference, per the "not optional" rule above      |
| `owner_statement_available`                                                                                                                         | `rent` (financial-statement family; no dedicated "accounting" category exists yet — revisit if the category list grows) |

## 3. Personalization — templates, not generic text

Because the number is shared platform-wide, every outbound message must make the sending org/property obvious in the first line — an unbranded "Your payment is overdue" from an unknown number is indistinguishable from a scam text. Every template is parameterized:

```
[org_trading_name] — [property_name if applicable]
{{tenant_first_name}}, {{rent_overdue_message_body}}
```

Example (`rent_overdue_material`):

> "Hi {{tenant_first_name}}, this is {{org_trading_name}} regarding your rental at {{property_name}}. Your rent payment of {{amount}} was due {{due_date}} and is still outstanding. Please contact your property manager or pay via the PropertyVault app."

Template variables are populated server-side from the same org/property/tenant/owner records the rest of the app uses (never client-supplied), substituted at send time by the dispatcher described in §5. A real WhatsApp Business API account also _requires_ pre-approved template registration for any business-initiated message sent outside a 24-hour customer-service window since the recipient's last inbound message (Meta's standard HSM/session-message rule) — so the closed trigger list in §2 doubles as the exact set of templates that need Meta/BSP template approval, not an arbitrary future list.

## 4. Inbound webhook security

`POST /api/v1/webhooks/whatsapp` (`API_SPEC.md` §8) follows the same webhook-forgery-protection pattern already used for RevenueCat and the OCR provider callback (`SECURITY.md` → "Webhook forgery protection"):

1. Verify the request signature (`X-Hub-Signature-256`, WhatsApp Business API/Meta's standard HMAC-SHA256 over the raw payload, keyed by `WHATSAPP_WEBHOOK_SECRET`/app secret) **before** parsing the body.
2. A missing or mismatched signature is rejected with 401, logged as a security event to `audit_events` (`actor_type = 'system'`, `action = 'webhook_signature_rejected'` — there is no separate `system_events` table in `DATABASE.md`; `audit_events` is the single event log for this, matching the RevenueCat/OCR precedent), and **no** row is written to `whatsapp_messages` and no downstream action (resolution, reply, status update) runs.
3. Only after signature verification does the payload get parsed (through a `packages/validation` Zod schema, per `SECURITY.md`'s input-validation rule) and handed to the resolution algorithm (§1.2).
4. Idempotent by provider-assigned message id: a redelivered webhook for a `provider_message_id` already recorded is a no-op, not a duplicate `whatsapp_messages` insert or a duplicate reply — same idempotency discipline `API_SPEC.md` §1 requires for mutating endpoints generally.

**Note for `SECURITY.md`:** its "Webhook forgery protection" list currently enumerates RevenueCat and the OCR callback only; this endpoint should be added there as a third entry using the identical shared-secret/HMAC pattern once this feature is built, so the security checklist stays the single source of truth for all inbound webhook trust boundaries.

## 5. Provider abstraction

Matching the existing `DocumentIntelligenceProvider` (`DOCUMENT_INTELLIGENCE.md`) / `SubscriptionProvider` (`SUBSCRIPTIONS.md`) vendor-agnostic pattern in this codebase — the product is built against an interface, not a specific BSP, so the vendor choice doesn't lock in the architecture:

```ts
// packages/types — WhatsAppProvider
interface WhatsAppProvider {
  sendTemplateMessage(input: {
    to: string; // E.164
    templateName: WhatsAppNotificationType;
    variables: Record<string, string>;
    orgId: string;
  }): Promise<{ providerMessageId: string }>;

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;

  parseInboundEvent(rawBody: unknown): InboundWhatsAppEvent; // message | status_callback

  parseStatusCallback(rawBody: unknown): {
    providerMessageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    failureReason?: string;
  };
}
```

`MockWhatsAppProvider` (buildable now, no external dependency) returns deterministic fake `providerMessageId`s and simulates the queued→sent→delivered lifecycle on a timer, so the resolution engine, template system, and dispatcher can be built and tested end-to-end before any real provider account exists — same rationale as `MockDocumentIntelligenceProvider` (`DOCUMENT_INTELLIGENCE.md`).

**Production provider: not selected, external-service blocker.** A real WhatsApp Business API account is required — either directly via Meta (Cloud API) or through a BSP (Twilio, MessageBird, 360dialog, etc.) — and account provisioning, business verification, and template approval with Meta are all external processes this session cannot perform. This mirrors the `DocumentIntelligenceProvider` OCR-vendor decision already deferred in `DOCUMENT_INTELLIGENCE.md` §1: the interface is deliberately provider-agnostic so BSP selection is a Phase-2 decision, not a blocker to building the rest of the system against `MockWhatsAppProvider`.

## 6. Delivery tracking

`whatsapp_messages.status` (`DATABASE.md` §7) lifecycle: `queued → sent → delivered → read → failed`. Driven entirely by real provider webhook status callbacks via `parseStatusCallback` (§5) matched on `provider_message_id` — never simulated or advanced by client-side polling/assumption. `failed` includes the provider's failure reason where available (e.g. number not on WhatsApp, template rejected, rate-limited) for surfacing in the Admin/Owner UI rather than a silent drop. Each transition is a single `UPDATE ... WHERE provider_message_id = :id`, so an out-of-order or redelivered callback can only move status forward to what the provider actually reports, never regress it based on stale webhook ordering.

## 7. Org-scoping discipline

Once a conversation is resolved (§1.2) to `(org_id, entity_type, entity_id)`, every read/write the bot performs for that turn goes through the same two independent enforcement layers as the rest of the platform (`ARCHITECTURE.md` → "Multi-tenancy model"): the service-role webhook handler explicitly filters every query by the resolved `org_id` (API-layer check), and RLS on the underlying tables (`rent_schedules`, `maintenance_tickets`, `leases`, etc.) independently re-enforces the same scoping — so a bug in the resolution/dispatch code path cannot become a cross-org data leak on its own, matching the platform-wide "RLS is the enforcement layer, not the UI" principle (`DATABASE.md` §0.4). `whatsapp_messages.org_id` is stamped from the resolved context, never from client input, since there is no client here — only the sender's phone number.

## Unresolved / open questions

- ~~`verified_phone_numbers`/`whatsapp_conversation_state` not in `DATABASE.md`~~ — **resolved, architecture review 2026-07-30**: both now defined in `DATABASE.md` §7 with full RLS/index treatment.
- The OTP verification flow that populates `verified_phone_numbers` (who triggers it — signup, profile update, first WhatsApp contact attempt — and what OTP provider sends it) is not yet designed; this document assumes it exists but doesn't specify it.
- `SECURITY.md`'s "OWASP-relevant controls" section should list this endpoint's signature-verification requirement explicitly once built — currently covered generically under "WhatsApp / email webhook security," which is sufficient for now but worth a named entry once implementation starts.
- BSP selection (Meta direct vs. Twilio/MessageBird/360dialog) is an open Phase-2 decision blocked on an external account being provisioned — cost/deliverability/template-approval-speed tradeoffs need Mohammed's input, not guessed here.
- Rate limiting / cost control on outbound sends (WhatsApp Business API messages are billed per conversation by Meta) isn't addressed in this document and should probably live alongside the `RATE_LIMITS` constant set noted in `SECURITY.md`.
- Re-verification/expiry policy for `verified_phone_numbers` (mitigating the SIM-recycling risk noted in §1.2's disclosure fix) is not yet designed — candidate approach: expire a verification after N months of inactivity and require re-OTP, but N is not chosen here.
