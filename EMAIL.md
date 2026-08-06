# Email

Email is PropertyVault's **comprehensive** communication and document-delivery channel — every notice, document, and system message the platform sends can go by email. This is the deliberate opposite of `WHATSAPP.md`, which is scoped narrowly to urgent, time-sensitive events only (rent overdue, maintenance emergencies) so as not to become a spam channel on a medium tenants can't easily mute. Email has no such restraint: it is the default, catch-all channel, and every other channel (WhatsApp, push, in-app notification) is a supplement to it, never a replacement.

## 1. Scope: what email delivers

Concrete template categories, grouped by why they're sent:

| Category                                                                                                                                                                                                                                                       | Template examples                                                                                                                                                   | Trigger                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Account & auth** (`[RETAINED PATTERN]`, `ARCHITECTURE.md` §"Retained from PropVault")                                                                                                                                                                        | Email verification, password reset, email sign-in code, onboarding welcome                                                                                          | Supabase Auth event / user action                                                                                                        |
| **Leasing**                                                                                                                                                                                                                                                    | New lease issued (PDF attached), lease renewal notice, lease expiring soon, application status change, document request ("please upload your ID / proof of income") | Lease/application state change                                                                                                           |
| **Tenant activation** (added 2026-08-03, PRODUCT DECISION 2 — `DECISIONS.md`, full design `AUTHENTICATION.md` §5)                                                                                                                                              | `tenant_invitation` — secure activation link, expiry, org identity, support contact info; deliberately no lease/financial detail in the email body itself           | `tenant_invitations` row created (`create_tenant_invitation()`/`regenerate_tenant_invitation()`, `POST /api/v1/tenants/:id/invitations`) |
| **Accounting — Invoices & Receipts** (evidenced, `PROPVIEW_SCREENSHOT_AUDIT.md` line 579: _"Download any invoice as a PDF. After you issue it, you can email the PDF to the tenant address saved in PropView. Each email is recorded for your audit history"_) | Invoice issued, receipt of payment                                                                                                                                  | Staff action on `invoices` (`ACCOUNTING.md` §3, §5 evidence: _"PDF + email delivery, logged to audit history"_)                          |
| **Accounting — Owner Statements** (`ACCOUNTING.md` §5)                                                                                                                                                                                                         | Monthly owner statement ready                                                                                                                                       | `owner_statements` row generated/marked `paid`                                                                                           |
| **Accounting — Reports**                                                                                                                                                                                                                                       | Tax Pack export (`ACCOUNTING.md` §7), Trial Balance export                                                                                                          | On-demand staff action                                                                                                                   |
| **Maintenance**                                                                                                                                                                                                                                                | Maintenance ticket update, maintenance report/quote attached                                                                                                        | `maintenance_tickets` state change                                                                                                       |
| **Inspections**                                                                                                                                                                                                                                                | Inspection report (move-in/move-out, PDF), inspection scheduled                                                                                                     | `inspections.status = 'completed'`                                                                                                       |
| **Notices & announcements**                                                                                                                                                                                                                                    | Portfolio-wide or per-property announcement, lease notice (arrears, renewal terms)                                                                                  | `announcements` published                                                                                                                |
| **Billing (platform)**                                                                                                                                                                                                                                         | Subscription receipt, payment failed, plan changed                                                                                                                  | `organization_subscriptions`/`subscription_payments` webhook                                                                             |
| **Team**                                                                                                                                                                                                                                                       | Invite a team member (evidenced, `PROPVIEW_SCREENSHOT_AUDIT.md` line 637: "Create & Share Invite")                                                                  | Staff action on `organization_members`                                                                                                   |
| **Routine communication**                                                                                                                                                                                                                                      | General message from staff to a tenant/owner (free-text, not templated)                                                                                             | Staff-initiated, ad hoc                                                                                                                  |

`notification_preferences.email_enabled` (`DATABASE.md` §7, per-category: `rent|maintenance|lease|announcements|promotional`) gates the marketing/informational categories; transactional categories (auth, invoices, statements, receipts) are **not** user-suppressible — they're operationally required, matching the same distinction most ESPs (and mail law) draw between transactional and marketing mail.

