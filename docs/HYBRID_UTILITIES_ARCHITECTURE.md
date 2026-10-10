# Hybrid Water & Electricity Management — Architecture (Phase 2)

**Date:** 2026-10-10. Extends Smart Utilities (migrations 175–177; `SMART_UTILITY_ARCHITECTURE.md`). Migration
`20260101000178_hybrid_utilities.sql`. Nothing here replaces an existing table, invoice path or ledger.

## A. Audit findings that shape the design (verified in code/DB)

| Finding | Consequence |
| --- | --- |
| Rent invoices are created **issued** by `invoice_rent_schedule()` (immutable) | "Utilities on the rent invoice" can only append to a **draft** invoice for that lease/month (`update_manual_invoice`); otherwise a separate draft utility invoice |
| `invoice_line_items` require `unit_price >= 0`, `amount >= 0`; no credit-note concept exists | Corrections before issue: edit/void the draft. After issue: existing `void_invoice()` + regenerate. After payment: a **utility credit** applied to the next period's utility charge (never a negative invoice line) |
| Invoices have no VAT fields; `issue_manual_invoice()` posts to 4000 Rent Income | Utility charges carry excl/VAT/incl themselves; invoice lines use the VAT-inclusive amount with the VAT shown in the description and on the utility statement. GL split of utility income/VAT recorded as debt (TD-61), not rewritten |
| `units.size_sqm` exists; no occupant count | Floor-area allocation uses `size_sqm`; occupancy uses per-member occupant counts entered on the allocation group |
| Main local DB is at head 171 and must be preserved | All migration testing on the throwaway stack (`propvault_su`) |

## B. Supply hierarchy

```
Property ─┬─ supply sources (property | building | unit scope)
          │     electricity: municipal_grid · eskom_direct · prepaid · solar_pv · battery · generator · other
          │     water:       municipal · borehole · rainwater · storage_tank · tanker · other
          ├─ meters (utility_meters) with measurement_kind and optional supply_source_id
          │     electricity: consumption · grid_import · grid_export · generation · battery_charge ·
          │                  battery_discharge · generator_output · pump_energy · transfer
          │     water:       consumption · source_supply · tank_inflow · tank_outflow · transfer
          ├─ level/instant readings per source (utility_source_readings): tank litres/% , battery SoC %,
          │     fuel level %, pump/generator run-hour counters — NOT cumulative consumption
          └─ operating logs per source (utility_source_logs): fuel, tanker deliveries, maintenance, run hours, costs
```

## C. Balance rules (no double counting)

Per property and period, from cumulative meters grouped by `measurement_kind` (consumption engine per meter,
replacement chains respected):

**Electricity**
- Sources into the site = `grid_import + generation + generator_output + battery_discharge`.
- Not consumption = `grid_export + battery_charge` (energy leaving the site or going into storage).
- **Site supply (net)** = sources − (grid_export + battery_charge). Solar that charges the battery and is later
  discharged is therefore counted once (at discharge it re-enters; at charge it left). Solar self-consumption =
  `generation − grid_export − battery_charge` (floored at 0 and labelled *derived* when it would be negative).
- **Measured consumption** = Σ `consumption` meters at the top of the hierarchy (main/check), or Σ unit meters if no
  main consumption meter. **Variance** = site supply − measured consumption (distribution losses/unmetered loads).
- `pump_energy` and `transfer` are inside the site and never added to supply.

**Water**
- Sources = `source_supply` meters (municipal / borehole / rainwater / tanker by their source type) + tanker
  deliveries from logs when no meter exists (labelled *logged, not metered*).
- Storage change = Δ tank level (litres) between period boundaries — **indicative only, never billing-grade**.
- Site use (derived) = sources − Δstorage. `tank_inflow/outflow/transfer` meters are internal movements and are
  never added to supply (prevents borehole → tank → building being counted twice).
- Variance = site use − measured consumption. Labelled with data-quality flags.

Each figure carries `basis`: `measured` | `derived` | `logged` | `missing`, plus a list of data gaps (meters with
`insufficient` quality, sources without meters).

## D. Tariff engine (decimal-safe)

- Money and quantities in `lib/smartUtility/money.ts` use scaled BigInt (quantities and rates to 6 dp; currency to
  cents) with **half-up rounding per line**; VAT computed per line on the excl amount. No floating-point currency.
- Tariff kinds: `block` (stepped, optional seasons), `tou` (hourly windows × weekday/saturday/sunday with optional
  seasons; needs hourly data, otherwise refused), `flat`, `fixed_only`, `cost_recovery` (e.g. solar/borehole/generator
  recovery — **always flagged for contractual/regulatory review**), `prepaid_passthrough` (no charge: tenant buys tokens).
- Rates entered VAT-inclusive or exclusive (`vat_inclusive`, `vat_rate` default 15 %).
- Seasons: `[{name, months:[...], blocks|touPeriods}]`; consumption is split across seasons by the share of daily
  consumption in each season (or by days when daily data is missing); block thresholds are prorated by the season's
  day share.
