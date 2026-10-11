# Utilities — Hardware Integration Status and Pilot Checklist

**Date:** 2026-10-11. **No hardware was purchased and no supplier was contacted.** Prices and products are in
`SA_SMART_METER_CATALOGUE.md` (dated listings).

## 1. Integration status by evidence (strict)

| Path | Implemented | Evidence | Status |
| --- | --- | --- | --- |
| Manual readings + photo (any meter) | yes | unit, DB, browser tests | **Verified (software); no device involved** |
| Proplyst JSON push (any device/gateway) | yes | integration tests against the documented contract | **Verified with simulator/fixtures only** |
| Simulator (`scripts/simulate-meter-feed.mjs`) | yes | integration tests | **Simulator** |
| Milesight EM300-DI via gateway HTTP | yes | hand-built frames (`engines.test.ts`), ingest route test | **Implemented from documentation; untested with hardware** |
| Shelly Gen2 / Pro EM (EMData, Input counters) | yes (needs on-device script) | fixture tests | **Implemented from documentation; untested with hardware** |
| ChirpStack v4 webhook | yes | fixtures from proto field names | **Implemented from documentation; untested** |
| The Things Stack webhook | yes | fixtures | **Implemented from documentation; untested** |
| ThingsBoard REST poll | yes | mocked HTTP only; paging + SSRF fixed this pass | **Implemented; requires the customer's server credentials; untested against a live server** |
| Modbus meters (Eastron, CHINT) via a gateway posting Proplyst JSON | gateway-side only | none | **Implemented from documentation; untested** |
| Kamstrup wM-Bus / READy | no | — | **Requires supplier approval** |
| Inverters: Victron VRM (public API) | no adapter | research only | **Unsupported (adapter designed, not built)** |
| Inverters: Sunsynk/Deye via local gateway → JSON | gateway-side only | none | **Unsupported directly; possible via Proplyst JSON, untested** |
| SolarEdge (300 calls/day/site), Fronius, SOLARMAN, Huawei, GoodWe | no | — | **Requires partner access / unsupported** |

Nothing in this table is production-ready for billing until a real device has reported through it and its readings have
been compared with the physical register (§3 step 7). Customer-facing labels match this table (catalogue fix CAT-01).

## 2. What to have for a two-meter pilot (one water, one electricity)

| Item | Water | Electricity |
| --- | --- | --- |
| Meter | SANS 1529-1 pulse-ready meter (installed by a plumber; CoC where required) | Existing municipal/prepaid meter stays; add a DIN-rail submeter, e.g. Shelly Pro EM-50 (monitoring-grade) or an approved billing meter if recharging (NERSA/by-law) — installed by a registered electrician with CoC |
| Sensor / interface | Milesight EM300-DI pulse counter (confirm pulse-head fit with the meter supplier first) | Shelly on Wi-Fi, or Modbus meter + gateway |
| Gateway | LoRaWAN gateway (e.g. UG63-LTE) with backhaul | Site Wi-Fi with internet, or the Modbus gateway |
| Connectivity | LTE SIM or site internet; data budget a few MB/month | Site Wi-Fi; reserved DHCP or static IP |
| Power | battery (sensor) + gateway mains with UPS/inverter backup (load-shedding) | mains on the metered circuit; gateway on backup |
| Proplyst | one integration per gateway (token shown once), one meter per register, unit mapping | same |

## 3. Commissioning steps (record evidence for each)

1. **Before installation:** photograph the meter face, serial number and register reading with a date-stamped photo.
2. Create the integration in Proplyst (Utilities → Hardware connections). Store the token in the gateway only.
3. Add the meter with the wizard: property, building/unit, "It measures: consumption", device ID (DevEUI / Shelly id)
   and channel; set multiplier (litres per pulse) and **value offset = the dial reading at the moment the counter
   started at zero**.