## 2. Provider abstraction

Mirrors the evidenced `DocumentIntelligenceProvider` pattern (`DOCUMENT_INTELLIGENCE.md` §"Abstraction") — vendor-agnostic by design, no vendor lock-in decided prematurely:

```ts
// packages/types/email.ts
interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
  // SendEmailResult includes providerMessageId, and throws a typed ProviderError
  // (retryable | non_retryable) rather than a bare Error — same shape as
  // DocumentIntelligenceProvider's ProviderError, for consistent retry handling
  // across every external-vendor integration in the codebase.
}

interface SendEmailInput {
  orgId: string;
  toAddress: string;
  templateName: string; // e.g. "invoice_issued", "owner_statement_ready"
  templateVars: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
  attachments?: { documentId: string }[]; // reference, never re-generate (see §6)
  replyTo?: string; // org's Reply-To (see §7)
}
```

Candidates for the production implementation — SendGrid, Postmark, AWS SES, Resend — are all plausible and **none is selected here**; selection is deferred the same way OCR vendor selection was deferred in `DOCUMENT_INTELLIGENCE.md` and `DECISIONS.md` (2026-07-21, "OCR/document-intelligence vendor not selected yet"). A real provider account is an **external-service blocker this session cannot provision** (`ROADMAP.md` line 26: WhatsApp and Email are sequenced late specifically because they're "gated on external provider accounts"). Until an account exists:

- `MockEmailProvider` (mirrors `MockDocumentIntelligenceProvider`) logs the constructed message, writes an `email_messages` row with `status = 'queued'`, and never calls out — so the full send → track → audit UI can be built and tested end-to-end before any vendor is chosen.
- No code path may write `status = 'sent'` or `'delivered'` without a real provider response. A mock/local environment stops at `queued` (or an explicitly-labeled `status = 'simulated'` if a demo mode needs to show the downstream UI) — never fabricated as delivered. This is a hard rule, not a style preference: `email_messages.status` is read by the invoice/statement detail views as delivery _proof_, so a faked status would make the audit trail lie.

## 3. Delivery tracking

`email_messages.status` (`DATABASE.md` §7) lifecycle:

```
queued → sent → delivered
              ↘ bounced
              ↘ failed
```

- `queued`: row written at send-request time, before the provider call.
- `sent`: provider accepted the message (synchronous API response).
- `delivered` / `bounced` / `failed`: **only** set by the inbound provider webhook (`POST /api/v1/webhooks/email`, `API_SPEC.md` §8) reporting the real delivery event — never inferred, never defaulted, never assumed from "no error was thrown." This mirrors `whatsapp_messages.status`'s same real-callback-only rule in `WHATSAPP.md` and the general principle in `ACCOUNTING.md` §8 ("never auto-confirm") applied to a different subsystem.
- `provider_message_id` is the join key between the outbound send and the inbound webhook event — the webhook payload's message ID is matched back to the `email_messages` row before any status update is written; an unmatched webhook is logged and dropped, not applied to the newest row for the address (which would misattribute delivery events across messages).
- Idempotency: redelivered/duplicate webhook events for the same `provider_message_id` + status are a no-op, matching the retained idempotency pattern (`SECURITY.md` line 23, `idempotency_key` unique constraint pattern applied here to `(provider_message_id, status)`).

## 4. Template system

- **Org-branded, not PropertyVault-branded.** Every template renders with the sending organization's name/logo (`organizations.name`, `organizations.logo_url` or equivalent), because the email is sent _on behalf of_ the landlord/agency to their tenant or owner — the recipient should see their landlord's brand, not PropertyVault's. This mirrors the reference product's framing (`PROPVIEW_SCREENSHOT_AUDIT.md`: invoices are emailed "to the tenant address saved in PropView" as the landlord's own document, not a PropertyVault-branded notice).
- **Variable substitution** per entity, typed per template — e.g. `invoice_issued` receives `{ tenantName, propertyAddress, invoiceNumber, amount, dueDate, orgName, orgLogoUrl }`; `owner_statement_ready` receives `{ ownerName, propertyAddress, period, netPayable, orgName, orgLogoUrl }`. Template variables are typed (`packages/types/email.ts`, one type per `templateName`) so a missing/renamed field is a compile-time error, not a blank space in a sent email.
- Templates live server-side only (Edge Function/service layer) — the client never constructs email HTML, matching the retained principle that all provider calls (including any templating secrets) happen server-side (`DOCUMENT_INTELLIGENCE.md` §"Processing pipeline" step 2, same rule applied here).

## 5. Audit trail

- Every send writes both an `email_messages` row (delivery-tracking detail, §3) **and** an `audit_events` row (`action = 'email_sent'`, `entity_type`/`entity_id` = the related invoice/statement/lease/etc., `actor_user_id` = the staff member who triggered it or `actor_type = 'system'` for scheduled sends) — matching the evidenced requirement that "each email is recorded for your audit history" (`PROPVIEW_SCREENSHOT_AUDIT.md` line 579) and reusing the retained, insert-only `audit_events` pattern (`DATABASE.md` §10, `ARCHITECTURE.md` §"Retained from PropVault") rather than inventing a parallel audit mechanism.
- **Queryable from the entity's own page**: an invoice's detail view queries `email_messages` filtered by `related_entity_type = 'invoice'`, `related_entity_id = <this invoice>` and renders a small history — who/when it was emailed, current `status`, and the delivered/bounced timestamp from the webhook. Same pattern applies to owner statements, leases, and any other document-bearing entity. This is a direct read of `email_messages`, not a separate reporting table.
- `audit_events` is insert-only with no client `update`/`delete` policy (`DATABASE.md` §10, §12) — an email-sent audit row, once written, is as immutable as a journal entry, which matters for the same reason: it's the record a landlord/agency may need to show a tenant actually was notified.

## 6. Document attachment handling

- PDFs generated from `owner_statements`, `invoices`, and `tax_pack_exports` (`ACCOUNTING.md` §5, §7, `DATABASE.md` §9 "Tax Pack") are stored **once** in the `documents` table (`DATABASE.md` §6, `[RETAINED PATTERN, generalized]`) at generation time, with `documents.related_entity_type`/`related_entity_id` pointing back to the source record (e.g. `owner_statement`) and `documents.category` set appropriately (`statement`, `invoice`, etc.).
- An email attachment is a **reference** (`SendEmailInput.attachments: { documentId }[]`, §2) to that stored `documents` row's `storage_path` — the provider call streams/links the existing file. Nothing regenerates the PDF per send, and nothing duplicates it into a second copy per recipient. Re-sending the same invoice to the tenant a second time attaches the same `documents` row both times.
- If a document is later regenerated (e.g. a corrected invoice), that's a **new** `documents` row (immutability parallel to `ACCOUNTING.md` §1 — the old one is never edited in place), and the new email references the new row; the audit trail (§5) then shows two distinct sends against two distinct documents, which is the correct history to preserve.

## 7. Deliverability basics

**Sending domain — decision: shared PropertyVault domain with org-level Reply-To, not per-org custom domain, for V1.**

- Rationale: per-org custom-domain verification (org configures its own SPF/DKIM/DMARC records, PropertyVault verifies domain ownership, manages per-domain sending reputation) is real complexity — DNS UI, verification polling, failure states, and a support burden — for a benefit (recipient sees `billing@theirlandlord.co.za` instead of `billing@propertyvault.app`) that doesn't change whether the email is delivered or trusted. This follows the same simpler-architecture-by-default reasoning applied elsewhere in this rebuild (e.g. `ACCOUNTING.md` §10 choosing a fully in-house ledger over a third-party integration only after weighing complexity against the alternative, and `DECISIONS.md`'s general bias toward the option that avoids unnecessary V1 complexity).
- Mechanics: PropertyVault owns and verifies **one** sending domain (e.g. `mail.propertyvault.app`) with SPF, DKIM, and DMARC configured once, centrally. Every outbound email sends `From: PropertyVault <notifications@mail.propertyvault.app>` (or an org-flavored display name, `From: "[Org Name] via PropertyVault" <notifications@mail.propertyvault.app>`) with `Reply-To` set to the org's own contact address. A tenant replying to an invoice email reaches the landlord/agency directly; the technical sending identity stays PropertyVault's, which is what SPF/DKIM/DMARC actually need to be configured against.
- Revisit trigger, not a permanent decision: if a paying org later needs full white-label sending (their own domain, no "via PropertyVault"), that's a per-org custom-domain feature to design then — noted here so it isn't silently foreclosed, matching how OCR vendor selection was deferred rather than decided by omission.

**Bounce and complaint handling:**

- A hard bounce (`email_messages.status = 'bounced'` with a permanent-failure reason from the webhook payload) suppresses future sends to that address: the address is written to `email_suppressions` (`DATABASE.md` §7 — `org_id`, `email_address`, `reason enum(hard_bounce|spam_complaint)`, `suppressed_at`) and checked before every send — a suppressed address short-circuits to a logged skip, not a repeated failed send.
- The org is flagged in-app (e.g. a `portfolio_insights`-style warning surfaced on the tenant/owner record: "email to this address is bouncing — verify the address on file") so staff can correct a stale tenant email rather than the system silently going dark on that recipient.
- A spam complaint (where the provider reports one) is treated the same as a hard bounce — suppress and flag — since continuing to send to an address that complained risks the shared sending domain's reputation for every org on the platform, not just the one that triggered it.
- Soft bounces (temporary failure — full mailbox, transient provider error) do not suppress; they're logged and left for the provider's normal retry behavior.

## 8. Security

- **Inbound webhook signature verification.** `POST /api/v1/webhooks/email` (`API_SPEC.md` §8, "delivery status callbacks") verifies the provider's signature (HMAC or provider-specific scheme, e.g. SendGrid's signed webhook / Postmark's basic-auth-plus-IP-allowlist / SES's SNS message signature — exact scheme depends on the vendor selected in §2) against a server-held secret **before** parsing the body or touching `email_messages`, matching the retained pattern already applied to the RevenueCat and OCR webhooks (`SECURITY.md` §"Webhook forgery protection": _"verified by HMAC/signature check inside the receiving Edge Function/route handler before any write; redelivery is a no-op via `idempotency_key` unique constraint"_). Requests that fail verification are rejected `401` and logged to `system_events` as a security event, not processed — same as the existing webhooks, not a weaker variant for email.
- **No PII in email subject lines by default.** Subjects stay generic/operational (e.g. "Your invoice is ready", "New owner statement available") rather than embedding amounts, addresses, or tenant names — subject lines are visible in notification previews, inbox lists, and (for shared/family inboxes) potentially to people other than the intended recipient, so they're treated as a lower-trust surface than the email body. Any template that has a business reason to deviate (none identified yet) would need an explicit, documented exception rather than being the default.
- `email_messages.to_address` and template variables containing PII flow through the same "no secrets/PII in logs" hard rule as the rest of the system — provider request/response logging must redact recipient addresses and template variable bodies in any application-level log output, even though the provider itself necessarily sees the plaintext address to deliver the mail.

## 9. Open items

- Provider selection (SendGrid/Postmark/SES/Resend) — deferred to whenever a real account is provisioned; not blocking template/schema/audit design, which is provider-agnostic by construction (§2).
- Exact per-vendor webhook signature scheme (§8) is written generically here since it depends on the vendor chosen; implementation must confirm the specific verification mechanism for whichever provider is selected before wiring the webhook handler.
- ~~Suppression-list storage not yet in `DATABASE.md`~~ — **resolved, architecture review 2026-07-30**: `email_suppressions` now defined in `DATABASE.md` §7.
