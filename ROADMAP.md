# Roadmap

## Version 1 objective

Deliver a complete, production-ready SaaS that a South African landlord or property-management company can use every day. V1 targets South Africa specifically (POPIA, RHA, SARS, CIPC, Property Practitioners Act) — see `RETAIN_REFACTOR_REBUILD_MATRIX.md` for the module-by-module retain/rebuild evidence behind every item below, and `MOBILE_ARCHITECTURE_DECISION.md` for the native iOS/Android strategy.

## Version 1 build order (restated and confirmed with Mohammed, 2026-07-30 — supersedes the 2026-07-29 ordering below the line)

Multi-tenant schema → Authentication → Roles and permissions → Organizations → Properties → Units → Owners → Tenants → Applications → Leases → Documents → OCR → Maintenance → Accounting (incl. Trust Accounting, Trial Balance, Owner Statements, Tax Pack, Payments) → Notifications → Email → WhatsApp → AI → Super Admin → Responsive Web → Native iOS → Native Android → Automated testing → Deployment → Engineering requirements.

Full milestone-level breakdown (M0-M25), exit criteria, and current status per milestone: `TASKS.md`. Task workflows (maintenance tasks, inspection tasks, lease-renewal reminders, document requests, payment follow-ups, compliance reminders) are implemented inline within the modules above — **no standalone Tasks module in V1.** Simplified Portfolio Map (property list on a map with name/address/occupancy/maintenance indicator and quick navigation; no GIS layers, heat maps, or map analytics) ships as part of Responsive Web.

<details>
<summary>2026-07-29 ordering (superseded, kept for history)</summary>

Multi-tenancy → Authentication and security → Properties and Units → Owners → Tenants → Applications and Screening → Leases → Documents and OCR → Accounting and Trust Accounting → Trial Balance → Owner Statements → Tax Pack → Payments → Maintenance → Tenant Portal → Owner Portal → Super Admin Portal → WhatsApp and Email → Reporting → Simplified Portfolio Map. The main substantive change in the 2026-07-30 restatement: Maintenance now precedes Accounting (simplifies the deposit-release gate — `TASKS.md` M13 note), and native apps/Super Admin/communications channels are sequenced after the full backend rather than interleaved with it.

</details>

## Version 2+ (deferred, not dropped)

- Listings Studio, public listing pages, Enquiries/Lead pipeline
- Articles (CMS/blog)
- Sales & Auctions
- Virtual Tours
- Neighbourhood Insights / area-note snippets
- Automated/manual Valuations history
- Vendor self-service portal (V1 has staff/landlord capturing vendor bills on the vendor's behalf instead)
- Standalone Tasks & Reminders module, if inline task workflows prove insufficient
- Portfolio Map GIS layers, heat maps, map-based analytics
- **Automated tenant screening** (deferred 2026-08-01, product-scope correction — DECISIONS.md): external credit-bureau integrations (TPN/Experian/TransUnion or similar), automated screening scores, applicant ranking, AI applicant recommendations, automatic approve/decline, and applicant-messaging automation. The `application_screening_status`/`screening_consent_at` columns, the `screening` application status, and the mock-first `TenantScreeningProvider`/`MockTenantScreeningProvider` (`apps/admin/lib/providers/tenantScreening.ts`) already exist and are left dormant/intact, not deleted — a real V2 build would wire a production provider behind that same interface and re-surface the already-built `POST /api/v1/applications/:id/screen` endpoint in the UI, not start over.

## Sequencing rationale

The order above is dependency-driven, not arbitrary: multi-tenancy must exist before properties/owners/tenants can be scoped correctly; leases must exist before rent/applications/documents can reference them; the accounting engine and Trial Balance must be correct before Owner Statements or Tax Pack report numbers anyone can trust; native mobile apps need real APIs to build against, so they follow the backend domain model rather than leading it (see `MOBILE_ARCHITECTURE_DECISION.md` §8). WhatsApp and Email are functionally independent of the rest of the build but gated on external provider accounts, so they're sequenced late to avoid blocking on a dependency outside this session's control.
