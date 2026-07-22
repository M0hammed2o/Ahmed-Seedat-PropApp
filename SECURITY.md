# Security

Security is release-blocking (per project mandate). This document is the working checklist; PRIVACY_AND_COMPLIANCE.md covers the legal/compliance layer built on top of these technical controls.

## ⚠️ RELEASE-BLOCKING: Demo mode is an authentication bypass

Phase 2 added `EXPO_PUBLIC_DEMO_MODE` (mobile) / `NEXT_PUBLIC_DEMO_MODE` (admin) so both apps run end-to-end on realistic mock data with zero backend setup, for sales/client demonstrations before a Supabase project exists (see DECISIONS.md). **Both default to ON when the variable is unset.**

In the admin app specifically, demo mode:

- Makes `/login` accept **any** email/password (`apps/admin/app/login/page.tsx`).
- Skips the session check in `middleware.ts` entirely.
- Makes `lib/auth.ts`'s `getAdminSession()` return a fixed fake `super_admin` session without touching Supabase at all.
- Serves every dashboard page from mock data instead of the real database.

A server-side console warning fires on boot whenever this is active (`apps/admin/lib/demoMode.ts`), and every demo screen/page carries a visible "Demo data"/"Demo mode" badge — but neither of those stops a real deployment from running wide open if the variable is left unset.

**Before any deployment that could be reached by anyone other than the person driving a demo:** set `NEXT_PUBLIC_DEMO_MODE=false` (and `EXPO_PUBLIC_DEMO_MODE=false` for the mobile build) explicitly, and confirm real `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` values are set — `lib/supabase/server.ts` and `lib/auth.ts` will then require and use them for every request as originally designed (see the rest of this document).

## Trust boundaries

1. **Mobile/admin client → Supabase (anon key)**: zero implicit trust. Every table a customer can reach has RLS. See SECURITY.md → RLS policy summary below.
2. **Webhooks (RevenueCat, OCR provider) → Supabase**: verified by HMAC/signature check inside the receiving Edge Function/route handler before any write; redelivery is a no-op via `idempotency_key` unique constraint (see DATABASE.md).
3. **Admin browser → Next.js server**: the browser never receives the service-role key. Elevated reads/writes happen in server route handlers (`apps/admin/app/api/admin/**`) that construct a service-role client from `process.env.SUPABASE_SERVICE_ROLE_KEY` on the server only, guarded by the `server-only` package so an accidental client-component import fails the build rather than leaking at runtime.
4. **Admin role vs RLS**: an admin does not get elevated Postgres access via a permissive client-side RLS policy — that would mean anyone who obtained a similar-looking anon session could try the same query. Elevated admin reads go through server route handlers that (a) verify the caller's Supabase session, (b) check `is_admin()` server-side, (c) then use the service-role client, (d) write an `audit_events` row. Customer-table RLS itself never grants admins a blanket bypass condition.

## Row-Level Security policy summary (Phase 1 tables)

For every customer-owned table (`properties`, `documents`, `bills`, `payments`, `payment_matches`, `extraction_jobs`, `extraction_results`, `property_expected_categories`, `user_preferences`, `user_terms_acceptances`, `profiles`):

- `select`: `owner_user_id = auth.uid()` (or, for tables reached via a parent id like `bills.document_id`, an `exists` subquery back to the owning `documents`/`properties` row's `owner_user_id`).
- `insert`: `with check (owner_user_id = auth.uid())` — a client cannot insert a row it claims belongs to another user.
- `update`/`delete`: `using (owner_user_id = auth.uid())`.
- `subscriptions`, `subscription_events`, `audit_events`: customer gets `select`-only on their own rows; all `insert`/`update` happen exclusively through the service-role webhook/server path (no client insert/update policy exists at all, which is enforced by default-deny — RLS with no matching policy denies the operation).
- `admin_users`: no policy grants any non-service-role client access; admin identity is resolved server-side only.

Full SQL lives in `supabase/migrations/*_rls_policies.sql`. RLS test cases (User A cannot read/write User B's rows, cannot forge `owner_user_id`, cannot access another user's signed URL) are specified in TESTING.md and will be executed against a local `supabase start` instance — see the Unresolved section in the final delivery report for current run status, since they require a live Postgres instance this sandbox does not provision automatically.

## Storage security

- Buckets are **private** (`public = false`). No object is ever served via a public URL.
- Path convention `{user_id}/{property_id}/{year}/{month}/{uuid}.{ext}` is defense-in-depth only — the actual authorization is a Storage RLS policy requiring `(storage.foldername(name))[1] = auth.uid()::text`, so guessing another user's path still fails at the policy layer.
- Client access is always via a short-lived signed URL requested through a call that itself checks the `documents` row's ownership before signing — a signed URL is never generated from a client-supplied path alone.
- Signed URL TTL is configurable (`packages/config`), defaults short (5 minutes) for preview and slightly longer (60s single-use intent) for download.

## Webhook forgery protection

- RevenueCat webhook: verifies the `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` (shared-secret; RevenueCat's simplest supported scheme) before parsing the body. Requests without a matching secret are rejected with 401 and logged to `system_events` as a security event, not processed.
- OCR/document-intelligence callback: same pattern — HMAC-signed payload checked against `DOCUMENT_INTELLIGENCE_WEBHOOK_SECRET` server-side (see DOCUMENT_INTELLIGENCE.md).
- Both paths are idempotent by external event id, so a replayed valid request is safely ignored rather than double-applied.

## Input validation

All external input (mobile forms, admin forms, webhook payloads) is parsed through a `packages/validation` Zod schema before touching the database — client-side for UX, and **again server-side** (Edge Function / route handler) since client-side validation is a UX affordance, not a security control.

## Secrets

- `.env.example` files contain only placeholder values (`TO_BE_CONFIRMED`, `CHANGE_ME`), never real keys.
- Service-role key: Edge Function secrets + Next.js server environment only; never in `NEXT_PUBLIC_*`, never in the Expo app, never logged.
- A repository-wide secret scan (`git grep` for common key patterns) is run as part of the Phase 1 verification pass (see WORKLOG.md for the actual command and result).

## Other release-blocking controls implemented or scaffolded in Phase 1

- Admin dashboard sends standard secure headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, restrictive `Content-Security-Policy`) via `next.config` headers.
- Rate-limiting architecture: a `packages/config` constant set (`RATE_LIMITS`) plus a documented Edge Function middleware pattern; Phase 1 does not yet wire a distributed limiter (needs a store — Upstash Redis or Supabase-based token bucket — deferred, tracked in TODO.md).
- File upload validation: MIME type + extension allow-list + magic-byte signature check (`packages/utils/fileValidation.ts`) + size limit from `packages/config` plan limits.
- Path traversal: storage paths are always server-constructed from `(user_id, property_id, uuid)`, never from a client-supplied filename directly.
- IDOR: every lookup by id is scoped through RLS (customer side) or an explicit ownership check (admin/service-role side) rather than "trust the id".
- Logs never include full document contents, tokens, or file bytes — only structured metadata (see analytics/error-monitoring abstractions).

## What still needs security review before production (not yet done)

- Formal penetration test / third-party review.
- Rate limiting with a real backing store.
- CSP tightened against the actual final asset hosts once chosen.
- RevenueCat/OCR webhook secrets rotated and stored in the real secret manager for the hosting target.
- Legal review of retention periods (see PRIVACY_AND_COMPLIANCE.md).
