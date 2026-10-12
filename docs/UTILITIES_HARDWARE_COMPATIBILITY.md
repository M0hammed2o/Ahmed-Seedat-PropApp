# Utilities — Hardware Compatibility

**Date:** 2026-10-12. **No physical device has been tested.** Nothing was purchased.
- "Simulated" means the adapter was exercised with payloads built from the vendor's published format, against a
  real local database.
- Prices and the pilot bill of materials are in `UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §5.

## Integration status

| Path | Implemented | Automated evidence | Physical test |
| --- | --- | --- | --- |
| Manual reading + photo (any meter) | yes | unit, DB, browser, Android API | **not needed** (verified in software) |
| Proplyst generic JSON push | yes | contract validation, ingest route, duplicates, spoofing, backfill | needs a real gateway posting it |
| Milesight EM300-DI (gateway HTTP) | yes | pulse and history frames hand-built from the decoder layout; ingest route | **required** |
| Shelly Gen2+ (EMData / Input counters, push script) | yes | fixture payloads | **required** |
| ChirpStack v4 webhook | yes | codec-less frames and decoded objects; non-uplink events | **required** |
| The Things Stack v3 webhook | yes | `frm_payload`/`decoded_payload`; receive-time preference | **required** |
| ThingsBoard REST poll | yes | mocked HTTP; API-key and JWT login; paging; back-off | **required**, against the customer's server |
| Modbus meters (Eastron, CHINT) via a gateway posting JSON | gateway side | none | **required** |
| Kamstrup wM-Bus / READy | no | — | needs supplier approval |
| Inverters (Victron VRM, Sunsynk/Deye, SolarEdge …) | no | — | not built: no confirmed pilot device or API access (TD-64) |

## Readiness behaviours validated by simulation

| Behaviour | Result | Evidence |
| --- | --- | --- |
| Authentication | hashed per-connection tokens; missing, invalid or revoked tokens refused; rotation grace; another org's token refused | ingest route tests |
| Permissions | viewers cannot connect hardware; managers get a one-time token; switched-off organisations are refused | ingest, switch tests |
| Duplicate events | replays counted as duplicates, never double-counted (same time or same event id) | ingest, backfill |
| Out-of-order readings | late, older readings stored valid against their time neighbour; no false reset; last reading never moves backwards | `ingestBackfill.integration` |
| Missing readings | gaps → partial or insufficient quality; billing refuses or estimates (opt-in), never guesses silently | consumption, estimates |
| Resets and rollovers | a plausible register wrap is a rollover; any other drop is a reset → suspect + one alert; never negative | consumption, ingest |
| Incorrect units | there is no automatic unit detection. The multiplier and offset are configured per meter. A Wh-as-kWh mistake shows up as a spike alert | anomaly rules (P2: unit sanity check) |
| Spikes | flagged against the trailing median with an absolute floor | anomaly tests |
| Disconnection | health → stale/offline + alert after the expected interval | health sweep tests |
| Reconnection + backfill | buffered readings accepted out of order; replay = duplicates | `ingestBackfill.integration` |
| Meter replacement | the replacement chain sums correctly across the swap; the old meter's readings are kept | consumption, ingest, reconciliation R5 |
| Future timestamps / very old data | refused (more than 5 min ahead / more than 400 days old) | ingest |

## ThingsBoard SSRF / DNS rebinding

**Mitigated (TD-66, Phase 3).** `pinnedFetch` resolves the host inside the socket's own lookup hook and refuses any
private or reserved address. The connection is made to exactly the address that passed the check. Redirects are not
followed, and responses are capped at 10 MB. Tests cover a redirect to cloud metadata and a host that resolves
privately.

Polling also stays **off** unless `SMART_UTILITY_CREDENTIALS_KEY` is set. Since migration 182 it never runs for a
switched-off organisation. The remaining limit is that this has not been tested against a live ThingsBoard server.

## What a physical test must show before any device is used for billing

Follow the commissioning steps in `UTILITIES_HARDWARE_PILOT_CHECKLIST.md` §3:
1. meter-to-unit mapping;
2. timestamp accuracy within ±2 min;
3. at least 95 % of readings received over 7 days;
4. register vs Proplyst within the meter's accuracy class plus one pulse, at 7 and 30 days;
5. offline recovery without duplicates.

Only then may the catalogue status change from "requires hardware testing".
