# Utilities — Pilot Test Plan

**Pilot shape:** one organisation, one South African apartment property; municipal electricity + solar, municipal water + borehole.
**Mode:** monitoring-only first. Draft billing only after compliance items C1–C9 are confirmed
(`UTILITIES_COMPLIANCE_CHECKLIST.md`). **Date:** 2026-10-12.

## 0. Preconditions (owner approvals)

1. Staging deployed (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §10) and its 11 smoke tests pass.
2. Production deployment of 175–183 approved separately (PITR marker + dump first).
3. Pilot organisation switched on with one statement. A brand-new organisation is checked and shows as off.
4. Sending flags stay unset for the whole pilot: `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` and
   `SMART_UTILITY_TENANT_STATEMENTS_ENABLED`.

## 1. Rehearse on synthetic data first (disposable or staging-with-approval only)

- `npx vitest run -c vitest.demo.config.ts scripts/utilities-pilot-demo` builds the fictional seven-flat property.
  Walk through it as manager, owner and two tenants (`UTILITIES_PILOT_DEMO.md`).
- Automated scenario suites (all pass locally): pilot, estimates, reconciliation, financialAudit, hybrid,
  ingestBackfill, tenant dispute, switch.

## 2. Pilot timeline (manual readings; no hardware needed)

| Week | Activity | Pass criterion |
| --- | --- | --- |
| 1 | Configure sources (municipal grid, solar, municipal water, borehole), main meters, unit submeters, arrangements (all monitoring-only / landlord-paid) | supply map and meter list match the site walk-through |
| 1 | Baseline readings for every meter, each with a date-stamped photo | 100 % of meters have a reading and photo |
| 2–5 | Weekly readings; a second person verifies each one | ≥ 95 % verified within 2 days |
| 4 | Missing-reading drill: skip one meter for a week, then enter it | no negative or invented consumption; partial quality shown |
| 5 | Month-end: dashboard supply vs measured balance | ≥ 90 % of main-meter use explained, or the gap investigated and noted |
| 5 | Month-end figures checked by hand against photos | each figure within one register unit |
| 6–9 | Second month, same checks | repeat |
| 9 | Decision point: stay monitoring-only, or move to draft billing (only if C1–C9 are confirmed) | written owner decision |

## 3. If draft billing is approved (cycle 3 onwards)

1. Enter the **real** tariff with its source reference (landlord/manager only).
2. Set arrangements per unit, matching the signed lease clauses.
3. Calculate charges.
   - All drafts are checked by hand against photos.
   - No charge may cite a non-consumption meter.
4. Two consecutive cycles must match the hand check before the first approval.
5. Approve. Invoices are created as drafts; the landlord issues them through the normal invoice workflow.
6. Statements: approve the tenant statements. Tenants see them in the portal and Android. E-mail stays off.
7. Disputes: tenants may query a statement; staff resolve it before invoicing.

## 4. Stop conditions (pause the pilot)

- Any cross-organisation or cross-tenant visibility.
- Any charge on a solar, battery, generator, borehole, rainwater, tank or main meter.
- Any e-mail to a tenant or municipality.
- A figure that does not match its photo and cannot be explained.
- A failed daily job two days running.

## 5. Evidence to keep

Meter photos, verification records, monthly hand-check sheets, the dashboard balance per month, job run results
(scheduler response bodies), and owner decisions (DECISIONS.md).
