# Utilities — Production Readiness Checklist

**Date:** 2026-10-11 (end of Phase 3). `[x]` = done and verified locally on a disposable stack (evidence named).
`[ ]` = not done, with its owner. Nothing here was verified on staging or production: neither was touched.
Test numbers are in `UTILITIES_PHASE3_COMPLETION_REPORT.md` §3.

## Security and isolation
- [x] Tenant isolation:
  - another organisation sees no meters, readings, tariffs, charges, statements or packs (pgTAP);
  - a tenant sees only their own approved statements and charges.
- [x] Tenants cannot create or change tariffs, arrangements, charges or credits (pgTAP `utilities_phase3` #1–8).
- [x] Property-level access:
  - selected-mode staff need a grant;
  - portal owners can read but not configure;
  - the org and property must match (SEC-01, migration 179).
- [x] Device webhooks:
  - hashed per-connection tokens, rotation with a grace period, rate limits;
  - ingestion log and audit trail of configuration changes.
- [x] Vendor credentials encrypted (AES-GCM); fail closed without the key.
- [x] SSRF: https only; private and reserved addresses refused; the **connection pinned to the validated address**
  (TD-66); no redirects.
- [x] Cron secret compared in constant time (TD-68).
- [x] Service-only database functions are not executable by `anon` or `authenticated` (pgTAP).
- [x] e2e and CI never read live provider keys (TD-59).
- [ ] Production secrets set in the secret store (owner, plan §3).

## Money
- [x] Charges only from explicit arrangements. Landlord-paid, included-in-rent, tenant-direct and monitoring-only
  properties need no tariff.
- [x] No double billing:
  - live unique key plus a database overlap exclusion;
  - concurrent runs tested;
  - re-runs create nothing.
- [x] Drafts only:
  - approval is required;
  - disputed charges cannot be approved;
  - invoices are created as **draft** and never issued by the module;
  - voiding an invoice releases its charges.
- [x] Credits and adjustments:
  - credits are capped at the charged amount;
  - VAT is rescaled;
  - voiding a charge returns its credit.
- [x] Estimates and true-up: once per estimate, race-safe, hand-checked amounts.
- [x] Every amount in the pilot and audit scenarios was independently hand-computed with fictional tariffs.
- [ ] VAT/GL split for VAT-registered landlords (TD-61): flagged; awaits the accounting decision (owner/accountant).
- [ ] Real tariffs entered by the landlord with a source reference (landlord/manager).

## Hybrid model
- [x] Solar, battery, generator, grid import, pump and source registers and main meters are never billed (asserted per
  charge).
- [x] Tank levels and tanker logs are never billed.
- [x] The site balance (supply vs measured) is labelled measured, derived, logged or missing.
- [x] Municipal-only, private-only and hybrid properties are covered by the pilot tests.

## Data and performance
- [x] Telemetry is inserted in batches, and replays are idempotent.
- [x] Retention exists (opt-in, ≥ 400 days); it is off for the pilot.
- [ ] Retention timed at production volume (engineering on staging, G7).
- [x] Daily-jobs timeout root cause fixed (candidate orgs, migration 180); measured 7.7–20 s on a 2,740-org copy.
- [x] Android monthly readings feed the Utilities dashboard, municipal packs and billing (migration 181 mirror).

## Deployment
- [x] Migrations 175–181 rehearsed on representative data. Fingerprints are identical and the 120/120 legacy readings
  were mirrored.
- [x] Rollback script rehearsed: schema identical to 174 after rollback; refuses while real data exists.
- [x] Environment variables documented (`apps/admin/.env.example`, plan §3). Sending flags and retention default off.
- [ ] Backup plus PITR marker taken and restore verified (owner, before staging and production).
- [ ] Staging deployment and 11 smoke tests (owner approval → engineering).
- [ ] Pilot organisation restricted (plan §5; owner).
- [ ] Production migration (owner, separately).

## Operations
- [x] Manual fallback for every device failure (`UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §5.5).
- [ ] Scheduler alerts and the weekly checks (plan §7) wired in the hosting provider (engineering, after staging).
- [ ] Hardware: none purchased or tested. Bill of materials and decisions are in checklist §5 (owner).

## Legal and process (not engineering)
- [ ] Recharge legality per site (NERSA electricity resale guidelines, municipal by-laws, Water Services Act).
  Proplyst makes no legal claim; review flags remind staff.
- [ ] Lease clauses for shared splits and fixed amounts.
- [ ] Two billing cycles reviewed by hand before the first approval.
