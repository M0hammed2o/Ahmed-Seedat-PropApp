# PropertyVault Product Specification

**This is the single source of truth for what PropertyVault is.** As the platform grows, this document is where a module, feature, workflow, role, permission, screen, AI capability, notification, or integration gets checked against before it's built — and where a completed one gets recorded. It is deliberately an **index that cross-references the detailed design documents**, not a duplicate of their content: the detailed behavior for any row below lives in the linked document, and that document is authoritative if this index and it ever disagree (fix the disagreement, don't pick a winner and move on — see "Keeping this document honest" at the end).

Every module below is evidenced from `PROPVIEW_SCREENSHOT_AUDIT.md` (the reference product) unless marked otherwise, decided module-by-module in `RETAIN_REFACTOR_REBUILD_MATRIX.md`, and confirmed in scope by Mohammed (`DECISIONS.md` 2026-07-29/30).

---

## 1. Product vision

A multi-tenant property-management SaaS for South African landlords, property-owning companies/trusts, and property-management agencies — and their tenants. One platform-owned account can manage many properties across many owners, with staff roles, real double-entry accounting (including regulated trust/deposit handling), and a shared-number WhatsApp channel alongside comprehensive email, reached through a responsive web app (staff/back-office) and native iOS/Android apps (owner/landlord + tenant). Supersedes "PropVault" (a narrower single-owner document vault) as of 2026-07-29 — see `DECISIONS.md`.

---

## 2. User roles (complete enumeration)

| Role                                                                  | Type                                    | Scope                                                                                                                              | Defined in                               |
| --------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `super_admin`, `support_admin`, `operations_admin`, `read_only_admin` | Platform role                           | PropertyVault's own operating staff; Super Admin portal only                                                                       | `PERMISSIONS.md` §1, `SUPER_ADMIN.md` §1 |
| `principal`, `manager`, `agent`, `accountant`, `viewer`               | Organization role                       | A client org's own staff, scoped to that org                                                                                       | `PERMISSIONS.md` §2                      |
| Owner                                                                 | Relationship, not a role                | Payee/legal-entity record (`owners`), optional portal login; view own statements/properties, approve maintenance on own properties | `PERMISSIONS.md` §3                      |
| Tenant                                                                | Relationship, not a role                | Occupant record (`tenants`), optional portal login; own lease/payments/documents/maintenance only                                  | `PERMISSIONS.md` §4                      |
| Applicant/prospect                                                    | Unauthenticated → `applications` record | No login until approved (becomes a Tenant)                                                                                         | `DATABASE.md` §4                         |

A single human can simultaneously hold a platform role, membership in multiple orgs, an owner record, and a tenant record — these never merge into one permission set (`PERMISSIONS.md` intro). Portal switching (evidenced: `PROPVIEW_SCREENSHOT_AUDIT.md` IMG_7969/7983/8073) is a UI convenience over these independently-checked relationships, not a fourth role system.

---

## 3. Modules

Each row: what it is, which portal(s) it appears in, V1 or V2, and where the full design lives. "Portal" values: **Web** (`apps/web`, staff/back-office), **Super Admin** (`apps/web`, separate route group), **iOS/Android** (native, owner+tenant role-switched app per `MOBILE_ARCHITECTURE_DECISION.md`).

### 3.1 Identity & organization

| Module                                                                                                                                   | Portals           | V1? | Design doc                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --- | ------------------------------------------------------------------------------------------------------ |
| Authentication (sign up/in/out, password reset, email verify)                                                                            | Web, iOS, Android | V1  | `AUTHENTICATION.md`, `PERMISSIONS.md`, `SECURITY.md` §Auth, `ARCHITECTURE.md` §Retained from PropVault |
| Web account creation (email/password, Google OAuth, Apple OAuth) — **added 2026-08-03, PRODUCT DECISION 1**                              | Web               | V1  | `AUTHENTICATION.md`, `DECISIONS.md` 2026-08-03                                                         |
| Tenant activation (secure invitation/activation-code linking to an existing `tenants` record) — **added 2026-08-03, PRODUCT DECISION 2** | Web               | V1  | `AUTHENTICATION.md` §5, `DATABASE.md` §4 (`tenant_invitations`), `DECISIONS.md` 2026-08-03             |
| Organizations (compliance profile: CIPC/VAT/SARS/POPIA/FFC)                                                                              | Web               | V1  | `DATABASE.md` §1, §Organisation                                                                        |
| Team Seats / staff invites & roles                                                                                                       | Web               | V1  | `DATABASE.md` §2, `PERMISSIONS.md` §2                                                                  |
| Workspaces (multi-org membership switcher)                                                                                               | Web, iOS, Android | V1  | `DATABASE.md` §2, evidenced IMG_8053                                                                   |