- Proration: partial segments (move-in/out) prorate fixed charges and block thresholds by `days_in_segment /
  days_in_period` when `prorate_blocks` is on (municipal practice; configurable).
- Versions: tariffs are append-only once referenced by a charge (trigger); a new version closes the previous one.
- Assignment: unit-specific tariff (unit_id + utility + source type) overrides property tariff.
- Every charge stores an **immutable calculation snapshot** (inputs, tariff version, lines); amounts cannot change once
  approved (trigger).

## E. Tenant billing

`utility_billing_arrangements` per unit + utility (effective-dated): `metered_recharge` · `shared_allocation` ·
`landlord_paid` · `included_in_rent` · `fixed_allowance` (fixed monthly fee, optionally with an allowance of included
units and excess billed at tariff) · `tenant_direct` (tenant pays municipality/prepaid vendor). `invoice_mode`:
`separate_invoice` | `with_draft_invoice`.

Shared meters: `utility_allocation_groups` (method equal | floor_area | occupancy | percentage) + members. Shares are
computed on the meter's period consumption; rand amounts use largest-remainder rounding so shares sum exactly.

Lease segmentation: each lease overlapping the period gets its own segment; move-in/move-out readings
(`reading_purpose`) anchor boundaries; otherwise boundaries are interpolated (quality shown).

Statuses: `draft` (estimate) → `approved` → `invoiced` (draft invoice) → [`void`]. Disputes (`open` → `resolved`)
block approval/invoicing. Adjustments only on drafts (audited). Utility credits (from paid-invoice corrections) are
applied to the next charge of the same lease. Uniqueness: one live charge per meter/source, period, charge type, lease.

Regulatory flags on charges: electricity resale (NERSA §8.3/§8.5), solar/borehole/generator cost recovery, water
intermediary (Water Services Act s25) — shown, never auto-resolved.

## F. Statements, alerts, dashboards

- `utility_statements` (tenant | owner, per lease/property and period): immutable snapshot + PDF; draft → approved →
  sent (email only behind `SMART_UTILITY_TENANT_STATEMENTS_ENABLED`, default off).
- Alert rules as built (`lib/smartUtility/hybridAlerts.ts`, daily job step `hybridAlerts`): tank low (critical at
  half the threshold) / near overflow from the latest level in 24 h; battery SoC below its threshold; generator fuel
  below threshold or logged run hours > 1.5× expected; solar generation < 25 % of its own 14-day median (needs ≥ 5 days;
  missing data is never treated as zero output); borehole pump energy > 2.5× its median; missing readings (< half the
  expected count but not zero — zero is the existing offline rule); draft charges older than 3 days (once per property
  per ISO week); utility invoices issued, unpaid and > 7 days past due (once per invoice); supply-vs-use gap above the
  property's discrepancy threshold for the previous calendar month (evaluated on the 1st–3rd, once per month). All
  deduped by `dedupe_key`, acknowledgeable, in-app notification once per new alert. Not built: "battery stuck" and
  "generator fuel per kWh" (need inverter/fuel-sensor data we cannot verify without hardware).
- Portfolio page `/utilities` (monthly snapshots, alerts, drafts, unpaid utility invoices). Property Utilities tab gains
  Supply & sources (any range), billing v2 and statements. Per-unit consumption and charges are a table inside the
  property dashboard — there is no separate unit-page panel (deferred, see NEXT_STEPS).

## G. As built (2026-10-10)

| Area | Code | API |
| --- | --- | --- |
| Supply sources, levels, logs | migration 178; `ingest.ts` (bound level sensors) | `GET/POST /properties/:id/utility-sources`, `GET/PATCH/POST /properties/:id/utility-sources/:sourceId` |
| Tariffs v2 | `tariffEngine.ts`, `tariffAdmin.ts`, `money.ts` | `GET/POST/PATCH /properties/:id/utility-tariffs`, `POST …/utility-tariffs/preview`, `POST …/utility-tariffs/import` |
| Arrangements, shared meters | `billing.ts` | `GET/POST/PATCH /properties/:id/utility-arrangements`, `GET/POST/PATCH /properties/:id/utility-allocation-groups` |
| Charges v2 | `billing.ts` | `GET/POST /properties/:id/utility-charges` (generate; approve/void/invoice; adjust; dispute; credit) |
| Balance & dashboard | `hybridBalance.ts`, `hybridDashboard.ts` | `GET /properties/:id/utility-dashboard?from&to` |
| Portfolio | `portfolio.ts` | `GET /utilities/portfolio?months` |
| Statements | `statements.ts` | `GET/POST /properties/:id/utility-statements`, `GET (PDF)/POST /properties/:id/utility-statements/:id`, `GET /tenant-portal/utility-statements` |
| Alerts | `hybridAlerts.ts` | daily job (`/system/smart-utility-jobs`, `/system/daily-jobs`) |

Cross-row integrity added to 178: a shared group's meter, a member's group and an arrangement's group must be on the
same property; a source's sensor integration must belong to the same organisation; rate-based tariff kinds must have
rates. Logged tanker deliveries count as tanker supply whichever source they were logged on.
