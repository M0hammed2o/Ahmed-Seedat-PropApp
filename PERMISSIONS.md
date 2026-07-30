# Permissions

Two independent role systems, never conflated (`ARCHITECTURE.md` — "Why one web app, not two"):

1. **Platform roles** (`platform_admin_users.role`) — PropertyVault's own operating staff, Super Admin portal only.
2. **Organization roles** (`organization_members.role`) — a client org's own staff, scoped to that org only.

Plus two non-staff relationships that carry their own implicit, narrow permission set: **owner** (`owners`, view-only into their own statements/properties) and **tenant** (`tenants`, view/act only on their own lease).

A user can simultaneously hold a platform role, membership in multiple orgs (each with a different org role), an owner record, and a tenant record — these never merge into one permission set; each is checked independently for the resource being accessed.

## 1. Platform roles

| Role               | Scope                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `super_admin`      | Full Super Admin portal: all client orgs, billing/plan configuration, support-mode access, platform-staff management |
| `support_admin`    | Client org read access + support-mode entry (audited); cannot change billing/plans                                   |
| `operations_admin` | Platform health/usage monitoring; cannot enter support mode or view client business data                             |
| `read_only_admin`  | Read-only across the Super Admin dashboard; no writes anywhere                                                       |

Enforced by `is_platform_admin(min_role)` (target name; the live function is still `is_admin()` until the Milestone 13 rename — `DATABASE.md` §1's naming note, `DECISIONS.md` 2026-07-30), `security definer`, checked in every Super Admin route handler — never via client-supplied role claims (`ARCHITECTURE.md`).

## 2. Organization roles

Evidenced verbatim from the reference product (IMG_8056): "Managers run everything · agents handle day-to-day operations · accountants see money · viewers are read-only."

| Role         |                         Properties/Units/Leases/Tenants                         | Applications | Maintenance | Accounting (view) | Accounting (post) | Organisation settings |                 Team management                  |
| ------------ | :-----------------------------------------------------------------------------: | :----------: | :---------: | :---------------: | :---------------: | :-------------------: | :----------------------------------------------: |
| `principal`  |                                      Full                                       |     Full     |    Full     |       Full        |       Full        |         Full          |                       Full                       |
| `manager`    |                                      Full                                       |     Full     |    Full     |       Full        |       Full        |         Full          | Invite/remove `agent`/`accountant`/`viewer` only |
| `agent`      | Full (create/edit/archive day-to-day records; org-level config is out of scope) |     Full     |    Full     |     View only     |         —         |       View only       |                        —                         |
| `accountant` |                                    View only                                    |  View only   |  View only  |       Full        |       Full        |       View only       |                        —                         |
| `viewer`     |                                    View only                                    |  View only   |  View only  |     View only     |         —         |       View only       |                        —                         |

**No role has hard-delete on business records** (architecture-review clarification, 2026-07-30): every `DELETE`-shaped API call archives, never destroys (`API_SPEC.md` §3 — "DELETE = archive, never hard-delete"), consistently across properties/units/leases/tenants/etc. "Full" in the table above therefore includes archive, not a hard-delete this system doesn't offer to any role. The only true destructive operations in the system are the accounting reversing-entry path (`ACCOUNTING.md` §1 — which creates a new entry, never deletes the original) and Super Admin's org-level account-recovery/archive actions (`SUPER_ADMIN.md` §4), neither of which is a client-org-role permission at all.

Exactly one `principal` per org minimum (the account creator; org creation is atomic with a `principal` membership row — an org can never exist with zero `principal`). `manager` cannot remove or demote the last `principal`. Role checks resolve through `has_org_role(org_id, min_role)`, a `security definer` function ordering roles `viewer < accountant/agent < manager < principal` for "at least X" checks, mirroring the ranked `is_admin()` pattern already in the codebase.

## 3. Owner permissions (not org staff)

An `owners` record with `user_id` set can log in (web or native) and see, for properties they're linked to via `property_owners`:

- Their own Owner Statements (view, never edit — statements are system-generated per `ACCOUNTING.md`).
- Read-only property/unit/lease summaries for properties they own.
- Maintenance tickets requiring their approval (evidenced: "Pending Approval" kanban stage) — approve/reject only, not general maintenance-board access.
- Never: other owners' statements, org staff/team data, org-wide accounting (Trial Balance, Tax Pack), tenant PII beyond what's needed for their own property's occupancy status.

## 4. Tenant permissions

A `tenants` record with `user_id` set can log in and see/do only what's scoped to their own `lease_id`/`tenant_id`:

- Their own lease, payment balance/history, documents, maintenance tickets (submit + view own).
- Announcements targeted at their property.
- Never: other tenants, other properties, owner financials, staff data, portfolio/accounting data — enforced by RLS predicates keyed on `tenants.user_id = auth.uid()` joined through `lease_tenants`/`rent_schedules`/`maintenance_tickets.tenant_id`, matching the master prompt's explicit tenant-isolation requirement (§10.2) and the hard rule that tenant-isolation protections are never waived.

## 5. Permission enforcement layers

1. **RLS** (`DATABASE.md` §12) — the ground truth; every table's policy is written assuming the API layer could be buggy or bypassed.
2. **API-layer checks** (`API_SPEC.md`) — fail fast with a clear 403 before hitting the database, and enforce role checks RLS can't express cleanly (e.g. "only `accountant`+ can trigger the posting service").
3. **UI-layer hiding** — cosmetic only (hide buttons a role can't use); never the only enforcement, per the master prompt's explicit warning against permission checks that exist "only in the UI."

## 6. Support-mode access (Super Admin → client org)

Not a role — a time-boxed, audited session (`support_access_sessions`, `DATABASE.md` §1). While active, the platform admin's requests are scoped to the target org as if they were a `viewer` by default (read access to diagnose issues), with any write action requiring an explicit, separately-logged escalation within the same session — never a blanket impersonation that silently grants `principal`-equivalent access. Full design in `SUPER_ADMIN.md`.
