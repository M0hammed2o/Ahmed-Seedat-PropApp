# Utilities — Financial Validation

**Date:** 2026-10-10/11. **All tariffs in tests are fictional test figures, not municipal or legally authorised
rates.** Expected values were computed independently by hand (shown in the test comments) and compared with the
system's output on a real local Supabase database. **No invoice was issued** during this audit — every invoice created
is a draft, and tests assert `status = 'draft'`, `issued_at = null`.

Tests: `lib/smartUtility/__tests__/financialAudit.integration.test.ts` (14 scenarios), `auditFixes.test.ts` (15),
`tariffEngine.test.ts` (15), `billing.integration.test.ts` (5), `hybrid.integration.test.ts` (5), Phase 1 route test
(`utility-charges/__tests__/billing.integration.test.ts`), pgTAP `utilities_hardening.test.sql` (17) and
`hybrid_utilities.test.sql` (28).

## Defects found and fixed (commit `a8c2874` unless noted)

| ID | Severity | Defect (before) | Fix | Verified by |
| --- | --- | --- | --- | --- |
| FIN-01 | Critical | Changing a unit's arrangement mid-period billed the whole period under BOTH arrangements (R1 800 instead of R900) | Segments clipped to each arrangement's window; DB exclusion constraint forbids overlapping live charges (179) | Scenario B "arrangement change", pgTAP 8 |
| FIN-02 | High | `end_lease()` sets only the status, so a terminated lease without an end date was billed to period end, overlapping the new tenant | Refused with a reason ("set the lease end date"); overlapping leases refused | Scenario B "terminated lease", unit tests |
| FIN-03 | High | Re-running a period after a meter replacement billed the old meter's consumption again | Overlap exclusion per unit/utility/charge type | Scenario B "meter replacement" |
| FIN-04 | High | TOU tariff + included allowance billed all usage (R230 vs R115) | Refused | Scenario C "TOU + allowance" |
| FIN-05 | High (VAT) | Credits/adjustments changed totals but not excl/VAT | VAT rescaled proportionally, half-up | Scenario B "adjustments", unit tests |
| FIN-06 | High | Voiding/deleting an invoice left its utility charges "invoiced" forever | Trigger releases them to "approved" (179) | Scenario A "void", pgTAP 13 |
| FIN-07 | Medium | Tariff change inside a period ignored (whole period at the old rate) | Segment split at tariff boundaries; live key includes `segment_start` (179) | Scenario C (R300 + R330 = R630) |
| FIN-08 | Medium | Two meters in one unit: two fixed charges and two sets of block allowances | Combined as one supply | Scenario A Flat 3 |
| FIN-09 | Medium | Unit-linked check meters were billed | Only consumption **submeters** billable | Scenario A Flat 6 |
| FIN-10 | Medium | Shared group could use a generation/battery/pump meter | Route + DB refuse non-consumption meters (179) | pgTAP 7 |
| FIN-11 | Low–Medium | Append-to-draft lookup used `YYYY-MM-31` (invalid in 30-day months) → silently a separate invoice | Next-month bound | Scenario B "30-day month" |
| FIN-S1 | Medium | Concurrent invoicing could place a charge on two invoices | Charges claimed (approved → invoiced) before the invoice RPC; released on failure | Scenario A "never twice" |
| — | Low | Credits could be spent twice by concurrent runs | Compare-and-set on `remaining` | code review |

## Scenario A — "Jacaranda Court", six flats, solar + battery + grid, borehole + municipal water

Fictional tariffs: electricity flat R3,00/kWh incl. VAT + R60,00 fixed/month; water blocks 0–6 kL R20, 6–15 R30,
>15 R50. October 2026 (31 days).

| Flat | Arrangement | Consumption | Expected (hand) | System |
| --- | --- | --- | --- | --- |
| 1 | metered | 100 kWh | 100×3 + 60 = **R360,00** (VAT 39,13 + 7,83 = 46,96) | R360,00 / VAT 46,96 |
| 2 | metered | 150 kWh | **R510,00** | R510,00 |
| 3 | metered, two meters | 80 + 40 kWh | 120×3 + one fixed 60 = **R420,00** | R420,00 |
| 4 | metered | 200 kWh | **R660,00** | R660,00 |
| 5 | metered, move-out 15th / move-in 16th | 50 + 40 kWh | 150 + 60×15/31 = **R179,03**; 120 + 60×16/31 = **R150,97** | R179,03 / R150,97 (two tenants) |
| 6 | vacant (+ check meter) | — | **not charged** | not charged, reason "vacant" |
| 1–4 water | shared, floor area 40/50/60/70, landlord 10 % | 40 kL shared | 6×20+9×30+25×50 = R1 640; 90 % = R1 476 → **268,36 / 335,45 / 402,55 / 469,64** (sum 1 476,00) | identical |

Non-billable meters present and confirmed never cited by any charge: grid import, solar generation, battery
discharge, borehole pump energy, borehole and municipal source-supply meters, the unit-linked check meter.
Re-running (twice concurrently) creates nothing; invoicing two concurrent requests yields one draft invoice with usage
(R450) and fixed (R60) as separate lines; voiding it returns the charge to "approved" and it can be invoiced again.

## Coverage of the brief's checklist

| Requirement | Evidence |
| --- | --- |
| Flat, block, TOU, seasonal tariffs | `tariffEngine.test.ts` (block/seasonal/TOU/cost-recovery), Scenarios A/C |
| VAT inclusive / exclusive | `tariffEngine.test.ts`, Scenario A VAT check |
| Fixed and usage as separate invoice lines | Scenario A; Phase 1 route test (`Water usage 12 kL` 330 + `Water fixed charge` 85) |
| Decimal precision, cents | `money.ts` scaled BigInt; per-line half-up; largest-remainder allocation (sum exact) |
| kWh and kL (litres ÷ 1 000) | Scenarios A/C (water registers in litres) |
| Resets, rollovers, replacements | `engines.test.ts` (reset/rollover), Scenario B replacement |
| Missing / delayed / duplicate / out-of-order readings | ingestion tests (duplicates, ordering, window), insufficient readings refuse approval (Phase 1 route test) |
| Mid-month tariff change | Scenario C |
| Move-in / move-out | Scenario A Flat 5, `billing.integration.test.ts` |
| Shared allocations (percentage, occupancy, floor area, equal) | Scenario A (floor area + landlord 10 %), Scenario D: percentage 30/50 + landlord 20 % of R200 → R60/R100; occupancy 2/3/5 of R30 → R6/R9/R15; equal three ways of R100 with a vacant member → R33,34 + R33,33, vacant third kept by landlord |
| Vacant units / owner-absorbed | Scenario A Flat 6 and shared vacant share |
| Solar/grid and borehole/municipal/tanker hybrids | `hybrid.integration.test.ts`, Scenario A |
| Disputes, credits, reversals, corrected invoices | `billing.integration.test.ts`, Scenario A void → re-invoice, Scenario B adjustments |
| Idempotency (job runs twice) | Scenario A concurrent re-run, pgTAP exclusion |
| Previously invoiced periods | exclusion constraint + "cannot invoice twice" tests |
| Regulatory review flags | every Scenario A charge carries `*_review` flags |
| Billing only per explicit arrangement + validated consumption | arrangement-less units reported not charged; insufficient consumption cannot be approved |

## Open items (not defects found, but not yet separately evidenced)
- Ledger posting of utility income/VAT (TD-61) is unchanged: invoice lines post to 4000 Rent Income.
- `partial` consumption (gaps > 48 h at a boundary) can be approved; it under-states (tenant-favourable) and is labelled
  "estimated" on charges and statements.
