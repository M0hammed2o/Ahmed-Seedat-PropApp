# Utilities — Billing Reconciliation

**Date:** 2026-10-12. **Data:** synthetic fictional tenants and fictional tariffs only. **Environment:** a disposable
local Supabase stack. Every invoice the tests produce is a **draft**; nothing is issued or sent.

## Method

1. Every expected amount is worked out **by hand, before the engine runs**. The arithmetic is kept next to each case.
   - The newest dataset is a separate file:
     `apps/admin/lib/smartUtility/__tests__/fixtures/reconciliation-expected.json`.
   - The test compares the engine against it and never edits it to fit.
2. Rounding rules, stated once:
   - VAT is 15 %, rounded **half-up per line** (usage and fixed separately);
   - money is held in integer cents;
   - shared splits use the largest remainder, so shares always add up to the total.
3. A mismatch is investigated, never "fixed" by changing the expectation. In this phase **no amount mismatched**.

## Result

**All cases match exactly.**

| Area | Cases (hand-computed) | Suite | Result |
| --- | --- | --- | --- |
| Water per kL, block tariffs | 18 kL = 6×R20 + 9×R30 + 3×R50 = **R540.00**; 8 kL **R180.00**; 16 kL **R440.00**; 40 kL shared **R1,640.00** | reconciliation, pilot, financialAudit | pass |
| Electricity per kWh, flat + fixed | 100 kWh × R3 + R60 = **R360.00**; 200 kWh **R660.00** | financialAudit, pilot | pass |
| VAT-**exclusive** tariff, half-up | 123 kWh × R2.50 = R307.50 excl, VAT R46.125 → **R46.13**; fixed R50 + R7.50; total **R411.13** (excl R357.50, VAT R53.63) | reconciliation R1 | pass |
| VAT-inclusive split | R360 incl → usage VAT R39.13 + fixed VAT R7.83 = **R46.96** | financialAudit | pass |
| Time-of-use | TOU + allowance **refused** (not guessed); TOU needs hourly data (TD-63) | financialAudit, tariffEngine | pass |
| Seasonal tariff | July is in Winter: 100 kWh × R4.00 = **R400.00** (default rate would give R200) | reconciliation S1, tariffEngine | pass |
| Tariff change within a period | unit tariff R3.00 → R3.30 on 16 Oct: **R450.00** + **R528.00**; municipal increase 1 July: **R630.00** (not R600) | reconciliation R4, financialAudit | pass |
| Fixed charges and proration | R60 × 15/31 = **R29.03**; × 16/31 = **R30.97** | pilot, financialAudit | pass |
| Shared water meter | floor area 40/50/60/70 m², landlord keeps 10 % → **R268.36 / 335.45 / 402.55 / 469.64** (sum R1,476.00) | financialAudit | pass |
| Shared **electricity** meter | 300 kWh on the property tariff = **R920.00** incl. fixed; equal split → **R460.00** each | reconciliation R6 | pass |
| Shared splits by percentage, occupancy, vacant member | 30 %/50 %/landlord 20 % of R200 → **R60 / R100**; 2/3/5 occupants of R30 → **R6 / R9 / R15**; vacant third stays with the landlord (**R33.34 + R33.33**) | financialAudit | pass |
| Mid-month move-out/move-in | 50 kWh → **R179.03**; 40 kWh → **R150.97**, two leases | pilot, financialAudit | pass |
| Meter replacement | 80 + 70 kWh across the swap → **R488.75**; a re-run after replacement bills nothing again | reconciliation R5, financialAudit | pass |
| Missing / invalid readings | no history → refused (R0, review); reset → suspect, excluded; never negative | estimates, ingestion | pass |
| Estimated vs actual | estimate 10/day × 30 = 300 kWh → **R960**; actual 330 → **R90 draft true-up**; actual 270 on an invoiced estimate → **R90 credit**; once, race-safe | estimates, pilot | pass |
| Credits and disputes | credit capped at the charged amount; a disputed charge cannot be approved or invoiced; a tenant can open a dispute on their own statement | billing, pilot, tenant dispute | pass |
| Duplicate invoice prevention | invoicing an invoiced charge again creates nothing; concurrent invoicing → exactly one invoice | reconciliation, financialAudit | pass |
| Invoice void and regeneration | void → charge released → re-invoice → **1 live draft, 1 voided, 0 issued** | reconciliation, financialAudit | pass |
| Solar / borehole / hybrid | no charge ever cites a grid, solar, battery, generator, pump, source or main meter; tank levels never billed | pilot, reconciliation, financialAudit | pass |
| Prepaid / Eskom-direct / rainwater | tenant-direct prepaid → nothing; source meters never billed | reconciliation R7 | pass |
| Monitoring-only | no tariff needed; metered recharge without a tariff is refused | pilot (Q) | pass |
| Month totals (second method) | pilot **R3,640.00**; demo **R3,940.00**, each recomputed in cents | pilot, demo seeder | pass |

## Policies the expected results depend on (deliberate, stated)

| Policy | Detail |
| --- | --- |
| Shared meter | Priced **once** on the property tariff, **including its fixed charge**, then split. A tariff change inside the period is refused for shared meters (it is not split per tenant) |
| Fixed-allowance arrangements | No second fixed charge on the excess |
| Proration | By days in the billing period. Block thresholds are prorated (`prorate_blocks`, default on) |
| Vacant days | Stay with the landlord, both for submeters (no lease → no charge) and for shared splits |

## Not verified here

- **Real municipal tariffs:** none were entered. The landlord must enter the actual tariff with its source reference.
- **VAT/GL posting for VAT-registered landlords:** flagged only (TD-61, see `UTILITIES_COMPLIANCE_CHECKLIST.md`).
- **TOU billing at scale with real hourly data:** engine tests only.
