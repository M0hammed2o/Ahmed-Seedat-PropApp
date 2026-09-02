# PropertyVault Database Design

Target: PostgreSQL via Supabase. All schema changes are committed migrations under `supabase/migrations/`, applied in filename order — no schema change is made through Supabase Studio without a matching migration file. This document is the pre-migration design/validation pass required before any SQL is written (master prompt Phase 2) — it supersedes the PropVault-era single-owner schema entirely, since the ownership model changes fundamentally (see `EXISTING_CODEBASE_AUDIT.md` §2, `RETAIN_REFACTOR_REBUILD_MATRIX.md`).

## 0. Design principles

1. **Every business table is organization-scoped.** `org_id uuid not null references organizations(id)` on every table below except platform-level tables (`organizations` itself, `plans`, `platform_admin_users`). No table trusts a client-supplied org id without a server-side membership check.
2. **People vs. records are separate.** A `user` (Supabase `auth.users`) is an identity that can log in. Being staff of an org (`organization_members`), being an owner (`owners`), and being a tenant (`tenants`) are all separate _role records_ that may or may not point at a `user_id`. This is what lets one login hold multiple portal identities (evidenced in the PropView screenshots: one account, Landlord + Tenant portals) and lets an owner or tenant exist in the system with zero login (pure bookkeeping record) until/unless they're invited to a portal.
3. **Money is immutable.** No financial table is ever `UPDATE`d after posting. Corrections are reversing/adjusting journal entries (`ACCOUNTING.md`). This drives `journal_entries`/`journal_lines` to be insert-only with app-level (not just convention-level) enforcement — see §9.
4. **RLS is the enforcement layer, not the UI.** Every policy below is written assuming the client (mobile/web) can lie about anything except its authenticated `auth.uid()`. Role/permission checks resolve server-side from `organization_members`/`tenants`/`owners`, never from a client-supplied role claim.
5. **Retain what's sound.** The RLS _pattern_ (deny-by-default, `security definer` helper functions, service-role-only for privileged tables) and the `audit_events`/`profiles` shape from the existing schema carry forward unchanged in spirit — see inline notes marking `[RETAINED PATTERN]`.

---

## 1. Platform layer (not org-scoped)

### `platform_admin_users` [RETAINED, renamed from `admin_users`]

PropertyVault's own operating staff (Super Admin portal). Unchanged in shape from the existing `admin_users` table.

- `id uuid PK`, `auth_user_id uuid references auth.users(id)`, `role platform_admin_role` (`super_admin|support_admin|operations_admin|read_only_admin`), `display_name text`, `is_active bool`, `created_at`
- No client RLS policy — service-role/`is_platform_admin()` server-side only `[RETAINED PATTERN]`. **Naming note**: the live function today is still `is_admin()` (on the still-named `admin_users` table) — the rename to `is_platform_admin()`/`platform_admin_users` is deferred to Milestone 13, not yet applied (`DECISIONS.md` 2026-07-30, `TASKS.md` Milestone 1). Table/function names in this document describe the target schema; treat `is_platform_admin()` as `is_admin()`'s post-Milestone-13 name wherever it's referenced across the architecture docs.

### `plans`

Configurable subscription plans (master prompt §12.5 — pricing must not be hardcoded).

- `id PK`, `code text unique` (e.g. `starter`, `agency`), `name`, `billing_cycle enum(monthly|annual)`, `base_price numeric`, `currency char(3) default 'ZAR'`, `feature_limits jsonb` (max properties/units/staff seats), `is_active bool`, `version int` (plan versioning — a price change creates a new version, existing subscriptions keep their signed-up version unless explicitly migrated)

### `organizations`

The client account. Replaces the implicit "user IS the account" model.

