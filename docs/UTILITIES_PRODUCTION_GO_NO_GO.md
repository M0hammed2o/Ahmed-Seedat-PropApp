# Utilities — Production GO / NO-GO

**Date:** 2026-10-12. Based on `UTILITIES_PHASE3_VALIDATION_REPORT.md`, `UTILITIES_BILLING_RECONCILIATION.md`,
`UTILITIES_HARDWARE_COMPATIBILITY.md` and `UTILITIES_COMPLIANCE_CHECKLIST.md`.

## Verdict

| Step | Verdict | Condition |
| --- | --- | --- |
| Push commits | **GO** on owner approval | — |
| Staging (separate project) | **GO** on owner approval | create staging; follow plan §10 with the re-link guard |
| Production schema (175–183, everything off) | **GO after staging** | staging smoke tests pass; PITR + dump; separate approval |
| Monitoring-only pilot (one organisation, manual readings + photos) | **GO after staging** | P0 list empty (it is); pilot test plan §0 |
| Draft billing of pilot tenants | **NO-GO** | until P1 items B1–B5 are closed |
| Device-based billing | **NO-GO** | until hardware is commissioned (P1-H) |
| Wider commercial rollout | **NO-GO** | P2 items |

## Outstanding items

### P0 — blocks staging or pilot safety

None open. Closed this phase: utilities on by default and ungated write routes (D6), and the scale timeout and silent
truncation (D1, D2).

### P1 — before live customer billing

| # | Item | Owner | Next action |
| --- | --- | --- | --- |
| B1 | Recharge legality per site (NERSA / municipal by-laws), including solar, borehole and rainwater (C1–C4) | owner + lawyer / municipality | written confirmation |
| B2 | Lease clauses and tenant disclosures, including estimates and disputes (C6, C7, C13) | owner + lawyer | update the lease template |
| B3 | VAT treatment and GL posting (C8, C9; TD-61 engineering split after the decision) | accountant, then engineering | decision; then implement the utility income account and VAT split |
| B4 | POPIA basis and notices for consumption data (C11) | information officer | confirm |
| B5 | Real tariffs entered with source references | landlord / manager | enter in the tariff form |
| P1-H | Meter approval and commissioning for any device used for billing (C5; hardware checklist §3) | owner + installer | quotes, purchase approval, commissioning |
| P1-W | ~~Whole-app browser suite green on a stable runner~~ **Closed 2026-10-13:** `Staging verify` workflow (GitHub runner, branch `staging/smart-utilities` @ `d32bc20`): Playwright **87/87**, pgTAP 1,653/1,653, vitest 1,601 passed / 3 skipped, lint, typecheck and build green | engineering | — |

### P2 — before wider rollout

| # | Item |
| --- | --- |
| R1 | Super Admin view of `utilities_enabled` per organisation, with an audited toggle; persisted job-run history (today only scheduler responses and logs) |
| R2 | Android tenant "query this statement" screen (the API exists) |
| R3 | Unit sanity check on ingestion (Wh vs kWh). Today it is caught only as a spike alert |
| R4 | Retention timed at production volume before enabling (G7) |
| R5 | Non-utilities `portfolioIntelligence` `.limit(10_000)` is capped at 1,000 rows; review other modules for unpaged lists |
| R6 | RLS helper cost per visible property (~3 ms): a materialised per-user property set if one user sees thousands of properties |
| R7 | Municipal submission formats and authorised addresses per municipality (C12) before enabling sending |
| R8 | ThingsBoard polling against a live server; Shelly/Milesight/ChirpStack/TTS physical tests |

### P3 — future

- Inverter adapters (Victron VRM, Sunsynk/Deye) once a pilot device and API access are confirmed.
- A guided TOU and seasonal tariff editor, and TOU CSV import.
- Tenant e-mail statements (flag) after a POPIA and consent review.
