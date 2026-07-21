# Database

PostgreSQL via Supabase. All schema changes are committed migrations under `supabase/migrations/`, applied in filename order (`supabase migration up` / `supabase db push`). No schema change is ever made through the Supabase Studio UI in a way that isn't also captured as a migration file.

## Conventions

- UUID primary keys (`gen_random_uuid()`).
- All timestamps `timestamptz`, stored UTC, named `created_at` / `updated_at` (auto-maintained by the shared `set_updated_at()` trigger function).
- Soft deletion via `deleted_at timestamptz` on user-owned, document-bearing tables (documents are never hard-deleted by a mere status change — see permanent-deletion workflow in SECURITY.md).
- Enums implemented as Postgres `enum` types for closed, stable sets (e.g. subscription state); open-ended/extensible sets (document categories) are reference tables so customers can add custom categories later without a migration.
- Every customer-owned table has `owner_user_id uuid not null references auth.users(id)` and an RLS policy scoped to `auth.uid() = owner_user_id`.
- External-event tables (`subscription_events`, webhook receivers) carry an `idempotency_key text unique` so a redelivered webhook is a no-op.

## Phase 1 schema (implemented in `supabase/migrations`)

| Table                          | Purpose                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `profiles`                     | 1:1 with `auth.users`; display name, terms acceptance pointer, onboarding step.                                        |
| `user_preferences`             | Biometric-enabled flag, lock timeout, notification quiet hours, default country.                                       |
| `user_terms_acceptances`       | Append-only log of which terms/privacy version a user accepted and when.                                               |
| `properties`                   | Customer-owned property records (see PROJECT.md for full field list).                                                  |
| `property_expected_categories` | Which document categories are "expected" per property per month (drives the checklist).                                |
| `document_categories`          | Reference table: default categories + customer-created custom categories.                                              |
| `documents`                    | File metadata (never the file itself — that's in Storage); ownership, property, category, type, checksum, soft-delete. |
| `bills`                        | Typed, searchable extracted/entered fields for a `bill`/`statement` document: amounts, dates, account number, status.  |
| `payments`                     | Typed fields for a `proof_of_payment`/`receipt` document.                                                              |
| `payment_matches`              | Proposed/confirmed links between a `payments` row and one or more `bills` rows, with score and confirmation state.     |
| `extraction_jobs`              | One row per document-intelligence processing attempt; status, retry count, provider.                                   |
| `extraction_results`           | Raw provider output (jsonb, diagnostics-only) + structured confidence per field.                                       |
| `subscriptions`                | Current entitlement snapshot per user, written only by the service-role webhook path.                                  |
| `subscription_events`          | Append-only RevenueCat event log, idempotency key = RevenueCat event id.                                               |
| `audit_events`                 | Append-only log of security/business-relevant actions (payment confirmations, admin actions, deletions).               |
| `admin_users`                  | Maps an `auth.users.id` to an admin role; separate from `profiles` — a customer account is never also an admin row.    |

Tables listed in the brief but deferred to Phase 2 (interfaces reserved, not yet migrated): `document_versions`, `reminders`, `notification_preferences`, `notification_deliveries`, `device_push_tokens`, `storage_usage`, `admin_roles` (Phase 1 uses a `text` role enum column on `admin_users` instead of a join table — see DECISIONS.md), `admin_notes`, `admin_support_access_requests`, `system_events`, `feature_flags`, `application_config`. These are designed in this document and ARCHITECTURE.md so Phase 2 adds migrations, not redesigns.

## Entity relationships (Phase 1)

```
auth.users 1─1 profiles
auth.users 1─1 user_preferences
auth.users 1─N user_terms_acceptances
auth.users 1─N properties
properties 1─N property_expected_categories
properties 1─N documents
documents  1─0/1 bills            (when document_type in bill/statement)
documents  1─0/1 payments         (when document_type in proof_of_payment/receipt)
documents  1─N extraction_jobs
extraction_jobs 1─1 extraction_results
payments   N─N bills              via payment_matches (supports partial/overpayment/one-to-many)
auth.users 1─0/1 subscriptions
auth.users 1─N subscription_events
auth.users 1─N audit_events
auth.users 0/1─1 admin_users       (only for internal admin accounts)
```

## Indexing

Every foreign key is indexed. Additional composite indexes for the query patterns the spec calls out directly:

- `documents (owner_user_id, property_id, category_id, billing_year, billing_month)` — monthly checklist + archive browsing.
- `bills (owner_user_id, status)` — dashboard due/overdue counts.
- `documents (owner_user_id, deleted_at)` partial index `where deleted_at is null` — default listing excludes soft-deleted rows without a table scan.

## Database functions

- `set_updated_at()` — trigger, generic.
- `is_admin(uid uuid, min_role admin_role)` — `security definer` helper used inside RLS policies and admin route handlers to check role without exposing `admin_users` rows to customers.
- `calculate_monthly_checklist(property_id uuid, year int, month int)` — thin SQL function wrapping the LEFT JOIN described in ARCHITECTURE.md, so mobile and any future surface get identical checklist logic instead of reimplementing it per client.

## Seed data

`supabase/seed/seed.sql` creates two development-only customer profiles with sample properties, documents, bills and payments (obviously fake data, South African address format) purely for local `supabase start` development. It is never applied to a production project.
