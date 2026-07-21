# Admin Dashboard

Separate Next.js app (`apps/admin`), separate authentication realm from customers (an `admin_users` row is required in addition to a valid Supabase session — a customer account being compromised does not grant admin access).

## Information architecture

See ARCHITECTURE.md navigation map. Five sections: Overview, Customers, Subscriptions, Processing, System.

## Roles (least privilege)

| Role               | Can                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_only_admin`  | View everything in Overview/Customers/Subscriptions/Processing/System. No mutations.                                                         |
| `support_admin`    | Above + suspend/reactivate account with reason, trigger password-reset email, add admin notes, retry eligible processing jobs.               |
| `operations_admin` | Above + feature flags, plan limits, maintenance banner.                                                                                      |
| `super_admin`      | All of the above + manage `admin_users` rows, privileged subscription override (with mandatory reason + audit record — never a bare toggle). |

Role check helper: `is_admin(uid, min_role)` (Postgres, `security definer`) plus a mirrored TypeScript `requireRole()` in `apps/admin/lib/auth.ts` used by both `middleware.ts` (coarse gate, redirects unauthenticated/non-admin sessions away from `(dashboard)`) and each server route handler (fine-grained, per-action role check — middleware alone is not treated as sufficient authorization for a mutating route, since Next.js middleware can be bypassed in edge cases; every mutating route handler re-checks).

## Customer management

Search/list/detail as specified in the brief. Explicitly **not** implemented, by design: viewing a customer's password (impossible — Supabase never exposes it), impersonation (out of scope until a specifically designed, logged, approved workflow exists — tracked in TODO.md as a Phase 3+ item, not built speculatively).

## Raw document access (controlled support access)

Architecture only in Phase 1, disabled by default: `admin_support_access_requests` table (role, customer id, reason, requested/expires timestamps) is designed in DATABASE.md but the actual "open this customer's document" UI action is not wired up in Phase 1 — there is nothing to disable-by-default because it doesn't exist yet. This avoids building a security-sensitive feature ahead of the review it needs (see SECURITY.md).

## Subscription overrides

No UI button sets a paid entitlement directly. A `super_admin` override, when built (Phase 2+), must require a typed reason and writes an `audit_events` row referencing the specific subscription id — this is a stated design constraint, not yet implemented since Phase 1 has no paid entitlements flowing through RevenueCat to override.

## System operations (Phase 1 scope)

Health overview reads live counts from Postgres (customers, properties, documents) where data exists, and shows explicit "not yet connected" states (not fabricated numbers) for RevenueCat webhook status, OCR provider status, and notification service status until those integrations exist in later phases. Never displays secrets; environment values shown (e.g. "Supabase project: ✅ connected") never include the key itself.
