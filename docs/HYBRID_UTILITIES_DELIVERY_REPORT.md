# Hybrid Water & Electricity — Phase 2 delivery report

**Date:** 2026-10-10. **Commits:** `b728445` (migration 178, tariff engine, balance engine) · `e76da3c` (billing v2,
sources, tariff APIs) · `95b37bc` (dashboard, statements, alerts, portfolio) · `dccc21d` (web UI) · `8b04c15`
(Android + tenant API) · `63dbb6b` (browser walk-through). Design: `HYBRID_UTILITIES_ARCHITECTURE.md`.
**Nothing was deployed, no production migration was applied, nothing was sent, no hardware or service was bought.**

## 1. Features and how each was verified

| Feature | Verified by |
| --- | --- |
| Supply sources (grid, Eskom, prepaid, solar, battery, generator; municipal, borehole, rainwater, tank, tanker), manual levels, fuel/tanker/maintenance logs | pgTAP (type/scope/role checks, server-only readings); browser (add source) |
| Level sensors bound to sources via existing adapters (stored as instant levels, never consumption) | real-DB test `sourceIngest` (accept, dedupe, unbound channel ignored, >100 % rejected, nothing written to telemetry) |
| Meter "what it measures" (12 kinds) + source link; only `consumption` feeds totals, reconciliation, leak rules, billing | pgTAP (kind/utility check, pump energy → borehole); code paths filtered; Android labels hybrid meters "monitoring only" |
| Hybrid balance, no double counting (solar→battery→load once; borehole→tank→building once; tanker logged) | unit tests (7) + real-DB Pretoria scenario (site supply 1 320 kWh, solar self-use 600, water 37 kL supply, +1 kL stored, 36 kL use) |
| Tariffs v2: block, flat, TOU, seasonal, fixed-only, cost-recovery (flagged), prepaid pass-through; VAT incl/excl + rate; per property or unit; versions (used tariffs immutable); preview; CSV import with dry run | unit tests (15 engine + 5 CSV); pgTAP (used-tariff immutability, rates present); browser (flat tariff preview R310,00 for 100 kWh) |
| Decimal-safe money (scaled BigInt, per-line rounding, exact proration, largest-remainder split) | unit tests |
| Billing arrangements per unit (metered, shared split, fixed amount/allowance, landlord-paid, included in rent, tenant-direct); nothing charged without one | real-DB test: unarranged metered unit reported, never charged; browser: "not set — never charged" |
| Shared meters (equal, floor area, occupancy, %), landlord common-area share, vacant shares stay with landlord | real-DB test: R3 150 → 10 % kept → R1 890,00 to a 60 m² unit, vacant 30 m² unit not charged |
| Move-out / move-in segmentation, prorated fixed charge | real-DB test: R975,00 (outgoing) + R675,00 (incoming) |
| Double-billing prevention | pgTAP unique index; real-DB re-run creates 0 |
| Adjust (drafts only, audited), dispute (blocks approval/invoicing), credit (invoiced only, ≤ charge, applied next period, restored on void) | real-DB tests |
| Approved charges immutable; invoices **draft only** (append to this month's draft or separate draft) | pgTAP + real-DB (appended to a draft with a parking line: 3 lines, R2 590) |
| Regulatory review flags on every charge | real-DB + browser ("check NERSA rules") |
| Any-range property dashboard, recovery vs estimated supply cost, source status | real-DB (recovery 26,5 % = R450 / R1 700) + browser |
| Tenant/owner statements: snapshot, approve before visible, PDF, e-mail only with flag + click | real-DB (tenant RLS, owner report hidden, immutability, flag off → refused, mock send) + browser |
| Alerts: tank low/overflow, battery, generator fuel/hours, solar output, borehole pump, missing readings, drafts waiting, unpaid utility invoices, monthly supply-vs-use gap; deduped | unit (7) + real-DB (tank low critical once/day; drafts once/week) |
| Portfolio page `/utilities` | real-DB (staff see; tenant sees nothing) + browser |
| Android: tenant "Utility statements" screen; mobile route allow-listed | `compileDebugKotlin` via `testDebugUnitTest` (3 new + 5 existing tests); `mfaPolicy` parity test |

## 2. Files, migrations, APIs, screens

- **Migration:** `20260101000178_hybrid_utilities.sql` (local/throwaway only). APIs: table in architecture §G plus
  `GET /api/v1/tenant-portal/utility-statements`. Libraries: `lib/smartUtility/{money,tariffEngine,tariffAdmin,billing,hybridBalance,hybridDashboard,hybridAlerts,portfolio,statements}.ts`.
- **Screens:** property Utilities tab → Supply & sources, Utility recharges (rebuilt), Utility statements; Add Meter
  wizard asks what the meter measures; `/utilities` portfolio (nav: Operations → Utilities); Android tenant profile →
  Utility statements. Screenshots: `docs/qa/hybrid-utilities-2026-10-10/`.

## 3. Test results (this environment: Windows, throwaway Supabase stack `propvault_su`)

See `SMART_UTILITIES_TEST_RESULTS.md` for the full list. Summary: pgTAP 101 files / 1 608 pass (fresh stack, from
migration zero); module tests 18 files / 195 pass; `lib` 95 files / 981 pass, 3 skipped (pre-existing); app/components
batch and whole-suite run: 1 533 pass, 1 fails (the known pre-existing `daily-jobs` 20 s budget — `portfolioIntelligence` 18.9 s; the new alert step ≈ 0.9 s), 3 skipped; `tsc` and ESLint clean; `next build` succeeds; Playwright 2/2 (original Smart
Utilities walk-through and the new hybrid one); Android full unit suite 359/359 and `lintDebug` run. Main local DB restored afterwards (2 725 orgs, head 171).
**Not run:** physical meters or inverters (none bought), iOS (no iOS app in the repo — the APIs are plain JSON +
bearer auth and usable by one), production database.

## 4. Defects found and fixed during this phase

Float drift in prorated block thresholds (exact rational proration); scope trigger failing on tables without
`building_id`; Phase 1 totals/reconciliation/leak rules would have counted solar/export/battery meters as consumption;
tanker deliveries logged on the tank they filled were ignored in the water balance; credits consumed by a voided charge
were lost; empty block tariffs became insertable after the relaxed check (kind-aware check restored); cross-property
links (group meter, member group, arrangement group, source integration) were not enforced in the DB; gaps for an
unmonitored utility were reported as "no consumption meters".

## 5. Hardware-dependent (not verified without devices)

Every sensor path uses the Phase 1 adapters (Milesight, Shelly, Modbus gateway, generic JSON, simulator). Inverter
cloud APIs: Victron VRM is public (adapter designed, not built); Sunsynk/Deye only via a local gateway → generic JSON;
SolarEdge public but 300 calls/day/site; Fronius, SOLARMAN, Deye Cloud, Huawei, GoodWe partner-only. "Battery stuck"
and "fuel per kWh" rules need data we cannot verify (TD-64). Monitoring-grade devices (Shelly, CT clamps) are labelled
as such; billing-grade needs approved meters (NERSA / by-laws).

## 6. Hosting and operating costs

- **Storage (Derived):** measured 451 bytes per telemetry row including indexes (50 000-row rolled-back insert).
  15-min readings ≈ 35 040 rows ≈ **15.8 MB per meter per year**; hourly ≈ 4 MB. 100 meters at 15 min ≈ 1.6 GB/year.
  Statements, charges and level readings are negligible next to this.
- **Compute:** no new service; the daily job gains one step (`hybridAlerts`) and a monthly dashboard per hybrid
  property on the 1st–3rd. **Unknown — Supabase/Vercel plan prices were not checked this session**; confirm the
  current database size allowance before onboarding more than ~50 meters at 15-minute intervals (TD-53/TD-65).
- **E-mail:** statements only when enabled; one message per statement through the existing provider.
- **Hardware:** see `SA_SMART_METER_CATALOGUE.md` (dated SA prices; e.g. Milesight EM300-DI R1 350–R1 492, Shelly
  Pro 3EM R3 029, LoRaWAN gateway R4 385–R8 888).

## 7. Production deployment checklist (owner-approved steps; none done)

1. Back up production; confirm its migration head (last recorded as 174 in project memory — verify, do not assume);
   apply 175–178 in order on a staging copy first and run the pgTAP suite there.
2. Apply to production only after (1) passes; verify with the rollback-only technique used for 171/172.
3. Keep `SMART_UTILITY_AUTO_SUBMISSION_ENABLED` and `SMART_UTILITY_TENANT_STATEMENTS_ENABLED` **unset**.
4. Set `SMART_UTILITY_CREDENTIALS_KEY` only if poll integrations are used (and fix TD-58 first).
5. Blank external keys in the Playwright web-server env before running e2e anywhere (TD-59).
6. Deploy web; smoke-test Utilities tab, `/utilities`, a statement PDF; release Android build with the new screen.
7. Pilot one property; review every draft charge and statement by hand for the first two cycles.

## 8. Regulatory and business decisions outstanding (owner)

- Whether each pilot site may recharge electricity (NERSA resale guidelines; municipal by-laws on approved submeters)
  and water (Water Services Act s25 / by-laws); lease clauses for shared-meter splits and fixed amounts.
- VAT treatment of utility recharges for VAT-registered landlords, and the GL split (TD-61).
- Whether solar/borehole/generator **cost recovery** is offered at all (always flagged; never automatic).
- Enabling tenant statement e-mail; enabling automatic municipal submission (both off).
- Which inverter brand to support first for a pilot (drives the VRM vs local-gateway build).

## 9. Pilot-readiness recommendation

**Ready for a supervised pilot on one property with manual or already-supported meters**, after migrations 175–178
are applied to production with the checklist above and the owner has made the site's recharge decision in §8. Not
recommended yet: automatic sending of anything, cost-recovery tariffs, or relying on inverter data without a
verified adapter. Self-verified; no independent verifier was run.
