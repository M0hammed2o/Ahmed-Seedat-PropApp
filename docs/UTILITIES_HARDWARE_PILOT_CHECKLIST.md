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