4. **Meter-to-unit mapping check:** run water/electricity in that unit only (open a tap / switch on a known load) and
   confirm the reading moves on the right meter in Proplyst within one reporting interval.
5. **Timestamp accuracy:** compare `read_at` of three consecutive readings with the gateway clock and SAST wall time;
   tolerance ±2 minutes. Readings more than 5 minutes in the future are rejected by design.
6. **Data loss:** leave running 7 days; Utilities shows *expected vs received* readings for the last 24 h; investigate
   below 95 %.
7. **Accuracy:** after 7 and 30 days compare the physical register (photo) with Proplyst's latest reading; difference
   must be within the meter's class accuracy plus one pulse. Record both photos as reading evidence.
8. **Offline recovery:** switch the gateway off for 2 hours and back on; confirm the health status goes stale/offline
   and recovers, and that LoRaWAN/Shelly buffered readings (if the device buffers) arrive without duplicates.
9. **Replacement drill (optional):** use "Replace" in the meter list with the new meter's start reading; confirm the
   consumption across the swap is marked partial, never negative.
10. Only after steps 4–8 pass: change the catalogue entry to "verified and ready" in `meterCatalogue.ts` and
    `PROVIDERS[...].verification`, and add the evidence to `SA_SMART_METER_CATALOGUE.md`.

## 4. Before any tenant is billed from device data
- Billing arrangement set per unit and the lease clause in place (shared splits, fixed amounts).
- Recharge legality confirmed for the site (electricity resale: NERSA guidelines and municipal by-laws on approved
  submeters; water: municipal by-law / Water Services Act s25).
- Two billing cycles of draft charges reviewed by hand against the meter photos before the first approval.

## 5. Phase 3 — South African pilot hardware plan (2026-10-11)

**Nothing here is purchased, ordered or quoted. No integration below has been physically tested.** Prices are the
dated retailer snapshots in `SA_SMART_METER_CATALOGUE.md` (2026-10-08/10, VAT basis varies by listing). Get written
quotes before ordering. This is a plan for the owner to approve, not a purchase.

### 5.1 Recommended pilot: one hybrid property, 6 rented units (matches `UTILITIES_PILOT_TEST_SCENARIOS.md`)

| Line | Qty | Unit price (snapshot) | Line total | Purpose | Status |
| --- | --- | --- | --- | --- | --- |
| SANS 1529-1 pulse-ready 20 mm water meter | 6 | R605.48 incl | R3,632.88 | unit water submeters | meter only |
| Milesight EM300-DI pulse counter | 6 | R1,350.00 | R8,100.00 | reads the water meters | requires hardware testing |
| Milesight UG63-LTE gateway | 1 | R4,384.95 incl | R4,384.95 | LoRaWAN gateway (built-in network server, HTTP push) | requires hardware testing |
| Pulse-ready meter + EM300-DI on borehole outlet | 1 + 1 | R605.48 + R1,350.00 | R1,955.48 | borehole supply (monitoring only, never billed) | requires hardware testing |
| Eastron SDM120M single-phase Modbus meter | 6 | ≈R1,070 (derived) | R6,420.00 | unit electricity submeters (billing candidate) | requires hardware testing |
| Teltonika TRB246 Modbus→HTTP gateway | 1 | R3,770.00 (out of stock 10-08) | R3,770.00 | posts Eastron registers as Proplyst JSON | requires hardware testing |
| Shelly EM Gen3 | 1 | R1,575.00 | R1,575.00 | borehole pump energy (monitoring only) | requires hardware testing |
| Shelly Pro 3EM-120A | 1 | R3,029.00 incl | R3,029.00 | grid / generator supply (monitoring only) | requires hardware testing |
| **Hardware total** | | | **R32,867.31** | `Derived` from snapshot prices; second-method check: water R16,117.83 + borehole R1,955.48 + electricity R10,190.00 + supply R4,604.00 | |