- `id PK`, `legal_name`, `trading_name`, `org_type enum(owner_managed|agency)`, `cipc_reg_no`, `vat_no`, `sars_tax_no`, `popia_officer_name`, `invoice_prefix`, `deposit_interest_pct numeric`, `ffc_number`, `ffc_issued date`, `ffc_expires date`, `status enum(trial|active|overdue|suspended|cancelled|archived)`, `created_at`
- Indexes: `status` (Super Admin dashboard filters heavily on this).
- **`archived` added to the status enum** (architecture-review fix, 2026-07-30): `SUPER_ADMIN.md` §7 flagged that "archive" as a client action had no distinct state from `cancelled`. Decided here rather than left open: `archived` is for orgs whose data must be retained (compliance/audit trail) but who are fully removed from active billing/usage — distinct from `cancelled` (billing lapsed/churned but potentially reactivatable) and distinct from a hard delete (never offered — an org's financial/audit history is never destroyed). `POST /api/v1/admin/organizations/:orgId/archive` (`SUPER_ADMIN.md` §4, `super_admin` only) sets this.

### `organization_subscriptions`

- `id PK`, `org_id FK`, `plan_id FK`, `price_override numeric nullable` (client-specific pricing per §12.5), `discount_pct numeric nullable`, `promotional_credit numeric default 0`, `billing_cycle`, `current_period_start`, `current_period_end`, `next_payment_date`, `status enum(trial|active|overdue|suspended|cancelled)`
- One org can have subscription _history_ (upgrades/downgrades) — this table is append-only per period, not updated in place; `organizations.status` denormalizes the current status for fast dashboard queries.
- **Sync mechanism, fixed by Production Readiness Review 2026-07-30** (previously unspecified — `organizations.status` and `organization_subscriptions.status` could drift with no defined writer): `organizations.status` is written **exclusively** by the same billing service/Edge Function that inserts a new `organization_subscriptions` row — the two writes happen in one transaction, never independently. No other code path (including Super Admin actions like suspend/activate/archive) writes `organization_subscriptions.status` without also writing `organizations.status` in the same transaction. This makes denormalization safe: there is exactly one writer, and it writes both columns together, so "which one is the source of truth" is never an ambiguous question at read time.

### `subscription_payments`

- `id PK`, `org_id FK`, `subscription_id FK`, `amount`, `currency`, `status enum(pending|paid|failed|refunded)`, `payment_method`, `provider_reference`, `paid_at`, `created_at`

### `support_access_sessions`

Audited Super Admin impersonation (master prompt §12.4 — never silent).

- `id PK`, `platform_admin_id FK`, `org_id FK`, `reason text not null`, `started_at`, `ended_at nullable`, `actions_taken jsonb[]` (append-only log of what was done during the session)
- Insert-only for `started_at`/`reason`; `ended_at` is the only field ever updated, and only by the same session closing itself or an automatic timeout.

---

## 2. Identity & organization membership

### `profiles` [RETAINED]

1:1 with `auth.users`. Unchanged.

- `id (=auth.users.id) PK`, `display_name`, `avatar_url`, `onboarding_step`, `created_at`

### `organization_members`

Staff of an org — replaces the single-owner assumption with real org/role membership.

- `id PK`, `org_id FK`, `user_id FK references auth.users(id)`, `role enum(principal|manager|agent|accountant|viewer)`, `status enum(invited|active|revoked)`, `invited_by FK nullable`, `joined_at`
- Unique `(org_id, user_id)`. A user can belong to multiple orgs (evidenced: "Workspaces" screen, IMG_8053 — "you belong to one workspace... anyone who invites you to theirs will appear here").
- Role semantics (evidenced, IMG_8056): principal = full control (implicit, one per org minimum); manager = "runs everything"; agent = day-to-day operations (default invite role); accountant = financial data only; viewer = read-only.

### `organization_invites`

- `id PK`, `org_id FK`, `email`, `role`, `token`, `invited_by FK`, `expires_at`, `accepted_at nullable`

---

## 3. Portfolio

### `properties`

- `id PK`, `org_id FK`, `name`, `address_line1`, `address_line2`, `suburb`, `city`, `province`, `postal_code`, `country default 'ZA'`, `property_type enum(house|apartment|townhouse|duplex|complex|room_cottage|commercial)`, `latitude numeric nullable`, `longitude numeric nullable` (for the simplified V1 Portfolio Map), `status enum(active|archived)`, `created_at`
- Index: `(org_id, status)`; spatial index on `(latitude, longitude)` if the map needs bounding-box queries at scale.

### `units`

- `id PK`, `property_id FK`, `org_id FK` (denormalized for RLS simplicity — every table gets a direct `org_id`, not just a join through `property_id`, so RLS policies never need a subquery to a table that itself needs a subquery), `unit_label`, `bedrooms int`, `bathrooms numeric`, `size_sqm numeric nullable`, `market_rent numeric nullable`, `status enum(vacant|occupied|maintenance)`, `created_at`

### `owners`

Payee/legal-entity record — deliberately decoupled from `auth.users` (§0.2).

- `id PK`, `org_id FK`, `user_id FK nullable references auth.users(id)` (set only if this owner has portal access), `owner_type enum(individual|company|trust)`, `name`, `email`, `phone`, `banking_ref uuid nullable` (pointer into a separate encrypted secrets store — see §11, never a plaintext account number column), `mandate_start date nullable`, `mandate_end date nullable`, `status enum(active|inactive)`

### `property_owners`

Join table supporting fractional/multi-owner properties (evidenced: Owner Statements use "each owner's share", IMG_8043).

- `property_id FK`, `owner_id FK`, `ownership_pct numeric` (constraint: `SUM(ownership_pct)` per property should reconcile to 100 — validated at the application layer on write, not a DB constraint, since a property can legitimately be mid-transfer with an incomplete ownership set)

### `valuations` (V2 — table designed now so the V1 schema doesn't need a breaking migration later, not built into UI/API until V2 per `ROADMAP.md`)

- `id PK`, `property_id FK`, `org_id FK`, `valuation_type enum(market_value|achievable_rent)`, `amount`, `recorded_by FK`, `recorded_at`, `notes`

---

## 4. Leasing

### `tenants`

Occupant record — decoupled from `auth.users` the same way `owners` is.

- `id PK`, `org_id FK`, `user_id FK nullable`, `full_name`, `email`, `phone`, `id_number_ref uuid nullable` (encrypted-secrets pointer, §11), `status enum(active|expired|pending)`, `created_at`

### `tenant_invitations` [added 2026-08-03, PRODUCT DECISION 2, migration `20260101000059`]

Links an **already-existing** `tenants` row to an `auth.users` identity (`tenants.user_id`) via a secure, single-use invitation/activation code — the mechanism behind tenant self-service activation (`AUTHENTICATION.md` §5). Deliberately a **separate table from `organization_invites`** (§2), not a merge or extension of it: `organization_invites` grants a role into an org to someone who may not exist as a row anywhere yet (plaintext `token uuid`, no lockout/short-code concept needed), while `tenant_invitations` links an existing record to an identity and carries materially different requirements — short-code delivery, hashed-at-rest secrets, failed-attempt lockout, masked-destination display — that would have made a shared table ambiguous about which rule set applied to which row (`DECISIONS.md` 2026-08-03).

- `tenant_invitation_delivery_channel` enum: `email|whatsapp|manual`
- `id PK`, `org_id FK`, `tenant_id FK`, `token_hash text unique` (sha256 of the plaintext token, `pgcrypto`/`extensions` schema), `short_code_hash text unique nullable` (sha256 of an optional shorter code, for manual/verbal delivery), `delivery_channel tenant_invitation_delivery_channel`, `destination_hint text nullable` (masked email/phone, for the staff UI's "sent to..." display — never the full address), `expires_at timestamptz default now() + interval '7 days'`, `accepted_at nullable`, `accepted_by_user_id FK nullable`, `revoked_at nullable`, `created_by_user_id FK`, `failed_attempt_count int default 0`, `resend_count int default 0`, `created_at`
- Indexes: `org_id`, `tenant_id`, a partial index on `expires_at` where unaccepted and unrevoked (the expiry-sweep query shape), and a **partial unique index** `tenant_invitations_one_active_per_tenant` on `tenant_id` where `accepted_at is null and revoked_at is null` — enforces at the database level that a tenant can never have more than one live, unaccepted invitation outstanding, regardless of which code path tries to create a second one.
- Trigger `check_tenant_invitation_org_match()`: guards that `org_id` matches the referenced `tenant_id`'s own `org_id` — a defense-in-depth check against a caller that got the two ids out of sync, on top of the RLS/API-layer checks that should already prevent it.
- RLS: `tenant_invitations_select_staff`/`_insert_staff`/`_update_staff`, all `has_org_role(org_id, 'agent')` — staff-only. **No policy grants the invitee self-select** before acceptance; the invitee only ever interacts with the row indirectly through `accept_tenant_invitation()` (below), never a direct table read. Full security model (lockout, rate limiting, generic error codes): `SECURITY.md`.
- Functions (`security definer`, `set search_path = public, extensions`): `create_tenant_invitation(...)` returns `table(invitation_id, token, short_code, expires_at)` — generates a 64-hex-char token (32 random bytes, `gen_random_bytes`) plus an optional 8-char short code, hashes both, revokes any prior active invitation for that tenant first, and returns plaintext exactly once. `regenerate_tenant_invitation(...)` is the same shape, used for both "resend" and "regenerate" in the staff UI, since hashed storage makes a literal resend of the original secret impossible by design. `accept_tenant_invitation(...)` returns `table(success, error_code, tenant_id)` rather than raising for expected failures (`not_found|invalid_code|locked_out|revoked|expired|already_used|org_inactive|already_linked|email_mismatch`) — an earlier version raised exceptions here and pgTAP proved that silently rolled back the `failed_attempt_count` increment made earlier in the same call, since PL/pgSQL rolls back an entire invocation's writes the instant it raises (`DECISIONS.md` 2026-08-03). Short-code acceptance requires the code **and** the tenant's on-file email together, never the code alone. On success, links `tenants.user_id` to the caller.

### `applications`

- `id PK`, `org_id FK`, `property_id FK`, `unit_id FK`, `applicant_name`, `applicant_email`, `applicant_phone`, `popia_consent_at timestamptz nullable`, `screening_consent_at timestamptz nullable`, `screening_status enum(not_started|in_progress|passed|failed)`, `status enum(submitted|screening|decided)`, `decision enum(approved|declined) nullable`, `decision_reason text nullable`, `decided_by FK nullable`, `decided_at nullable`
- On `decision = approved`: application-approval is an application-layer transaction (not a DB trigger, so the business logic stays testable/observable) that atomically creates `tenants` + `leases` + `rent_schedules` rows — mirroring the evidenced one-step automation (IMG_8013).

### `leases`

- `id PK`, `org_id FK`, `unit_id FK`, `start_date`, `end_date nullable`, `rent_amount`, `rent_frequency enum(monthly)`, `deposit_amount numeric default 0`, `status enum(draft|active|expired|terminated)`, `source enum(manual|pdf_parsed|application_approved)`, `source_document_id FK nullable`, `created_at`

### `lease_tenants`

- `lease_id FK`, `tenant_id FK`, `is_primary bool`

### `rent_schedules`

Generated per lease per period; this is what "Rent Due" (IMG_8032) reads from.

- `id PK`, `org_id FK`, `lease_id FK`, `due_date`, `amount`, `status enum(pending|invoiced|paid|overdue|partial)`, `generated_at`
- Index: `(org_id, status, due_date)` — the Rent Due dashboard's primary query shape.

---

## 5. Inspections & maintenance

### `inspections`

- `id PK`, `org_id FK`, `property_id FK`, `unit_id FK`, `lease_id FK nullable`, `inspection_type enum(move_in|move_out|routine)`, `scheduled_at`, `status enum(scheduled|in_progress|awaiting_signature|completed)`, `landlord_signed_at nullable`, `tenant_signed_at nullable`, `tenant_refusal_reason text nullable`, `completed_at nullable`
- Evidenced rule (IMG_8026): completion requires both signatures OR a logged refusal reason — enforced at the application layer before `status` can transition to `completed`.

### `inspection_items`

- `id PK`, `inspection_id FK`, `room`, `item_description`, `condition_rating enum(good|fair|poor|damaged)`, `notes text nullable`

### `inspection_photos`

- `id PK`, `inspection_item_id FK nullable`, `inspection_id FK`, `document_id FK`

### `maintenance_tickets`

- `id PK`, `org_id FK`, `property_id FK`, `unit_id FK nullable`, `lease_id FK nullable`, `tenant_id FK nullable`, `submitted_by FK` (user or tenant), `summary`, `description text`, `priority enum(low|medium|high|urgent)`, `status enum(to_do|in_progress|pending_approval|completed)`, `assigned_vendor_id FK nullable`, `created_at`, `resolved_at nullable`
- Index: `(org_id, status)` for the Maintenance Board's kanban query.

### `maintenance_photos`

- `id PK`, `ticket_id FK`, `document_id FK`

### `vendors`

- `id PK`, `org_id FK`, `name`, `trade_category enum(...)`, `phone`, `email`, `is_external bool` (external/unregistered vendors, evidenced IMG_8028), `rating_avg numeric nullable`, `status enum(active|inactive)`

### `vendor_bills`

No vendor login in V1 (confirmed decision) — staff-entered on the vendor's behalf.

- `id PK`, `org_id FK`, `vendor_id FK`, `maintenance_ticket_id FK nullable`, `amount`, `status enum(submitted|approved|paid|rejected)`, `submitted_by FK`, `approved_by FK nullable`, `approved_at nullable`, `paid_journal_entry_id FK nullable`, `document_id FK nullable` (source invoice)

---

## 6. Documents & OCR

### `documents` [RETAINED PATTERN, org-scoped]

**Corrected 2026-07-31 (TASKS.md M11)**: this section originally specified a `related_entity_type`/`related_entity_id` polymorphic redesign plus a `category enum`, written during early architecture design before the PropVault-era `documents`/`document_categories` tables were re-examined against it. Real execution (checking actual application code before migrating, not just this doc) found that redesign would have **regressed real, working, already-demoed features**: `document_categories` is a live reference table (13 default categories + org-custom categories, referenced by `property_expected_categories`' "expected documents" tracking), `billing_year`/`billing_month` back the Monthly Checklist feature, and `checksum_sha256` backs duplicate-upload detection — none of which the originally-specified shape had room for. Replacing them with a bare `category` enum and dropping period/checksum tracking to match a paper design would have been the tail wagging the dog. Kept the existing, proven shape; added only what was genuinely missing (`org_id`).

- `id PK`, `org_id FK` (added 2026-07-31, migration `20260101000032`), `property_id FK`, `category_id FK → document_categories`, `document_type enum(bill|statement|proof_of_payment|receipt|supporting_document|other)`, `storage_path`, `original_file_name`, `mime_type`, `file_size_bytes`, `checksum_sha256`, `billing_year nullable`, `billing_month nullable`, `deleted_at nullable`, `created_at`
- `related_entity_type`/`related_entity_id` generalization (documents attached to leases/tenants/maintenance tickets/inspections, not just properties) remains a real, plausible future need — evidenced only weakly so far (`PROVIEW_SCREENSHOT_AUDIT.md` doesn't show non-property document attachment in V1) — deferred, not abandoned. Revisit if/when a V1 module actually needs it (candidate: maintenance ticket photos, already modeled separately as `maintenance_photos` in §5 rather than through `documents`).
- `document_categories`/`property_expected_categories`: `owner_user_id`-scoped custom categories become `org_id`-scoped (an org's custom category is shared by its staff, not owned by one individual) — same migration.
- Storage bucket policy: private, path-scoped to `org_id` (extends the existing `[RETAINED PATTERN]` of `(storage.foldername(name))[1] = ...`, previously keyed by user) — **not yet updated**, tracked as `TECHNICAL_DEBT_REGISTER.md` TD-21 alongside the still-open mobile-app-code cutover.

### `ocr_jobs` [RETAINED PATTERN as `extraction_jobs`/`extraction_results`, org-scoped]

Retained under its PropVault-era names (`extraction_jobs`/`extraction_results`) rather than renamed to match this section's original `ocr_jobs` — same reasoning as `documents` above: the existing two-table shape (job status/retry tracking separate from raw provider output) is real, working design, not a placeholder.

- `extraction_jobs`: `id PK`, `document_id FK`, `org_id FK` (added 2026-07-31), `status enum(queued|processing|succeeded|failed)`, `attempt`, `provider_name`, `error_message`, `created_at`
- `extraction_results`: `id PK`, `extraction_job_id FK`, `org_id FK` (added 2026-07-31), `raw_provider_output jsonb`, `overall_confidence`, `created_at`

---

## 7. Communication

### `announcements`

- `id PK`, `org_id FK`, `property_id FK nullable` (null = portfolio-wide), `title`, `body`, `requires_acknowledgement bool`, `published_at`, `expires_at nullable`

### `announcement_reads`

- `announcement_id FK`, `tenant_id FK`, `read_at nullable`, `acknowledged_at nullable`

### `notifications`

- `id PK`, `user_id FK`, `type text`, `title`, `body`, `related_entity_type`, `related_entity_id`, `read_at nullable`, `created_at`

### `notification_preferences` [designed but not migrated in PropVault — building it now]

- `user_id FK`, `category enum(rent|maintenance|lease|inspections|announcements|security|promotional)`, `email_enabled bool`, `push_enabled bool`, `whatsapp_enabled bool`
- **`inspections`/`security` added by architecture review, 2026-07-30**: `WHATSAPP.md` §2's fixed trigger list didn't map cleanly onto the original 5 categories (inspection reminders, account-security events, and document-expiry notices had no home). `security` is present for filtering/organization even though `WHATSAPP.md` §2 already states security events bypass the opt-out entirely ("not optional") — the category exists so email/push versions of the same event are still classifiable, not to imply the WhatsApp send is suppressible. See `WHATSAPP.md` §2 for the full trigger-type → category mapping.

### `whatsapp_messages`

- `id PK`, `org_id FK`, `direction enum(inbound|outbound)`, `to_number`, `from_number`, `related_entity_type`, `related_entity_id`, `template_name`, `body`, `status enum(queued|sent|delivered|read|failed)`, `provider_message_id`, `created_at`
- See `WHATSAPP.md` for the number-resolution rule (§13 of the master prompt: never resolve a conversation from untrusted sender text alone).

### `email_messages`

- `id PK`, `org_id FK`, `direction`, `to_address`, `subject`, `template_name`, `related_entity_type`, `related_entity_id`, `status enum(queued|sent|delivered|bounced|failed)`, `provider_message_id`, `created_at`

### `device_push_tokens`

- `id PK`, `user_id FK`, `platform enum(ios|android)`, `token`, `created_at`, `last_seen_at`

### `verified_phone_numbers` [added by architecture review, 2026-07-30 — closes a gap `WHATSAPP.md` §1.1 flagged]

Cross-entity table backing WhatsApp inbound identity resolution. Deliberately **not** org-scoped for reads — the whole point is resolving a phone number to an org before any org context exists (`WHATSAPP.md` §1.1's own reasoning, reproduced here since the table now lives in this document rather than only being proposed there).

- `id PK`, `org_id FK`, `entity_type enum(tenant|owner|organization_member)`, `entity_id uuid`, `phone_number_e164 text`, `verified_at timestamptz`, `verification_method enum(otp)`, `created_at`
- Unique `(entity_type, entity_id, phone_number_e164)`; index on `phone_number_e164` (the inbound lookup path).
- **No client RLS policy** — same privileged-table pattern as `journal_entries`/`audit_events`/`platform_admin_users` (§12): written only by the OTP-verification server flow, read only by the service-role WhatsApp webhook handler.

### `whatsapp_conversation_state` [added by architecture review, 2026-07-30 — closes a gap `WHATSAPP.md` §1.3 flagged]

Tracks a pending "which account did you mean?" exchange across the stateless webhook round trip (`WHATSAPP.md` §1.2's AMBIGUOUS branch).

- `phone_number_e164 text PK`, `state enum(none|awaiting_context_selection) default 'none'`, `candidate_entities jsonb`, `updated_at timestamptz`, `expires_at timestamptz`
- No client RLS policy — service-role webhook handler only. Rows are short-lived (checked against `expires_at` on every read, not actively purged on a schedule for V1) and never used to remember a _resolved_ identity beyond the immediate exchange (`WHATSAPP.md` §1.3 — every new inbound message re-runs full resolution).

### `usage_events` and `usage_snapshots` [added by architecture review, 2026-07-30 — closes a gap `SUPER_ADMIN.md` §2.3 and `AI_ARCHITECTURE.md` §4 both flagged and left open]

**Decision, made here rather than left as an open question in two separate documents**: fine-grained events written by each subsystem as it consumes a billable/trackable resource, plus a periodic rollup for cheap dashboard reads — the standard event-sourcing-plus-materialized-rollup split, not a novel design.

- `usage_events`: `id PK`, `org_id FK`, `usage_type enum(storage_bytes|email_sent|whatsapp_sent|ocr_page|ai_token)`, `quantity numeric`, `related_entity_type text nullable`, `related_entity_id uuid nullable`, `recorded_at timestamptz`
  - Written synchronously by the subsystem that just consumed the resource (document upload → `storage_bytes`; `EmailProvider.send()` success → `email_sent`; `WhatsAppProvider.sendTemplateMessage()` success → `whatsapp_sent`; OCR job completion → `ocr_page`; `LLMProvider.converse()` return → `ai_token`, per `AI_ARCHITECTURE.md` §4's `costMetadata`).
  - Index `(org_id, usage_type, recorded_at)` — the query shape both the rollup job and any on-demand "usage this period" drill-down need.
- `usage_snapshots`: `id PK`, `org_id FK`, `period date` (billing-period-aligned), `usage_type enum(...)` (same enum), `total_quantity numeric`, `computed_at timestamptz`
  - Populated by a scheduled job aggregating `usage_events` per org/period/type. `SUPER_ADMIN.md`'s client directory and dashboard metrics (§2.3, §3) read `usage_snapshots`, never scan raw `usage_events` for a dashboard render — that's what the rollup exists to avoid.
  - Unique `(org_id, period, usage_type)` — the rollup job upserts, never appends duplicate snapshot rows for the same period.
- RLS: `usage_events`/`usage_snapshots` follow the standard org-membership `select` policy (`§12`); no client insert/update/delete policy — written exclusively by the server-side subsystems and the rollup job (service-role), same reasoning as `audit_events`.
- This closes the "no AI usage/token-tracking table" and "no storage/email/WhatsApp/OCR usage aggregation" gaps both `SUPER_ADMIN.md` §2.3 and `AI_ARCHITECTURE.md` §4 flagged — those documents' per-org usage metrics and AI-usage-cap enforcement now have a concrete table to read/write.

### `email_suppressions` [added by architecture review, 2026-07-30 — closes a gap `EMAIL.md` §7/§9 flagged]

- `id PK`, `org_id FK`, `email_address citext`, `reason enum(hard_bounce|spam_complaint)`, `suppressed_at timestamptz`
- Unique `(org_id, email_address)`. Checked by the email-send path (`EMAIL.md` §7) before every send — a suppressed address short-circuits to a logged skip. RLS: standard org-membership `select`; writes are service-role only (the email-provider webhook handler, on a `bounced`/`failed`-with-permanent-reason or spam-complaint event).

---

## 8. AI

### `ai_conversations`

- `id PK`, `org_id FK`, `user_id FK`, `started_at`

### `ai_messages`

- `id PK`, `conversation_id FK`, `role enum(user|assistant)`, `content text`, `staged_changes jsonb nullable` (the evidenced confirm-before-save pattern — a proposed write is staged here, not applied, until the user confirms), `confirmed bool default false`, `created_at`

### `portfolio_insights`

Rules-based, not LLM-generated — matches the evidenced "nothing is estimated or made up" disclaimer (IMG_7990). See `AI_ARCHITECTURE.md`.

- `id PK`, `org_id FK`, `insight_type text`, `message text`, `data_source jsonb` (the specific records that triggered it, for the "worked out from your own live data" transparency requirement), `severity enum(info|warning|urgent)`, `generated_at`, `dismissed_at nullable`

---

## 9. Accounting subsystem

Full posting rules in `ACCOUNTING.md`; table shapes here.

### `chart_of_accounts`

- `id PK`, `org_id FK`, `code text`, `name`, `account_type enum(asset|liability|equity|income|expense)`, `ledger_class enum(business|trust|deposit)`, `parent_account_id FK nullable`, `is_system bool` (system accounts seeded per org on creation, cannot be deleted), `is_active bool`

### `journal_entries` — **insert-only, never updated**

- `id PK`, `org_id FK`, `entry_date`, `description`, `source_type enum(rent_invoice|expense|payment|deposit|owner_payout|adjustment|reversal)`, `source_id uuid`, `created_by FK`, `posted_at timestamptz not null`, `reversed_by_entry_id FK nullable`, `is_reversal bool default false`
- No `updated_at` column — deliberate. A row that needs to change gets a reversing entry (`is_reversal=true`, `reversed_by_entry_id` pointing back) plus a new correcting entry, never an `UPDATE`.

### `journal_lines` — **insert-only, never updated**

- `id PK`, `journal_entry_id FK`, `account_id FK`, `debit numeric default 0`, `credit numeric default 0`, `property_id FK nullable`, `owner_id FK nullable`, `tenant_id FK nullable`, `memo text nullable`
- App-layer invariant (enforced in the posting service, not just documented): for a given `journal_entry_id`, `SUM(debit) = SUM(credit)`. Unbalanced entries are rejected before insert, never partially posted.

### `trust_ledgers` / `trust_ledger_entries`

- `trust_ledgers`: `id PK`, `org_id FK`, `tenant_id FK`, `lease_id FK`, `opening_balance`, `current_balance` (denormalized), `interest_rate_pct`, `last_interest_accrual_at`
- **Consistency mechanism, fixed by Production Readiness Review 2026-07-30** (previously said "recomputed from entries" without saying when/how, leaving the read-vs-write consistency model undefined): `current_balance` is updated **in the same transaction** as every `trust_ledger_entries` insert (the posting service increments/decrements it as part of the same DB transaction that writes the entry and its backing `journal_lines`, never a separate async step) — so it is always consistent with the entries at the end of any committed transaction, not eventually-consistent. It remains "never the source of truth" in the sense that a reconciliation job (nightly, or on-demand from the Trial Balance screen) independently recomputes `SUM(trust_ledger_entries.amount)` per ledger and **must equal** the stored `current_balance`; a mismatch is treated the same severity as a Trial Balance imbalance (`ACCOUNTING.md` §6) — it means a code path wrote one without the other, which should never happen if the transactional rule above is followed, so a mismatch indicates a bug, not a normal drift to tolerate.
- `trust_ledger_entries`: `id PK`, `trust_ledger_id FK`, `journal_entry_id FK`, `entry_type enum(deposit_received|interest_accrued|deduction|refund)`, `amount`, `created_at`
- Release-gating rule (evidenced IMG_8039): a `deduction`/`refund` entry can only be created if the associated lease has a `completed` move-out `inspection` — enforced in the release service, not just UI.

### `bank_accounts` / `bank_transactions`

- `bank_accounts`: `id PK`, `org_id FK`, `account_class enum(business|trust)`, `bank_name`, `account_number_ref uuid` (encrypted-secrets pointer), `is_active`
- `bank_transactions`: `id PK`, `bank_account_id FK`, `transaction_date`, `amount`, `description`, `reference`, `matched_journal_entry_id FK nullable`, `match_status enum(unmatched|matched|ignored)`

### `invoices`

- `id PK`, `org_id FK`, `lease_id FK`, `tenant_id FK`, `period date`, `amount`, `status enum(draft|issued|paid)`, `issued_at nullable`, `pdf_document_id FK nullable`, `emailed_at nullable`

### `expenses`

- `id PK`, `org_id FK`, `property_id FK`, `vendor_id FK nullable`, `category text`, `amount`, `status enum(recorded|pending|reimbursed|void)`, `document_id FK nullable` (source receipt), `journal_entry_id FK nullable`

### Utilities / rates / levies / budgets [V1 pass — full detail in `UTILITIES_RATES_BUDGET_IMPLEMENTATION.md`, evidence in `UTILITIES_RATES_BUDGET_GAP_AUDIT.md`, migrations 20260101000163-166]

- `recurring_property_costs`: `id PK`, `org_id FK`, `property_id FK`, `unit_id FK nullable` (null = property-level), `cost_type enum(rates_and_taxes|levy)`, `amount`, `effective_from date`, `effective_to date nullable` (null = current). Effective-dated configuration, never overwritten in place — a rate change closes the old row and inserts a new one. Never itself posts to `expenses`.
- `utility_responsibility_settings`: `id PK`, `org_id FK`, `property_id FK`, `unit_id FK nullable`, `utility_type enum(water|electricity)`, `responsibility_mode enum(owner_paid|tenant_paid_direct|tenant_prepaid|included_in_rent|common_area_owner)`, `active bool`. One active row per scope+utility_type; `common_area_owner` is property-scope only.
- `utility_meters`: `id PK`, `org_id FK`, `property_id FK`, `unit_id FK nullable`, `utility_type enum(water|electricity)`, `meter_number text nullable`, `responsibility_mode` (denormalized at creation, not kept in sync), `is_prepaid bool`, `active bool`, `installed_date date nullable`.
- `utility_readings`: `id PK`, `org_id FK`, `meter_id FK`, `period_month date`, `reading_date date`, `reading_value numeric`, `consumption numeric nullable` (server-computed from the prior period, stored for auditability), `unit_of_measure enum(L|kWh)`, `source enum(actual|estimated|manual)`. Unique `(meter_id, period_month)`. Append-only — a same-period correction goes through `record_utility_reading(..., p_replace_existing=true)`, never a bare `UPDATE`. Meter reset/rollover is explicitly unhandled (a lower-than-previous reading is stored as-is, deferred to future scope).
- `property_budgets`: `id PK`, `org_id FK`, `property_id FK`, `month date` (always day=1), `planned_amount`. Unique `(property_id, month)` — the only source of truth; no separate "annual budget" table (`distribute_annual_budget()` just inserts 12 of these rows).
- `budget_category_lines`: `id PK`, `budget_id FK`, `org_id FK`, `category text`, `planned_amount`. Optional per-category breakdown within a monthly budget.
- Actuals are never stored for budgets — `budget_vs_actual(property_id, month)`, `owner_financial_summary(property_id, month)`, and the portfolio-wide `owner_portfolio_financial_summary(org_id, month)` [continuation pass, migration 20260101000167 — sums the same figures across every property in the org, live, never cached; chosen over extending `owner_property_summaries` because that table is a once-per-month frozen snapshot, wrong for a screen read daily — see `UTILITIES_RATES_BUDGET_IMPLEMENTATION.md`] are all `SECURITY DEFINER`, all explicitly `has_org_role(org_id, 'viewer')`-gated, and compute live from `expenses`/`rent_schedules`/`invoice_payments` on every call.
- RLS on all six tables: standard org-role shape matching `expenses`/`owner_statements` exactly — `has_org_role(org_id, 'viewer')` to read, `has_org_role(org_id, 'accountant')` to write. No tenant policy on any of them.

### `owner_statements`

- `id PK`, `org_id FK`, `owner_id FK`, `period_start`, `period_end`, `rent_collected numeric`, `expenses_total numeric`, `management_fee numeric`, `net_payable numeric`, `status enum(draft|issued|paid)`, `payout_matched_transaction_id FK nullable`, `pdf_document_id FK nullable`
- Generated, not hand-entered — an application service reads `journal_lines` filtered by `owner_id`/period and computes these fields; the row is a durable snapshot of that computation at draft time, not a live view, because a statement that's already been emailed to an owner must not silently change if the ledger is corrected afterward (correction shows up in the _next_ period via a reversing entry instead, per §9's immutability rule).

### Tax Pack

No dedicated storage table beyond `tax_pack_exports (id, org_id, tax_year, generated_at, pdf_document_id)` — the report itself is computed on demand from `journal_lines` filtered by SA tax-year boundaries (1 Mar–28 Feb) and account type; only the generated PDF export is persisted.

### `accounting_periods` [added by Production Readiness Review, 2026-07-30 — closes the period-locking gap `ACCOUNTING.md` §9 identifies]

- `id PK`, `org_id FK`, `period_start date`, `period_end date`, `status enum(open|closed)`, `closed_by FK nullable`, `closed_at timestamptz nullable`
- Unique `(org_id, period_start, period_end)`. The posting service checks this table before accepting a `journal_entries` insert with an `entry_date` inside a `closed` period — see `ACCOUNTING.md` §9 for the full rule (rejection, not silent adjustment; reopening is itself an audited action).
- RLS: standard org-membership `select`; `update` (closing/reopening) requires `has_org_role(org_id, 'accountant')` — matches the accounting-role write requirement elsewhere in this document (§12).

---

## 10. Audit

### `audit_events` [RETAINED PATTERN, extended]

- `id PK`, `org_id FK nullable` (nullable only for platform-level events with no org context, e.g. platform admin actions), `actor_user_id FK nullable`, `actor_type enum(user|system|api|ai_assisted)`, `action text`, `entity_type text`, `entity_id uuid`, `before jsonb nullable`, `after jsonb nullable`, `ip_address inet nullable`, `ai_conversation_id FK nullable`, `ai_message_id FK nullable`, `created_at`
- Insert-only, no client `update`/`delete` policy at all (default-deny) `[RETAINED PATTERN]`.
- **`ai_assisted` actor_type + `ai_conversation_id`/`ai_message_id` added by architecture review, 2026-07-30** (closes a gap `AI_ARCHITECTURE.md` §5 flagged): `ai_assisted` means "this write's `actor_user_id` is a real, authenticated, permission-checked user, and it happened via a confirmed AI-staged change rather than a direct UI action" — `actor_user_id` is always populated identically either way; `ai_assisted` never means the AI acted as its own principal (`PERMISSIONS.md` §2 role checks apply identically to AI-confirmed writes, per `API_SPEC.md` §11). The two nullable pointers let a support engineer trace an audited change back to the exact conversation turn that staged it; both are `null` for every non-AI-assisted row.

---

## 11. Secrets / sensitive data

Bank account numbers (`owners.banking_ref`, `bank_accounts.account_number_ref`) and ID numbers (`tenants.id_number_ref`) are stored as a `uuid` pointer into a separate `encrypted_secrets` table (`id`, `ciphertext bytea`, `created_at`), encrypted at the application layer before insert (not `pgcrypto` column-level encryption alone — key management stays outside the database). This keeps a full-table dump or a leaked `SELECT *` from ever exposing plaintext financial/PII data, and matches the hard rule against secrets/PII ever appearing unredacted. Full design in `SECURITY.md`.

---

## 12. RLS strategy

Every table above gets, at minimum:

- `select`: `org_id in (select org_id from organization_members where user_id = auth.uid() and status = 'active')`, unioned with the tenant/owner equivalents where a tenant/owner needs to see their own records (`tenants.user_id = auth.uid()` for tenant-scoped tables, etc.).
- `insert`/`update`/`delete`: same org-membership check, further narrowed by role where the module requires it (e.g. only `accountant`/`manager`/`principal` can write `journal_entries`; `viewer` never writes anything) — role checks live in `security definer` helper functions (`has_org_role(org_id, min_role)`), mirroring the existing `is_admin()` pattern `[RETAINED PATTERN]`.
- `journal_entries`/`journal_lines`/`audit_events`: **no `update`/`delete` policy at all**, for any role — enforced by RLS, not just application code, so a compromised service-role credential still can't silently rewrite financial history without going through the reversing-entry path.

## 13. Indexing & scalability notes

- Every FK column gets an index by default (Postgres doesn't auto-index FKs).
- `(org_id, status)` composite indexes on every module's primary list-view table (`properties`, `leases`, `maintenance_tickets`, `rent_schedules`, `applications`) — this is the shape every dashboard/list screen queries.
- `journal_lines` will be the highest-write-volume table long-term; partition by `org_id` range or `entry_date` if/when a single org's ledger exceeds ~10M rows — not needed at V1 scale, noted here so it isn't a surprise later.
- `documents.storage_path` and `whatsapp_messages`/`email_messages` are natural candidates for time-based archival (move >2yr-old rows to cold storage) once real usage data exists — not a V1 concern.
- **`journal_entries`/`journal_lines`/`audit_events` are never archived or deleted, at any scale** (fixed by Production Readiness Review 2026-07-30 — the archival note above previously left these three ambiguous by omission). These are the permanent financial and compliance record; "archival" for them means moving old rows to cheaper storage tiers _without_ removing query access or altering row content, never deletion. This is a deliberate exception to the general archival guidance, stated explicitly so a future cost-optimization pass doesn't accidentally purge audit/financial history.

### Search / full-text indexing (fixed by Production Readiness Review 2026-07-30 — `API_SPEC.md` §0 references `ILIKE`/trigram search on Properties, Tenants, Vendors, Documents, Audit Log, but no supporting index was previously specified here)

- `pg_trgm` extension enabled (alongside the existing `pgcrypto`/`citext` extensions, `§1` of the original migration set).
- GIN trigram indexes on the specific columns each evidenced search box actually queries: `properties(name, address_line1, suburb, city)`, `tenants(full_name, email)`, `owners(name, email)`, `vendors(name, trade_category)`, `documents` (via a computed/indexed filename or extracted-text column, once OCR text extraction exists), `audit_events(action, entity_type)`. Each is a targeted `gin_trgm_ops` index on the columns the UI's search box actually filters, not a single blanket full-text index across unrelated columns.
- This is sufficient for V1/near-term scale (single-org search, bounded by RLS before the trigram scan even runs). At "tens of thousands of orgs" scale, cross-org search doesn't exist by design (RLS scopes every query to the caller's orgs first), so trigram index size grows with total platform data but each individual query's search space stays bounded by one org's rows — the RLS predicate is applied first in the query plan, which Postgres's planner does correctly for a `WHERE org_id = ... AND name % 'query'`-shaped predicate.

### Platform-level (cross-org) metrics — Super Admin dashboard at scale (fixed by Production Readiness Review 2026-07-30)

`SUPER_ADMIN.md` §2.1's dashboard metrics (`count(organizations)`, `count(properties)` across ALL orgs, etc.) were originally specified as live aggregate queries. At "tens of thousands of organisations" scale, a live `count(*)`/`sum(*)` across every org's rows on every dashboard load is a real, avoidable cost and latency problem — this is fixed the same way per-org usage already is: a scheduled job writes `platform_metrics_snapshots` (`id PK`, `metric_name text`, `value numeric`, `computed_at timestamptz`), one row per tracked metric per computation run (hourly is sufficient — Super Admin doesn't need sub-hour freshness on "total properties managed"). The dashboard reads the latest snapshot per metric, never a live cross-org aggregate. MRR/ARR/churn (already flagged as needing "a helper view/materialization" in `SUPER_ADMIN.md` §2.1) are computed by the same job and stored the same way. This table has no client RLS policy — Super Admin/service-role read only, matching `usage_snapshots`' pattern.

### RLS performance at scale (fixed by Production Readiness Review 2026-07-30 — previously unaddressed)

`has_org_role()` (§ Org-role helper, migration `20260101000021`) is `security definer`, which Postgres does **not** inline into the calling query's plan the way a plain `SQL`/`STABLE` function can sometimes be inlined — meaning at high query volume, it executes as a genuine per-row (or per-statement, depending on the planner) function call rather than being folded into a single index-friendly predicate. At tens of thousands of orgs with many concurrent users, this is a real, measurable cost, not a theoretical one. Mitigations, in order of how much they change the architecture (least-invasive first, escalate only if profiling shows it's actually needed):

1. **Index-friendly member lookup first**: `organization_members(user_id, org_id, status)` composite index (in addition to the existing `(org_id, status)`/`(user_id, status)` indexes) so the subquery inside `has_org_role()` is a pure index lookup, not a scan — cheap to add, add it from day one rather than waiting for a performance problem.
2. **Connection-scoped session claim** (the standard high-scale Supabase/Postgres RLS pattern): instead of every policy independently subquerying `organization_members`, resolve the caller's org memberships **once per request** in the API layer and set them as a Postgres session variable (`SET LOCAL request.orgs = '...'`) that RLS policies read directly (`current_setting('request.orgs')::uuid[]`) instead of re-querying `organization_members` per policy check. This is a bigger change (touches every RLS policy's predicate, not just `has_org_role()`) and is **not implemented in V1** — it's the documented escalation path if/when load testing (`TESTING.md` — flagged below as a gap to add) shows `has_org_role()` is a measurable bottleneck, not a speculative optimization done up front. Building it prematurely without a measured problem would violate the "prefer the simpler architecture" default-decision rule (`DECISIONS.md`).
3. Materialized/cached org-membership lookups (Redis) are the next escalation if (2) proves insufficient — see Caching, below.

## 14. What changes from the PropVault schema

Every PropVault table in `EXISTING_CODEBASE_AUDIT.md` §2 either gets a new `org_id`-scoped replacement above or is superseded outright:

- `properties`, `documents` → same names, re-scoped to `org_id` instead of `owner_user_id` (property also gains `property_owners` for the owner relationship).
- `bills`/`payments`/`payment_matches` → replaced by `expenses` (bills) + `journal_lines`/`bank_transactions` (payments/matching); `calculateMatchScore` (`packages/utils`) is retained and re-targeted at bank-line↔rent-payment matching.
- `subscriptions`/`subscription_events` → replaced by `organization_subscriptions`/`subscription_payments`, now plan-configurable per §12.5 instead of one hardcoded plan.
- `admin_users` → renamed `platform_admin_users`, otherwise unchanged.
- `profiles`, `audit_events` → retained as-is, extended with org scoping where relevant.
