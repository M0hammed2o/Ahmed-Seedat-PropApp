# Utilities — Production Readiness Audit

**Date:** 2026-10-10/11. **Scope:** Smart Utilities and Hybrid Water & Electricity (migrations 175–180, web, API,
jobs, Android tenant statements). **Method:** read the continuity documents and code; three independent read-only audits
(security, financial correctness, integrations/municipal/jobs); verify every finding against code and executable tests;
fix; re-run every suite on a fresh disposable stack; rehearse migrations on a copy of real local data.

## Verdict by level

| Level | Status | Basis |
| --- | --- | --- |
| **Software readiness** | **Ready** | All confirmed critical/high findings fixed and tested; full suites pass (pgTAP 1 625/1 625, web 1 574/1 574, Android 359/359, e2e 3/3, build OK) |
| **Staging readiness** | **Ready, awaiting your approval** | Migration rehearsal on representative data succeeded with business data intact; staging plan, env checklist, smoke tests and rollback limits documented (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md`) |
| **Customer pilot readiness (manual / existing meters)** | **Conditional** | Needs staging smoke tests, the site's recharge legality decision, VAT decision, pilot org switch (`UTILITIES_RELEASE_BLOCKERS.md` P1–P5) |
| **Hardware pilot readiness** | **Not yet** | No device has reported through any adapter; all hardware paths are "implemented from documentation, untested" (H1–H3) |
| **Production readiness (general availability)** | **Conditional — not declared** | Depends on a successful pilot, hardware evidence for device billing, owner decisions on flags, TD-66 before poll integrations, TD-53 before scale (G1–G6) |

## What the audit found (all verified, all fixed unless stated)

**Security** (`UTILITIES_SECURITY_FINDINGS.md`): cross-org write path through the utility gates (SEC-01/02), SSRF by
DNS (SEC-03, residual rebinding window TD-66), cross-property evidence (SEC-04), self-verification (SEC-05); municipal
sends that could differ from what was approved, reach unapproved recipients, ignore a switched-off flag or be sent twice
(MUN-A–D, **MUN-A was High**); ThingsBoard data loss (INT-01); overstated catalogue label (CAT-01).

**Financial** (`UTILITIES_FINANCIAL_VALIDATION.md`): double billing on mid-period arrangement change (**Critical**),
on terminated leases without end date, and on meter-replacement re-runs (**High**); TOU + allowance billing all usage
(**High**); stale VAT after credits/adjustments (**High**); voided invoices stranding charges (**High**); mid-period
tariff changes ignored; two meters per unit double fixed charge; check meters billed; shared groups on non-consumption
meters; invalid month-end date; concurrent double invoicing. Validated against hand-computed results across a six-flat
solar + borehole property and 13 further scenarios using fictional tariffs.

**Operations:** the daily-jobs timeout came from Portfolio Intelligence making 9+ HTTP round trips per organisation
(even empty ones), a 500-org cap that always skipped the same organisations, 1 000-row truncated reads, and an
oversized request that made one organisation fail every run. Fixed at the root (migration 180, paging, chunking);
the timeout was not raised. Utility alert queries had the same truncation and swallowed errors (fixed).
A per-organisation module switch (`organizations.utilities_enabled`) was added.

## Safety statements (verified in code and tests)
- No invoice is issued by the utilities module — charges go onto **draft** invoices only; tests assert draft status.
- Solar generation, battery, grid export/import, generator, borehole pump and source-supply meters are never billed —
  only consumption **submeters** of a unit (or a shared **consumption** meter) under an explicit arrangement.
- No municipal e-mail is sent without an authorised recipient and an approved snapshot; automatic sending also needs
  the platform flag (off) and a current template approval; retries send the identical approved files.
- Tenants see only approved/sent statements and invoiced charges of their own lease (RLS).
- No production action was taken; nothing was pushed, deployed, sent or purchased.

## Commits (this audit)
`04d8fd4` security hardening · `a8c2874` billing correctness · `97a85de` municipal send safety · `ea625e6` jobs
performance/correctness · `5f4bfd1` per-organisation switch + allocation tests + reports · `eb28de8` readiness browser
walk-through + "not monitored" UX · plus the documentation commit that adds this file.

## Deliverables
`UTILITIES_SECURITY_FINDINGS.md`, `UTILITIES_FINANCIAL_VALIDATION.md`, `UTILITIES_STAGING_DEPLOYMENT_PLAN.md`,
`UTILITIES_HARDWARE_PILOT_CHECKLIST.md`, `UTILITIES_FINAL_TEST_RESULTS.md`, `UTILITIES_RELEASE_BLOCKERS.md`, this file.