### 3.2 Portfolio

| Module                                                                   | Portals                         | V1?                                    | Design doc                                                 |
| ------------------------------------------------------------------------ | ------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Properties                                                               | Web, iOS (view), Android (view) | V1                                     | `DATABASE.md` §3, `API_SPEC.md` §3                         |
| Units                                                                    | Web, iOS (view), Android (view) | V1                                     | `DATABASE.md` §3                                           |
| Owners (records, Individual/Company/Trust, multi-owner %)                | Web                             | V1                                     | `DATABASE.md` §3                                           |
| Simplified Portfolio Map (property list on a map; no GIS/heatmap layers) | Web, iOS, Android               | V1 (simplified)                        | `DATABASE.md` §3, `ROADMAP.md`, confirmed scope 2026-07-29 |
| Valuations (manual history)                                              | Web                             | **V2**                                 | `RETAIN_REFACTOR_REBUILD_MATRIX.md`                        |
| Listings Studio, public listings, Enquiries/Leads                        | Web                             | **V2**                                 | `RETAIN_REFACTOR_REBUILD_MATRIX.md`                        |
| Articles (CMS), Sales & Auctions, Virtual Tours                          | Web                             | **V2** (stays on roadmap, not dropped) | `RETAIN_REFACTOR_REBUILD_MATRIX.md`, `ROADMAP.md`          |
| Neighbourhood Insights (area notes)                                      | Web                             | **V2**                                 | `RETAIN_REFACTOR_REBUILD_MATRIX.md`                        |

### 3.3 Leasing

| Module                                         | Portals                         | V1? | Design doc                              |
| ---------------------------------------------- | ------------------------------- | --- | --------------------------------------- |
| Tenants (directory)                            | Web                             | V1  | `DATABASE.md` §4                        |
| Applications & Screening (POPIA-consent-gated) | Web                             | V1  | `DATABASE.md` §4, `API_SPEC.md` §4      |
| Leases (create / PDF-parse / bulk import)      | Web, iOS (view), Android (view) | V1  | `DATABASE.md` §4                        |
| Rent schedules                                 | Web, iOS (view), Android (view) | V1  | `DATABASE.md` §4, `ACCOUNTING.md` §3    |
| My Lease (tenant, read-only)                   | iOS, Android                    | V1  | `PERMISSIONS.md` §4, evidenced IMG_7977 |

### 3.4 Operations

