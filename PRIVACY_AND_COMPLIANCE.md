# Privacy and Compliance Foundations

**This document describes technical controls only. It is not a legal opinion and does not itself establish POPIA, GDPR, or any other legal compliance. Items below marked "requires legal review" must be reviewed by a qualified professional before this product is marketed as compliant with any specific regime.**

## Implemented/scaffolded technical foundations

- **Terms/privacy acceptance**: `user_terms_acceptances` records `(user_id, document_type, version, accepted_at)` — versioned and timestamped, append-only, so "what did this user agree to and when" is always answerable. _(Requires legal review: actual Terms of Service and Privacy Policy text do not exist yet — placeholders only.)_
- **Data isolation**: RLS on every customer-owned table (SECURITY.md) — the core technical control behind any data-protection claim.
- **Audit logging**: `audit_events` for security/business-relevant actions (payment match confirmations, admin actions on a customer account, account deletion requests).
- **Account deletion request**: Phase 1 implements the request workflow (customer submits a request, stored + audited) but not automated hard-deletion across all tables/Storage yet — that cascade needs a defined retention decision first (see below). _(Requires legal review: minimum retention period for financial documents before deletion is permitted, which varies by jurisdiction and document type.)_
- **Data export request**: interface/table design only in Phase 1 (tracked in TODO.md); not yet implemented.
- **Minimal data collection**: registration collects only email + password; property/document fields collected are exactly what the product needs to function, nothing speculative.
- **Retention configuration**: `packages/config` reserves a `retentionPolicy` shape (soft-delete grace period, permanent-deletion delay) but default values are placeholders pending legal input.

## Explicitly deferred, not silently skipped

- POPIA Information Officer designation and registration — organisational/legal action, not a code artifact.
- Data Processing Agreement with RevenueCat/OCR vendor/Supabase — contractual, requires Mohammed's review.
- Cross-border data transfer assessment (Supabase region choice affects this) — needs a region decision recorded in DECISIONS.md once infrastructure is provisioned.
- Cookie/consent banner for the admin dashboard if it ever collects visitor analytics beyond authenticated admin usage.

## Analytics privacy rule (enforced in code, not just documented)

`packages/utils/analytics.ts`'s event-tracking function takes a typed event name from a closed allow-list and a payload type that structurally cannot include document text, addresses, account numbers, payment references, file contents, passwords, or biometric data — the TypeScript types for each event's payload only expose safe fields (e.g. `propertyCount`, not `propertyAddress`).
