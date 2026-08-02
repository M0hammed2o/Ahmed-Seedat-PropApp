# API Specification

REST over HTTPS, JSON bodies, served from Next.js Route Handlers (`apps/web/app/api/**`) backed by Supabase (direct client queries where RLS alone is sufficient; Route Handlers/Edge Functions where server-side business logic is required — `ARCHITECTURE.md` § Business logic placement). Native mobile apps consume the same API surface as the web app — no mobile-only endpoints, no client bypassing business logic to write Postgres directly except for plain RLS-protected reads where no server-side rule applies (e.g. reading your own properties list).

## 0. Conventions

- **Auth**: `Authorization: Bearer <supabase-jwt>` on every request (native Android/iOS callers) or an equivalent `@supabase/ssr` session cookie (the PWA) — `getServerSupabaseClient()` (`apps/admin/lib/supabase/server.ts`) accepts either through one abstraction, 2026-08-02, `TASKS.md` M10/TD-28. No endpoint accepts a client-supplied `org_id` as authoritative — it's always re-derived server-side from the caller's `organization_members`/`tenants`/`owners` rows (`PERMISSIONS.md`).
- **Base path**: `/api/v1/...`. Versioned from day one — a breaking change ships as `/api/v2` alongside `/v1`, never an in-place breaking change to a shipped mobile app's contract.
- **Pagination**: cursor-based (`?cursor=<opaque>&limit=<n, default 25, max 100>`), response includes `next_cursor: string | null`. Offset pagination is not used — it degrades under concurrent writes, which this system has plenty of (rent schedules, journal entries).
- **Filtering**: `?filter[status]=active&filter[property_id]=<uuid>` — explicit allow-listed filter fields per endpoint, never arbitrary query passthrough to the database.
- **Search**: `?q=<text>` where evidenced (Properties, Tenants, Vendors, Documents, Audit Log all had search boxes) — implemented as `ILIKE`/trigram search server-side, not client-side filtering of a full list.
- **Errors**: `{ error: { code: string, message: string, field_errors?: Record<string,string[]> } }`, standard HTTP status codes (400 validation, 401 unauthenticated, 403 unauthorized, 404 not found _within your org_ — a resource in another org 404s, never 403, so org existence isn't leaked by status code).
- **Auditing**: every mutating endpoint writes an `audit_events` row as part of the same transaction as its primary write — not a best-effort side effect that can silently fail.
- **Idempotency**: mutating endpoints that trigger external side effects (WhatsApp/email send, journal posting) accept an `Idempotency-Key` header; a repeated key with the same body returns the original result rather than double-executing.

## 1. Auth & session

```
POST   /api/v1/auth/signup
POST   /api/v1/auth/signin
POST   /api/v1/auth/signout
POST   /api/v1/auth/password-reset
GET    /api/v1/me                      → profile + all org memberships + owner/tenant records (portal-switch data)
```

## 2. Organizations & billing (Super Admin scope marked)

```
POST   /api/v1/organizations                        (org signup/creation)
GET    /api/v1/organizations/:orgId
PATCH  /api/v1/organizations/:orgId                  (compliance profile fields)
GET    /api/v1/organizations/:orgId/members
POST   /api/v1/organizations/:orgId/invites
POST   /api/v1/organizations/:orgId/invites/:id/accept
DELETE /api/v1/organizations/:orgId/members/:id      (role: manager+)

# Super Admin only (platform_admin_users, separate auth check)
GET    /api/v1/admin/organizations                   (client directory, filters: status/plan)
GET    /api/v1/admin/organizations/:orgId
POST   /api/v1/admin/organizations/:orgId/suspend
POST   /api/v1/admin/organizations/:orgId/activate
POST   /api/v1/admin/organizations/:orgId/archive     (super_admin only; sets status='archived' — distinct from cancelled/suspended, see SUPER_ADMIN.md §4)
GET    /api/v1/admin/organizations/:orgId/usage       (reads usage_snapshots, DATABASE.md §7)
POST   /api/v1/admin/organizations/:orgId/usage/reset (operations_admin+; zeroes current-period usage_snapshots, never deletes usage_events)
PATCH  /api/v1/admin/organizations/:orgId/plan
POST   /api/v1/admin/organizations/:orgId/credits
POST   /api/v1/admin/support-sessions                 (reason required, audited)
POST   /api/v1/admin/support-sessions/:id/end
GET    /api/v1/admin/plans
POST   /api/v1/admin/plans
```

## 3. Portfolio

```
GET/POST           /api/v1/properties
GET/PATCH/DELETE   /api/v1/properties/:id             (DELETE = archive, never hard-delete)
GET/POST           /api/v1/properties/:propId/units
GET/PATCH          /api/v1/units/:id
GET/POST           /api/v1/owners
GET/PATCH          /api/v1/owners/:id
POST               /api/v1/properties/:propId/owners  (attach owner + ownership_pct)
GET                /api/v1/portfolio/map               (properties with lat/lng + occupancy + maintenance-flag summary — simplified V1 map data)
```

## 4. Leasing

```
GET/POST           /api/v1/applications
POST               /api/v1/applications/:id/consent    (POPIA + screening consent capture)
POST               /api/v1/applications/:id/screen
POST               /api/v1/applications/:id/decide      (approved → atomically creates tenant+lease+rent_schedule, per ARCHITECTURE.md)
GET/POST           /api/v1/leases
GET/PATCH          /api/v1/leases/:id
POST               /api/v1/leases/:id/upload-and-parse  (PDF → OCR → prefilled lease review)
GET/POST           /api/v1/tenants
GET/PATCH          /api/v1/tenants/:id
GET                /api/v1/leases/:id/rent-schedule
```

## 5. Operations

```
GET/POST           /api/v1/maintenance-tickets
GET/PATCH          /api/v1/maintenance-tickets/:id      (status transitions validated server-side against the To Do→In Progress→Pending Approval→Completed state machine)
POST               /api/v1/maintenance-tickets/:id/photos
GET/POST           /api/v1/inspections
POST               /api/v1/inspections/:id/items
POST               /api/v1/inspections/:id/sign         (landlord or tenant signature; refusal reason accepted in lieu of tenant signature)
POST               /api/v1/inspections/:id/complete      (rejects if neither both-signed nor refusal-logged)
GET/POST           /api/v1/vendors
GET/POST           /api/v1/vendor-bills
POST               /api/v1/vendor-bills/:id/approve
GET/POST           /api/v1/announcements
POST               /api/v1/announcements/:id/acknowledge (tenant)
```

## 6. Accounting (all writes route through the posting service — `ACCOUNTING.md`)

```
GET     /api/v1/rent-schedules?status=overdue
POST    /api/v1/rent-schedules/recalculate
GET/POST /api/v1/invoices
POST    /api/v1/invoices/:id/issue                       (generates PDF, queues email)
GET/POST /api/v1/expenses
POST    /api/v1/expenses/:id/upload-receipt               (AI-assisted extraction)
GET     /api/v1/bank-accounts
GET/POST /api/v1/bank-transactions
POST    /api/v1/bank-transactions/:id/match                (propose via calculateMatchScore; confirm is separate)
POST    /api/v1/bank-transactions/:id/confirm-match
GET     /api/v1/trust-ledgers/:tenantId
POST    /api/v1/trust-ledgers/:id/release                  (rejects unless move-out inspection is completed)
GET/POST /api/v1/owner-statements
POST    /api/v1/owner-statements/draft                     (month-scoped batch draft, evidenced: skips owners who already have one)
POST    /api/v1/owner-statements/:id/issue
GET     /api/v1/trial-balance?ledger_class=business|trust|deposits
GET     /api/v1/tax-pack?tax_year=2027
POST    /api/v1/tax-pack/export                             (PDF)
POST    /api/v1/journal-entries/:id/reverse                 (never PATCH/DELETE on journal-entries directly — no such endpoint exists)
```

## 7. Documents & OCR

```
POST    /api/v1/documents                (multipart upload, returns document + queues ocr_job)
GET     /api/v1/documents
GET     /api/v1/documents/:id
GET     /api/v1/ocr-jobs/:id
POST    /api/v1/ocr-jobs/:id/review        (human confirms/corrects extracted fields)
```

## 8. Communication

```
GET     /api/v1/notifications
POST    /api/v1/notifications/:id/read
PATCH   /api/v1/notification-preferences
POST    /api/v1/webhooks/whatsapp          (inbound, signature-verified — see WHATSAPP.md)
POST    /api/v1/webhooks/email             (delivery status callbacks — see EMAIL.md)
```

## 9. AI

```
POST    /api/v1/ai/conversations
POST    /api/v1/ai/conversations/:id/messages   (returns assistant reply + staged_changes, never applies directly)
POST    /api/v1/ai/messages/:id/confirm          (applies the staged change via the normal typed endpoint it staged — the AI path re-enters the same permission/validation checks as a human using the UI, never a privileged shortcut)
GET     /api/v1/insights                          (Portfolio Intelligence feed, rules-engine generated)
POST    /api/v1/insights/:id/dismiss
```

## 10. Cross-cutting: permission and validation enforcement

Every endpoint above validates: (1) caller is authenticated, (2) caller has an active membership/owner/tenant relationship to the target `org_id`/resource, (3) caller's role meets the endpoint's minimum role per `PERMISSIONS.md` (e.g. `POST /journal-entries/:id/reverse` requires `accountant`+), (4) request body against a Zod schema (retained pattern from `packages/validation`, extended with new domain schemas) before any database write is attempted. Validation failures return `400` with `field_errors`, never a generic `500`.

## 11. What the AI Assistant and native apps do NOT get

No endpoint grants elevated/bypass access to either the AI Assistant or the native mobile clients — both call the exact same typed endpoints, under the exact same role checks, as the web app. This is the API-design expression of `PERMISSIONS.md` §5's "never only in the UI" rule: there is no shortcut path anywhere in this surface that skips business-logic validation because the caller happens to be a trusted internal client.
