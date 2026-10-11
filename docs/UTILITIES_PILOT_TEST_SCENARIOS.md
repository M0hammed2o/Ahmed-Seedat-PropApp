# Utilities — Pilot Test Scenarios

**Date:** 2026-10-11 (Phase 3). **All tariffs are fictional test figures.** They are not municipal or legally authorised rates.
Every expected amount below is worked out by hand from those figures. Each scenario is an automated test that runs
against a disposable local Supabase stack. No real customer, municipality, device or payment provider is involved.

| Test file | What it covers |
| --- | --- |
| `apps/admin/lib/smartUtility/__tests__/pilot.integration.test.ts` | the pilot properties P, Q, R below (5 tests) |
| `.../estimates.integration.test.ts` | missing readings → estimate → true-up, concurrency, TD-61 flag (5 tests) |
| `.../financialAudit.integration.test.ts` | six-flat financial audit, mid-period changes, VAT, invoice void (Phase 2 audit) |
| `.../hybrid.integration.test.ts` | site balance, recovery, statements, alerts, portfolio |
| `supabase/tests/utilities_phase3.test.sql` | tenant write-denial, service-only functions, legacy reading mirror (20 pgTAP) |

## Fictional tariffs used

- Electricity: flat **R3.00/kWh** incl. 15 % VAT, plus a **R60.00** fixed charge per month, prorated by days.
- Water: **0–6 kL R20**, **6–15 kL R30**, **>15 kL R50** per kL, incl. VAT, no fixed charge.

## Property P — "Protea Gardens": hybrid, 7 flats, October 2026 (31 days)

Supply on site:
- **Electricity:** municipal/Eskom grid main meter (400 kWh), roof solar (900), battery (300 in / 270 out), diesel
  generator (50), main consumption meter (1,300).
- **Water:** municipal connection (30 kL), borehole (15 kL, pump 120 kWh), JoJo tank 5,000 L (40 % → 60 %), tanker
  delivery (2 kL, R900).

| Flat | Arrangement | Readings | Expected (hand) | Result |
| --- | --- | --- | --- | --- |
| F1 | metered electricity + metered water | 200 kWh; 8 kL | 200×3 + 60 = **R660.00**; 6×20 + 2×30 = **R180.00** | pass |
| F2 | electricity included in rent; water paid by landlord | 150 kWh; 5 kL (monitoring) | **nothing** | pass |
| F3 | fixed R400 including 100 kWh | 130 kWh | **R400.00** + 30×3 = **R90.00** excess (no second fixed charge) | pass |
| F4 | fixed R350/month, no allowance; water shared with F7 (equal) | shared meter 20 kL | **R350.00**; 20 kL = 6×20 + 9×30 + 5×50 = R640 → **R320.00** | pass |
| F5 | metered; tenant out 15 Oct, new tenant in 16 Oct | 50 kWh then 40 kWh | 150 + 60×15/31 = **R179.03**; 120 + 60×16/31 = **R150.97**, two leases | pass |
| F6 | metered; **no closing reading** | Sep: 300 kWh / 30 days | estimate 10/day × 31 = 310 kWh → 930 + 60 = **R990.00**, flagged | pass |
| F6 (later) | 1 Nov reading arrives: 330 kWh | — | true-up (330 − 310) × 3 = **R60.00** draft, once | pass |
| F7 | electricity prepaid by the tenant directly; water shared | — | **nothing**; water **R320.00** | pass |

Checks:
- **Month total** of the 10 charges: 660 + 180 + 400 + 90 + 350 + 320 + 320 + 179.03 + 150.97 + 990 = **R3,640.00**.
  The test recomputes it as integer cents. Pass.
- **Never billed:**
  - grid import, solar, battery, generator, pump energy, source supply, both main consumption meters;
  - tank levels (not meters), the tanker log.
  - Every charge's meter is asserted not to be one of these.
- **Re-running** the month creates nothing new.
- **Dispute:** a disputed charge is not approved (`approved: 2, ignored: 1`) until resolved, then it is approved and
  invoiced.
- **Invoice:** goes onto a **draft** invoice (`issued_at` null). The utilities module never issues invoices.
- **Credit after invoicing:**
  - over the charged amount → refused;
  - R30 → recorded against the lease (`remaining` R30), applied to the lease's next utility charge.
- **Site balance:**
  - electricity in = 400 + 900 + 50 + 270 − 300 = **1,320 kWh**, against 1,300 measured;
  - water supply = 30 + 15 + 2 = **47 kL**;
  - tank +1 kL stored → **46 kL** used on site.

  Pass.

## Property Q — "Hilltop Farmhouse": private-only, does not resell (monitoring only)

Solar, battery, borehole and tank. Two rented units with their own meters. **No tariffs.**
- Cottage: electricity included in rent → nothing to recharge.
- Studio: arrangement mistakenly set to metered recharge without a tariff → **refused** ("No electricity tariff effective
  …"), no charge, nothing guessed.
- Dashboard shows the units' use (220 / 180 kWh). The Utilities overview and portfolio load. Pass.

**Rule demonstrated:** a tariff is only needed when the property actually charges or recovers utility costs.
Landlord-paid, included-in-rent, tenant-direct and pure fixed-amount arrangements never need one.

## Property R — "Station Flats": municipal-only

Two flats with water meters, no supply sources. 4 kL → 4×20 = **R80.00**; 16 kL → 6×20 + 9×30 + 1×50 = **R440.00**.
Pass.

## Estimates and true-up (`estimates.integration.test.ts`)

| Case | Expected | Result |
| --- | --- | --- |
| August actual 310 kWh (31 days) | 310×3 + 60 = R990 | pass |
| September, no closing reading, estimate off | refused, R0, flagged for review | pass |
| September, estimate on | 10/day × 30 = 300 kWh → **R960**, flag `estimated_consumption_true_up_pending` | pass |
| Unit with no history | never estimated (R0, review) | pass |
| A: estimate invoiced, actual 270 | **R90 credit** on the lease, reason "True-up: actual 270 vs estimated 300 …" | pass |
| B: estimate approved, actual 330 | **R90 draft true-up**, 30 kWh, VAT split adds back to R90 | pass |
| C: estimate approved (not invoiced), actual 280 | skipped: "void it and recalculate" | pass |
| Two charge runs at once, then re-runs | exactly one credit and one true-up in total | pass (3 repeated runs) |
| VAT-registered landlord (fictional VAT no.) | charge flagged `vat_ledger_split_pending` (TD-61) | pass |

## Manual pilot checks (need a person; not automated)

1. **Android capture:**
   - record a monthly reading on the phone;
   - it appears in Utilities as an unverified manual reading at 12:00 SAST on the reading date (migration 181 mirror);
   - correcting it replaces the mirror.
2. **Mobile browser:** Utilities tab, Calculate charges (with and without "Estimate where readings are missing"),
   charges table flags, statement preview.
3. **Two billing cycles** of draft charges compared by hand with meter photos before the first approval.
4. **Hardware commissioning:** `UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §3 (only once the owner approves hardware).