Cheaper monitoring-only electricity: 6 × Shelly EM Gen3 = R9,450 (Wi-Fi, monitoring-grade). It is cheaper, but it should **not** be
used to bill tenants (see 5.3).

**Not in the list on purpose:**
- Inverter, battery or solar integrations. No pilot device is confirmed and there is no API access (TD-64). Solar, battery
  and generator registers are entered by hand from the inverter display, or come from the supply meters above.
- Tank level sensors. Tank levels are entered by hand; they are never billed.

### 5.2 Installation and running costs

| Item | Cost | Label |
| --- | --- | --- |
| Plumber: 7 meters + pulse heads | Unknown — written quote needed | Unknown |
| Registered electrician: 6 DIN-rail meters + RS485 bus + Shelly units, **Certificate of Compliance** | Unknown — written quote needed | Unknown |
| LTE SIM for the UG63 (a few MB/month) | Unknown — depends on network bundle | Unknown |
| LoRaWAN network server | R0 (UG63 built-in server; ChirpStack is MIT if self-hosted) | Likely |
| EM300-DI batteries | ≈5-year life at 10-minute reporting (vendor claim) | Likely (vendor claim) |
| Proplyst hosting / jobs | existing plan; telemetry is ≈52k rows/meter/year at 10 min (retention keeps ≥400 days in full) | Derived |

### 5.3 Accuracy and "billing-grade"

- **Water:** the SANS 1529-1 pulse-ready meter is the measuring instrument. The counter only adds pulses, so accuracy
  equals the meter's class plus one pulse. Whether the pulse head fits the chosen meter: Unknown (confirm with the
  supplier).
- **Electricity:** Eastron SDM120M is MID class 1 (`Likely`, vendor specification). MID is **not** South African type
  approval. Whether a by-law or NERSA accepts it as an "approved submeter" for recharging is Unknown and must be
  confirmed per municipality before any tenant is billed from it. Shelly devices are monitoring-grade only.
- Until the recharge question is settled, the pilot can run **monitoring-only** (no tariffs needed; see the Q scenario)
  or bill from **manual readings of an approved meter** with photo evidence.

### 5.4 Reading frequency

| Register | Interval | Why |
| --- | --- | --- |
| Unit water / electricity | 10–15 min | leak and usage alerts; billing needs only period boundaries |
| Borehole, pump, grid, generator | 15 min | site balance and pump-efficiency figures |
| Tank level, inverter registers | manual (daily–weekly) | no verified device integration |

### 5.5 Failure handling and manual fallback (all implemented and tested in software)

| Failure | What Proplyst does | Manual fallback |
| --- | --- | --- |
| Gateway offline (load-shedding, SIM) | health → stale/offline, alert; readings are missing, never invented | gateway on the inverter/UPS circuit; read the meter and enter it with a photo |
| Missing closing reading at month end | charge refused (R0, review), or **estimated** if the manager ticks "Estimate where readings are missing" | the true-up is automatic once a reading exists (draft charge or credit) |
| Counter reset / battery swap | decrease classified as a reset → reading marked suspect + alert; never negative consumption | enter the dial reading and set the value offset |
| Meter replaced | "Replace" links old → new; consumption across the swap is marked partial | photo of both registers |
| Duplicate or replayed uplinks | ignored (unique device timestamp / event id) | none needed |
| Faulty meter (suspected) | dispute on the charge blocks approval until resolved | credit after invoicing; void and recalculate before |

### 5.6 Owner decisions before ordering
1. Choose a monitoring-only or recharge pilot. A recharge pilot needs confirmation of the municipal by-law and the NERSA
   rules for the site.
2. Approve the hardware budget (≈R32.9k hardware, plus installation and SIM) and the supplier. Get written quotes.
3. Choose the pilot property and organisation. The module is restricted to that one organisation by switching
   `organizations.utilities_enabled` off for every other organisation and setting the column default to false
   (`UTILITIES_STAGING_DEPLOYMENT_PLAN.md`).
