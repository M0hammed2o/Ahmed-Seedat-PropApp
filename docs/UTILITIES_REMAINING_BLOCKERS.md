# Utilities — Remaining Blockers

**Date:** 2026-10-11 (end of Phase 3). This replaces `UTILITIES_RELEASE_BLOCKERS.md` as the current list.

Every item below has a reason, an owner and a next action. **No engineering task is open that can be done without
external hardware, a legal/accounting decision or hosted-environment access.** The items marked *engineering* wait for
one of those.

## Resolved in Phase 3 (were blockers or high-value debt)

| Was | Item | Evidence |
| --- | --- | --- |
| G3 / TD-66 | ThingsBoard DNS rebinding: the poll client now connects to the exact public address it validated (socket `lookup` hook), with no redirects and a 10 MB cap | `pinnedFetch.test.ts` 5/5 |
| G4 / TD-53 | Telemetry batch insert (one RPC per 500 readings) and opt-in retention (≥ 400 days; keeps day boundaries, manual, evidenced and flagged readings) | ingestion tests 51/51; `telemetryRetention.integration` 2/2 (×4 runs) |
| TD-54 | Android/monthly readings were invisible to the telemetry dashboard and billing → mirrored by trigger; corrections replace the mirror; 120/120 backfilled in rehearsal | pgTAP `utilities_phase3` #16–17; rehearsal log |
| TD-68 | Cron secret compared in constant time | `cronSecret.test.ts` |
| TD-59 | Playwright can no longer pick up live provider keys from `.env.local` | `playwright.config.ts` webServer env |
| TD-60 | Preview PDF attaches files by document id | code fix |
| — | Missing/faulty readings: opt-in estimate + automatic true-up (draft charge or credit, once, race-safe) | `estimates.integration` 5/5 (×4 runs) |
| — | Rollback script for 175–181, rehearsed (schema identical to 174 after rollback) | `UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §2 |
| P3 (partly) | VAT-registered landlords now see a `vat_ledger_split_pending` flag on every utility charge carrying VAT | `estimates.integration` TD-61 test |

## Blocks STAGING

| # | Blocker | Reason | Owner | Next action |
| --- | --- | --- | --- | --- |
| S1 | Owner approval to push and deploy | the brief forbids deploying without explicit approval | owner | approve items 1–4 of `UTILITIES_STAGING_DEPLOYMENT_PLAN.md` §9 |

No code-side item blocks staging.

## Blocks the CUSTOMER PILOT (one organisation, monitoring or manual-reading billing)

| # | Blocker | Reason | Owner | Next action |
| --- | --- | --- | --- | --- |
| P1 | Staging smoke tests (plan §6, 11 steps) | needs a staging environment | engineering after S1 | run §6 on staging; record results |
| P2 | Is recharging legal at the pilot site? Electricity: NERSA resale guidelines and municipal by-law on approved submeters. Water: by-law / Water Services Act s25. Also lease clauses for shared splits and fixed amounts | legal question; Proplyst makes no legal claim | owner / legal adviser | record a written decision in DECISIONS.md, or run the pilot **monitoring-only** (no tariffs needed) |
| P3 | VAT/GL treatment of utility recharges for VAT-registered landlords (TD-61) | accounting decision: which income account; whether output VAT posts separately | owner / accountant | decide the account and VAT posting; then *engineering*: utility income account and VAT split on tagged invoice lines, plus backfill. Until then, flagged and split by hand |
| P4 | Pilot organisation chosen and the module restricted to it | owner decision | owner | run the two statements in plan §5 on staging, later on production |
| P5 | Two billing cycles reviewed by hand before the first approval | process control | landlord + support | review cycle 1 and cycle 2 drafts against meter photos |
| P6 | Real tariffs for the pilot property | Proplyst must not invent municipal tariffs | landlord / manager | enter the property's actual tariff, with its source reference, in the tariff form |

## Blocks the HARDWARE PILOT

| # | Blocker | Reason | Owner | Next action |
| --- | --- | --- | --- | --- |
| H1 | No physical meter or gateway has reported through any adapter | no hardware purchased (brief) | owner | approve the bill of materials in `UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §5 after written quotes |
| H2 | Pulse-head compatibility of the SA pulse-ready water meter with the EM300-DI | supplier detail not published | owner → supplier | ask the supplier in writing before ordering |
| H3 | Commissioning checklist (§3) completed with evidence | needs installed hardware | engineering + installer (CoC) | follow §3 steps 1–10 |
| H4 | Is the Eastron SDM120M (MID) accepted as an approved submeter for recharging? | MID is not SA type approval | owner / legal | confirm with the municipality, or bill from an approved meter's manual readings |

## Blocks PRODUCTION (general availability)

| # | Blocker | Reason | Owner | Next action |
| --- | --- | --- | --- | --- |
| G1 | Production migration 175–181 | irreversible-class action; needs approval, PITR marker and dump | owner | approve plan §9 item 5 after staging passes |
| G2 | Successful customer pilot (P1–P6) and, for device billing, the hardware pilot (H1–H4) | evidence before scale | owner | — |
| G5 | Decide `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` and `SMART_UTILITY_TENANT_STATEMENTS_ENABLED` (both off) | sends real e-mails to municipalities and tenants | owner | decide after the pilot |
| G6 | Android on-device check of reading capture → Utilities mirror and the tenant statements screen | the local debug build points at production; it cannot be pointed at a local stack here | engineering on a staging build | install a staging-flavoured build; run plan §6 steps 3 and 7 on a phone |
| G7 | Retention at production volume | logic is tested; the run time of a 50,000-row batch on a large table is not | engineering | time one run on staging with copied telemetry before enabling the variable |

## Accepted (documented, not blockers)

| Item | Why it is accepted |
| --- | --- |
| TD-62 | Credits are applied at draft time |
| TD-63 | TOU tariffs need hourly data; other tariffs are refused rather than estimated |
| TD-64 | Inverter adapters are not built: no confirmed pilot device or API access |
| TD-65 | Snapshots appear only after the first billing day |
| TD-67 | A Milesight redelivery without a device time can be stored twice; this has no billing effect |
| TD-69 | Portfolio intelligence still makes one round trip per candidate org |
| TD-57 | Staff utility dashboards and billing are web-only. Phone-width (390 px) browser checks are in the utilities e2e suites. Android shows tenants their statements, and its reading capture now feeds Utilities (181) |

Approved estimates whose actual use proves lower are not credited automatically: Proplyst asks the manager to void and
recalculate. Only invoiced estimates are credited.
