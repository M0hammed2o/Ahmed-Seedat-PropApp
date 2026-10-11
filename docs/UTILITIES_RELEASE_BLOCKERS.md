# Utilities — Release Blockers

**Date:** 2026-10-11. A blocker stops the named release level until it is resolved. None of these can be resolved in
code by the engineering team alone unless marked *engineering*.

## Blocks STAGING (none open)

All code-side items needed for staging are done: no open critical/high security finding, financial validation passes,
migrations rehearsed on representative data, test suites pass (see `UTILITIES_FINAL_TEST_RESULTS.md`). Staging needs
only the owner's go-ahead and the steps in `UTILITIES_STAGING_DEPLOYMENT_PLAN.md`.

## Blocks the CUSTOMER PILOT

| # | Blocker | Owner | Unblocks when |
| --- | --- | --- | --- |
| P1 | Staging deployment + smoke tests (plan §6) not yet performed | owner approval, then engineering | all 9 smoke tests pass on staging |
| P2 | Recharge legality for the pilot site (electricity: NERSA resale guidelines, municipal by-laws on approved submeters; water: by-law / Water Services Act s25) and lease clauses for shared splits / fixed amounts | owner / legal | written decision recorded in DECISIONS.md |
| P3 | VAT treatment of utility recharges if the landlord is VAT-registered; ledger split (TD-61) | owner / accountant | decision; if VAT-registered, TD-61 implemented first (*engineering*) |
| P4 | Pilot organisation chosen and `utilities_enabled` restricted to it (plan §5) | owner | SQL run on production after deployment |
| P5 | Two billing cycles reviewed by hand before the first approval (process, not code) | landlord + support | cycle 2 reviewed |

## Blocks the HARDWARE PILOT

| # | Blocker | Owner |
| --- | --- | --- |
| H1 | No physical meter/gateway has reported through any adapter (every hardware path is "implemented from documentation, untested") | owner purchase approval; installer (CoC) |
| H2 | Pulse-head compatibility of the chosen SA pulse-ready water meter with the EM300-DI | supplier confirmation |
| H3 | Commissioning checklist (`UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §3) completed with evidence | engineering + installer |

## Blocks PRODUCTION (general availability)

| # | Blocker | Owner |
| --- | --- | --- |
| G1 | Production migration of 175–180 (owner approval; backup + PITR marker first) | owner |
| G2 | Successful customer pilot (P1–P5) and, for device billing, hardware pilot (H1–H3) | owner |
| G3 | TD-58 residual (DNS rebinding) closed by an egress proxy / pinned agent **before** offering ThingsBoard poll integrations in production; otherwise keep poll integrations disabled (`SMART_UTILITY_CREDENTIALS_KEY` unset) | *engineering* |
| G4 | TD-53: telemetry batch inserts + retention/roll-up before onboarding many 15-minute meters | *engineering* |
| G5 | Decisions on `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` and `SMART_UTILITY_TENANT_STATEMENTS_ENABLED` (both stay off until decided) | owner |
| G6 | Android on-device check of the tenant statements screen against staging (not possible locally: the debug build points at production and the machine cannot run emulator + dev server together) | engineering on a staging build |

## Not blockers (accepted, documented)
INT-02 Milesight redelivery duplicate (no billing effect); SUS-01 non-constant-time cron secret compare (theoretical);
TD-62 credits applied at draft time; TD-63 TOU needs hourly data; TD-64 inverter adapters not built; TD-65 monthly
snapshots before history appears.