| Module                                                                                            | Portals                        | V1?                                                                                                                                  | Design doc                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Maintenance Board + tenant submission (full flow both directions)                                 | Web, iOS, Android              | V1 — explicit native-app priority                                                                                                    | `DATABASE.md` §5, `MOBILE_ARCHITECTURE_DECISION.md` §6 |
| Inspections (move-in/move-out, dual sign-off or logged refusal)                                   | Web                            | V1                                                                                                                                   | `DATABASE.md` §5                                       |
| Vendors (directory, external/unregistered supported)                                              | Web, iOS (view, approved-only) | V1                                                                                                                                   | `DATABASE.md` §5                                       |
| Vendor Bills (staff-entered on vendor's behalf; **no vendor portal in V1**, confirmed 2026-07-29) | Web                            | V1                                                                                                                                   | `DATABASE.md` §5, `RETAIN_REFACTOR_REBUILD_MATRIX.md`  |
| Announcements (read-receipt/acknowledgement tracking)                                             | Web, iOS, Android              | V1                                                                                                                                   | `DATABASE.md` §7                                       |
| Tasks & Reminders                                                                                 | —                              | **No standalone module** — implemented inline within Maintenance/Inspections/Lease-renewal/Documents/Payments (confirmed 2026-07-29) | `DECISIONS.md`, `ROADMAP.md`                           |

### 3.5 Accounting (in-house, double-entry — confirmed 2026-07-29)

| Module                                                                                                    | Portals                                 | V1?                                                | Design doc                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Chart of Accounts, Journal Entries (immutable, reversing-entries-only)                                    | Web                                     | V1                                                 | `ACCOUNTING.md` §1-3, `DATABASE.md` §9        |
| Rent Due → Invoices pipeline                                                                              | Web, iOS (view), Android (view)         | V1                                                 | `ACCOUNTING.md` §3                            |
| Expenses (manual + AI-parsed)                                                                             | Web                                     | V1                                                 | `ACCOUNTING.md` §3, `DATABASE.md` §9          |
| Trust & Deposits (RHA-equivalent interest, inspection-gated release)                                      | Web                                     | V1                                                 | `ACCOUNTING.md` §4                            |
| Match Bank Payments (bank reconciliation)                                                                 | Web                                     | V1                                                 | `ACCOUNTING.md` §8                            |
| Owner Statements (generated, snapshot-not-live)                                                           | Web, iOS (view own), Android (view own) | V1                                                 | `ACCOUNTING.md` §5                            |
| Trial Balance (live, Business/Trust/Deposits)                                                             | Web                                     | V1                                                 | `ACCOUNTING.md` §6                            |
| Tax Pack (SARS, SA tax-year)                                                                              | Web                                     | V1 (confirmed — reversed from initial V2 proposal) | `ACCOUNTING.md` §7, `DECISIONS.md` 2026-07-29 |
| Known accounting edge cases (partial payments, ownership rounding, mid-lease amendments, shared expenses) | —                                       | V1 answers documented                              | `ACCOUNTING.md` §9                            |

### 3.6 Documents & AI

| Module                                                             | Portals                                       | V1? | Design doc                                   |
| ------------------------------------------------------------------ | --------------------------------------------- | --- | -------------------------------------------- |
| Documents Vault (AI-parsed uploads)                                | Web, iOS, Android                             | V1  | `DATABASE.md` §6, `DOCUMENT_INTELLIGENCE.md` |
| OCR extraction + human review                                      | Web, iOS, Android                             | V1  | `DATABASE.md` §6                             |
| Conversational AI Assistant (staged-changes, confirm-before-apply) | Web (confirmed evidenced); mobile surface TBD | V1  | `AI_ARCHITECTURE.md` §1                      |
| Portfolio Intelligence (rules-based, non-LLM insights)             | Web                                           | V1  | `AI_ARCHITECTURE.md` §2                      |

### 3.7 Communication

| Module                                                       | Portals                       | V1?                                                     | Design doc       |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------- | ---------------- |
| Notifications (in-app)                                       | Web, iOS, Android             | V1                                                      | `DATABASE.md` §7 |
| Email (comprehensive channel)                                | Web-triggered, all recipients | V1 (external provider account is an unresolved blocker) | `EMAIL.md`       |
| WhatsApp (single shared platform number, fixed trigger list) | Web-triggered, all recipients | V1 (external provider account is an unresolved blocker) | `WHATSAPP.md`    |

### 3.8 Platform administration

| Module                                                           | Portals          | V1? | Design doc                               |
| ---------------------------------------------------------------- | ---------------- | --- | ---------------------------------------- |
| Super Admin dashboard (client directory, MRR/ARR, usage)         | Super Admin      | V1  | `SUPER_ADMIN.md` §2-3                    |
| Billing/plan configuration (configurable plans, not hardcoded)   | Super Admin      | V1  | `SUPER_ADMIN.md` §5, `DATABASE.md` §1    |
| Support mode (audited, time-boxed, banner-visible impersonation) | Super Admin      | V1  | `SUPER_ADMIN.md` §6, `PERMISSIONS.md` §6 |
| Audit History                                                    | Web, Super Admin | V1  | `DATABASE.md` §10                        |

---

## 4. Notification catalog

Every notification type in the system, and which channel(s) it's eligible for. "WhatsApp" column values are the exact `WhatsAppNotificationType` enum values (`WHATSAPP.md` §2) — WhatsApp is the _narrow_ channel; Email/in-app are comprehensive by default (`EMAIL.md` §1).

| Event                                                                   | Email | In-app |                          WhatsApp                           | Category      |
| ----------------------------------------------------------------------- | :---: | :----: | :---------------------------------------------------------: | ------------- |
| Rent materially overdue                                                 |   ✓   |   ✓    |                   `rent_overdue_material`                   | rent          |
| Payment accepted/rejected                                               |   ✓   |   ✓    |            `payment_accepted`/`payment_rejected`            | rent          |
| Lease expiring soon (tenant/owner)                                      |   ✓   |   ✓    |                `lease_expiring_soon`(_owner)                | lease         |
| Urgent property announcement                                            |   ✓   |   ✓    |               `urgent_property_announcement`                | announcements |
| Important inspection reminder                                           |   ✓   |   ✓    |               `inspection_reminder_important`               | inspections   |
| Critical maintenance update / urgent approval                           |   ✓   |   ✓    | `maintenance_update_critical`/`maintenance_approval_urgent` | maintenance   |
| Missing required document / ID expiring                                 |   ✓   |   ✓    |     `document_missing_required`/`id_document_expiring`      | lease         |
| Payment awaiting confirmation / discrepancy (owner)                     |   ✓   |   ✓    |    `payment_awaiting_confirmation`/`payment_discrepancy`    | rent          |
| Significant rent overdue (owner)                                        |   ✓   |   ✓    |                 `rent_overdue_significant`                  | rent          |
| Account security event                                                  |   ✓   |   ✓    |       `account_security_event` — **not suppressible**       | security      |
| Owner statement available                                               |   ✓   |   ✓    |                 `owner_statement_available`                 | rent          |
| Routine leasing/accounting/team/billing events (§3.1-3.5 of `EMAIL.md`) |   ✓   |   ✓    |              — (email/in-app only, by design)               | varies        |

Full per-category opt-out mechanics: `DATABASE.md` §7 (`notification_preferences`), full mapping table: `WHATSAPP.md` §2.

---

## 5. AI capabilities catalog

| Capability               | What it does                                                                                                         | LLM?                                             | Design doc                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversational Assistant | Chat, answers portfolio questions from org-scoped context, proposes staged writes requiring explicit confirm         | Yes (vendor TBD)                                 | `AI_ARCHITECTURE.md` §1                                                                                                                     |
| Portfolio Intelligence   | Rules-based insights (overdue rent, expiring leases, open maintenance, unpaid invoices) with traceable `data_source` | **No** — explicit non-LLM guarantee              | `AI_ARCHITECTURE.md` §2                                                                                                                     |
| Document OCR/extraction  | Parses uploaded leases/invoices/receipts into structured, human-reviewed fields                                      | Vendor-specific (TBD), not necessarily an LLM    | `DOCUMENT_INTELLIGENCE.md`                                                                                                                  |
| AI-assisted unit setup   | Natural-language description → generated unit records                                                                | Evidenced feature, not yet architected in detail | `PROPVIEW_SCREENSHOT_AUDIT.md` (IMG_7998) — **flagged: needs its own design pass before V1 build, not yet covered by `AI_ARCHITECTURE.md`** |

Both LLM-touching capabilities (Assistant, and whichever OCR vendor turns out to use a model) are metered via `usage_events`/`usage_snapshots` (`DATABASE.md` §7) and capped per `plans.feature_limits` (`AI_ARCHITECTURE.md` §4).

---

## 6. Integrations catalog

| Integration                                     | Status                                                    | Provider selected?                                          | Design doc                                            |
| ----------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Supabase (Postgres/Auth/Storage/Edge Functions) | Core infrastructure, in use                               | Yes                                                         | `ARCHITECTURE.md`                                     |
| Email provider                                  | **External-service blocker**                              | No — vendor-agnostic interface built first                  | `EMAIL.md` §2                                         |
| WhatsApp Business API / BSP                     | **External-service blocker**                              | No — vendor-agnostic interface built first                  | `WHATSAPP.md` §5                                      |
| OCR/document-intelligence vendor                | Deferred decision                                         | No                                                          | `DOCUMENT_INTELLIGENCE.md`                            |
| LLM provider (Conversational Assistant)         | Deferred decision                                         | No                                                          | `AI_ARCHITECTURE.md` §3                               |
| RevenueCat (subscriptions, native apps)         | Pattern retained from PropVault, real product IDs pending | Partial (RevenueCat chosen; store products not yet created) | `SUBSCRIPTIONS.md`, `MOBILE_ARCHITECTURE_DECISION.md` |
| Error monitoring                                | Interface retained, real backend (e.g. Sentry) not wired  | No                                                          | `DEPLOYMENT.md` §8                                    |
| Hosting (web)                                   | Not provisioned                                           | No (Vercel-or-equivalent recommended)                       | `DEPLOYMENT.md` §2                                    |
| Apple/Google developer accounts                 | Not provisioned                                           | —                                                           | `DEPLOYMENT.md` §4-5                                  |

Every "External-service blocker" row is something this session cannot resolve — provisioning requires Mohammed's action (account creation, payment, business verification). See each linked document's "Unresolved"/"Open items" section for exactly what's needed.

---

## 7. Screens inventory (by portal)

Full per-screen field/action/workflow detail lives in `PROPVIEW_SCREENSHOT_AUDIT.md` §1 (full sitemap) — this section is a pointer, not a duplicate, since the screenshot audit's sitemap is already the authoritative, evidence-cited screen list.

- **Web (Landlord Console)**: `PROPVIEW_SCREENSHOT_AUDIT.md` §1 "Landlord Console" tree — Overview/Portfolio/Leasing/Operations/Finance/Workspace, minus the V2-deferred modules listed in §3 above.
- **Web (Tenant-facing, if any stays web)**: not applicable — tenant surface is native-only per `MOBILE_ARCHITECTURE_DECISION.md` §6, web is staff/back-office only.
- **Web (Super Admin)**: `SUPER_ADMIN.md` §2-6 (dashboard, client directory, actions, billing config, support mode) — no PropView screenshot equivalent exists (Super Admin isn't part of the client-facing reference product).
- **Native iOS/Android (Owner/Landlord mode)**: `MOBILE_ARCHITECTURE_DECISION.md` §6 "in the native apps" list.
- **Native iOS/Android (Tenant mode)**: `PROPVIEW_SCREENSHOT_AUDIT.md` §1 "Tenant Portal" tree (Home/My Lease/Payments/Documents/Find a home/Maintenance/Vendors/Meter Reading/Announcements/Notifications/Profile & Notices), scoped per `PERMISSIONS.md` §4.

---

## 8. Roadmap summary

Full milestone breakdown: `TASKS.md`. Full V1/V2 scope list: `ROADMAP.md`. One-line summary: V1 = the modules marked "V1" throughout §3 above, sequenced multi-tenancy → auth/permissions → organizations → properties/units/owners → tenants/applications/leases → documents/OCR → accounting → notifications/email/WhatsApp → AI → Super Admin → responsive web → native iOS → native Android → automated testing → deployment (per Mohammed's restated Phase 7 order, 2026-07-30). V2 = everything marked "V2" in §3.

---

## 9. Keeping this document honest

This index will drift from the detailed docs unless updated in the same change that changes them. Rule: **any edit to a module's scope, permissions, schema, or screens updates this document's corresponding row/section in the same pass** — the same discipline `WORKLOG.md`/`DECISIONS.md`/`TASKS.md` already follow for implementation changes, applied here to product scope. If this document and a linked detailed doc ever disagree, that's a bug in one of them — fix the disagreement (usually by correcting whichever one wasn't updated), never silently prefer one without reconciling the other.
